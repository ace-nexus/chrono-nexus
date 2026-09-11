import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';
import { getJstDateStr, getJstCalendarReference } from '@/lib/dateUtils';
import {
  getValidGoogleAccessToken,
  createGoogleCalendarEvent,
  getTargetCalendarId,
} from '@/lib/googleCalendar';

export const maxDuration = 30;

const INBOX_LOGS_SOURCE = 'chrono_ai_inbox_logs';
const INBOX_LOGS_EXTERNAL_ID = 'ai_inbox_logs';

async function callGeminiJson(apiKey: string, promptText: string): Promise<any | null> {
  const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest'];

  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (raw) {
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          return JSON.parse(cleaned);
        }
      }
    } catch (err: any) {
      console.warn(`Gemini model ${model} failed in unified-inbox:`, err.message);
    }
  }
  return null;
}

// ユーザー意図の保護＆サニタイズ（二重防護ガードレール）
function harmonizeItems(parsed: { schedules: any[]; tasks: any[]; memos: any[] }, text: string) {
  let schedules = Array.isArray(parsed.schedules) ? [...parsed.schedules] : [];
  let tasks = Array.isArray(parsed.tasks) ? [...parsed.tasks] : [];
  let memos = Array.isArray(parsed.memos) ? [...parsed.memos] : [];

  const wantsTask = /タスクとして|ToDoとして|タスクに入れ|タスクで入れ|ToDoに入れ/i.test(text);

  // 「タスクとして」と指定されているのに schedules と tasks の両方に重複出力された場合、schedules 側を安全に除去
  if (wantsTask && tasks.length > 0 && schedules.length > 0) {
    schedules = schedules.filter(s => {
      const sTitle = (s.title || '').replace(/\s+/g, '');
      const hasDuplicateTask = tasks.some(t => {
        const tTitle = (t.title || '').replace(/\s+/g, '');
        return t.dueDate === s.date && (
          sTitle.includes(tTitle) || tTitle.includes(sTitle) ||
          (sTitle.includes('連絡') && tTitle.includes('連絡')) ||
          (sTitle.includes('工事') && tTitle.includes('工事'))
        );
      });
      return !hasDuplicateTask;
    });
  }

  // 逆に「予定として」「スケジュールとして」と言っているのにタスクにも重複している場合
  const wantsScheduleOnly = /スケジュールとして|予定として/i.test(text) && !wantsTask;
  if (wantsScheduleOnly && schedules.length > 0 && tasks.length > 0) {
    tasks = tasks.filter(t => {
      const tTitle = (t.title || '').replace(/\s+/g, '');
      const hasDuplicateSchedule = schedules.some(s => {
        const sTitle = (s.title || '').replace(/\s+/g, '');
        return s.date === t.dueDate && (
          sTitle.includes(tTitle) || tTitle.includes(sTitle)
        );
      });
      return !hasDuplicateSchedule;
    });
  }

  return { schedules, tasks, memos };
}

async function getOrCreateDailyNote(dateStr: string, userId: string = 'owner'): Promise<string | null> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('chrono_daily_notes')
      .select('id')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .maybeSingle();

    if (existing?.id) return existing.id;

    const { data: created, error } = await supabaseAdmin
      .from('chrono_daily_notes')
      .insert({
        user_id: userId,
        date: dateStr,
        title: `${dateStr} の手帳`,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create daily note:', error);
      return null;
    }
    return created.id;
  } catch (err) {
    console.error('getOrCreateDailyNote error:', err);
    return null;
  }
}

// 履歴ログの安全な保存（chrono_schedule_eventsを利用）
async function saveInboxLog(rawText: string, actions: any) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('id, raw_payload')
      .eq('source', INBOX_LOGS_SOURCE)
      .maybeSingle();

    const prevLogs = (existing?.raw_payload?.logs && Array.isArray(existing.raw_payload.logs))
      ? existing.raw_payload.logs
      : [];

    const newEntry = {
      id: `inbox-${Date.now()}`,
      rawText,
      actions,
      createdAt: new Date().toISOString(),
    };

    const updatedLogs = [newEntry, ...prevLogs].slice(0, 50);

    if (existing?.id) {
      await supabaseAdmin
        .from('chrono_schedule_events')
        .update({
          raw_payload: { logs: updatedLogs },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin
        .from('chrono_schedule_events')
        .insert({
          source: INBOX_LOGS_SOURCE,
          external_id: INBOX_LOGS_EXTERNAL_ID,
          title: 'Chrono AI Inbox Logs Master',
          raw_payload: { logs: updatedLogs },
        });
    }
  } catch (e) {
    console.warn('Failed to save inbox log:', e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, currentDate, mode = 'auto', parsedData, instruction } = body;
    const jstToday = getJstDateStr();
    const effectiveBaseDate = currentDate || jstToday;
    const calRef = getJstCalendarReference(effectiveBaseDate);

    // ── 1. 確定コミットモード (mode: 'commit') ──
    if (mode === 'commit') {
      const { schedules = [], tasks = [], memos = [] } = parsedData || {};
      const createdResults: any = { schedules: [], tasks: [], memos: [] };
      const targetDatesSet = new Set<string>();

      // Google連携のトークン＆優先カレンダー取得（即時反映用）
      let googleAccessToken: string | null = null;
      let targetCalId: string = 'primary';
      try {
        googleAccessToken = await getValidGoogleAccessToken('owner');
        if (googleAccessToken) {
          targetCalId = await getTargetCalendarId(googleAccessToken);
        }
      } catch (gErr) {
        console.warn('Google token check in unified-inbox error:', gErr);
      }

      // A. 予定の保存
      for (const item of schedules) {
        if (!item.title) continue;
        const sDate = item.date || effectiveBaseDate;
        targetDatesSet.add(sDate);
        const noteId = await getOrCreateDailyNote(sDate);
        if (!noteId) continue;

        let startIso: string;
        let endIso: string | null = null;
        const isAllDay = Boolean(item.isAllDay || !item.startTime);
        if (isAllDay) {
          startIso = `${sDate}T00:00:00+09:00`;
        } else {
          startIso = `${sDate}T${item.startTime}:00+09:00`;
          if (item.endTime) {
            endIso = `${sDate}T${item.endTime}:00+09:00`;
          } else {
            const [h, m] = item.startTime.split(':').map(Number);
            const endH = Math.min(23, h + 1).toString().padStart(2, '0');
            endIso = `${sDate}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
          }
        }

        // Googleカレンダーへ即時Push（タイムラグ完全解消）
        let externalId: string | null = null;
        if (googleAccessToken) {
          try {
            const createdG = await createGoogleCalendarEvent(googleAccessToken, {
              title: item.title,
              startTime: startIso,
              endTime: endIso,
              location: item.location || null,
              isAllDay,
            }, targetCalId);
            if (createdG && createdG.id) {
              externalId = createdG.id;
            }
          } catch (pushErr) {
            console.error('Failed to create event on Google Calendar from unified inbox:', pushErr);
          }
        }

        const { data: schData } = await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteId,
            title: item.title,
            start_time: startIso,
            end_time: endIso,
            location: item.location || null,
            external_id: externalId,
            source: externalId ? 'google_calendar' : 'manual',
            raw_payload: {
              isAllDay,
              source_transcript: text || '',
              calendarId: externalId ? targetCalId : null,
            },
          })
          .select('id, title')
          .single();

        if (schData) createdResults.schedules.push(schData);
      }

      // B. タスクの保存
      for (const item of tasks) {
        if (!item.title || !item.title.trim()) continue;
        const tDueDate = item.dueDate || null;
        const isNoDate = Boolean(item.isNoDate || !tDueDate);
        const tDueTime = !isNoDate && (item.dueTime || item.due_time) ? (item.dueTime || item.due_time) : null;
        const tEndTime = !isNoDate && (item.endTime || item.end_time) ? (item.endTime || item.end_time) : null;

        const effectiveDate = !isNoDate && tDueDate ? tDueDate : effectiveBaseDate;
        if (!isNoDate && tDueDate) targetDatesSet.add(tDueDate);
        const noteId = await getOrCreateDailyNote(effectiveDate);
        if (!noteId) continue;

        let startTimeIso: string;
        let endTimeIso: string | null = null;
        const isAllDay = isNoDate || !tDueTime;

        if (!isNoDate && tDueDate) {
          if (tDueTime) {
            startTimeIso = `${tDueDate}T${tDueTime}:00+09:00`;
            if (tEndTime) {
              endTimeIso = `${tDueDate}T${tEndTime}:00+09:00`;
            } else {
              const [h, m] = tDueTime.split(':').map(Number);
              const endH = Math.min(23, h + 1).toString().padStart(2, '0');
              endTimeIso = `${tDueDate}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
            }
          } else {
            startTimeIso = `${tDueDate}T00:00:00+09:00`;
            endTimeIso = null;
          }
        } else {
          startTimeIso = new Date().toISOString();
        }

        const taskPriority = ['S', 'A', 'B', 'C'].includes(item.priority) ? item.priority : 'B';

        const { data: taskData, error: taskErr } = await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteId,
            source: 'chrono_task',
            title: item.title.trim(),
            description: (item.description || '').trim() || null,
            start_time: startTimeIso,
            end_time: endTimeIso,
            location: item.location?.trim() || null,
            raw_payload: {
              is_task: true,
              genre: item.genre || 'その他',
              priority: taskPriority,
              dueDate: isNoDate ? null : tDueDate,
              due_date: isNoDate ? null : tDueDate,
              due_time: isAllDay ? null : tDueTime,
              dueTime: isAllDay ? null : tDueTime,
              end_time: isAllDay ? null : tEndTime,
              endTime: isAllDay ? null : tEndTime,
              isNoDate,
              is_nodate: isNoDate,
              is_all_day: isAllDay,
              isAllDay: isAllDay,
              isCompleted: false,
              sourceTranscript: text || '',
            },
          })
          .select('id, title')
          .single();

        if (taskErr) {
          console.error('Unified inbox task insert error:', taskErr);
        } else if (taskData) {
          createdResults.tasks.push(taskData);
        }
      }

      // C. メモの保存
      for (const item of memos) {
        if (!item.content || !item.content.trim()) continue;
        const mDate = item.date || effectiveBaseDate;
        targetDatesSet.add(mDate);
        const noteId = await getOrCreateDailyNote(mDate);
        if (!noteId) continue;

        const { data: rawData, error: memoErr } = await supabaseAdmin
          .from('chrono_raw_inputs')
          .insert({
            note_id: noteId,
            input_type: 'memo',
            content: item.content.trim(),
            recorded_at: new Date().toISOString(),
          })
          .select('id, content')
          .single();

        if (memoErr) {
          console.error('Unified inbox memo insert error:', memoErr);
        } else if (rawData) {
          createdResults.memos.push(rawData);
        }
      }

      saveInboxLog(text || 'AI仕分け一括登録', createdResults);

      const targetDates = Array.from(targetDatesSet);
      const primaryDate = targetDates[0] || effectiveBaseDate;

      const msgParts: string[] = [];
      if (createdResults.schedules.length > 0) msgParts.push(`予定${createdResults.schedules.length}件`);
      if (createdResults.tasks.length > 0) msgParts.push(`タスク${createdResults.tasks.length}件`);
      if (createdResults.memos.length > 0) msgParts.push(`メモ${createdResults.memos.length}件`);

      const dateLabel = primaryDate !== jstToday ? `【${primaryDate}】` : '';
      const summaryMsg = msgParts.length > 0 ? `${dateLabel}${msgParts.join('、')}を登録しました` : '登録しました';

      return NextResponse.json({
        success: true,
        summaryMessage: summaryMsg,
        targetDates,
        primaryDate,
        results: createdResults,
      });
    }

    // ── 2. AI対話修正モード (mode: 'refine') ──
    if (mode === 'refine') {
      const userInstruction = instruction || text;
      if (!userInstruction || typeof userInstruction !== 'string' || !userInstruction.trim()) {
        return NextResponse.json({ error: '修正指示テキストが必要です' }, { status: 400 });
      }

      const apiKey = await getGeminiApiKey();
      if (!apiKey) {
        return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
      }

      const refinePrompt = `あなたは個人業務手帳の編集・仕分けアシスタントAIです。
ユーザーが現在プレビュー中の手帳仕分けデータ（予定・タスク・メモ）に対して、【修正指示】を受け取りました。
現在のデータを可能な限り維持しつつ、ユーザーの指示に従って正確に修正・追加・削除・種別変更を行ってください。

${calRef.promptText}

【現在のプレビューデータ】
${JSON.stringify(parsedData || { schedules: [], tasks: [], memos: [] }, null, 2)}

【ユーザーからの修正指示】
"${userInstruction.trim()}"

【修正ルール】
1. 種別の移動: メモ・タスク・予定の移動を適切に行う。
2. 時間・日付の変更: 指示に従い更新。
3. タイトル・内容・追加・削除: 指示を忠実に実行。
4. 複数日・除外日の反映: 「日曜日を除く」「○日を除く」等の除外条件があれば該当日のアイテムを除外し、「明日から○日間」等の展開があればカレンダー対照表に従って日割り展開してください。
5. 「タスクとして」等の多義表現: 予定とタスクの両方に同一の用件を重複登録せず、ユーザーの希望する側に集約してください。
6. 未指示項目: 維持する。

【出力形式】
修正後の全データを含むJSONオブジェクトのみを出力してください（Markdown不可）:
{
  "schedules": [{ "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm" | null, "endTime": "HH:mm" | null, "isAllDay": boolean, "location": string | null }],
  "tasks": [{ "title": "...", "genre": "...", "priority": "S"|"A"|"B"|"C", "dueDate": "YYYY-MM-DD" | null, "dueTime": "HH:mm" | null, "endTime": "HH:mm" | null, "isNoDate": boolean, "location": string | null }],
  "memos": [{ "content": "...", "date": "YYYY-MM-DD" }]
}`;

      const refined = await callGeminiJson(apiKey, refinePrompt);
      if (!refined) {
        return NextResponse.json({ error: 'AIによる修正処理に失敗しました' }, { status: 500 });
      }

      const harmonizedRefined = harmonizeItems({
        schedules: Array.isArray(refined.schedules) ? refined.schedules : [],
        tasks: Array.isArray(refined.tasks) ? refined.tasks : [],
        memos: Array.isArray(refined.memos) ? refined.memos : [],
      }, userInstruction);

      return NextResponse.json({
        success: true,
        parsed: harmonizedRefined,
        summaryMessage: 'AIによる修正を反映しました',
      });
    }

    // ── 3. 新規解析モード (mode: 'parse' または mode: 'auto') ──
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
    }

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
ユーザーが話しかけた内容を【予定 (schedules)】【タスク (tasks)】【メモ (memos)】の3種類に高精度に自動仕分けしてください。

${calRef.promptText}

【最優先・複合指示＆仕分けルール（★厳格遵守）】
1. 【期間指定・複数日展開 ＆ 除外条件（引き算の完全徹底）】:
   - 「○日〜○日」「明日から○日間」「来週平日」「毎日」などの期間が指定された場合は、初日1件だけで終わらせず、【対象となる各日付に日割り展開】してください。
   - ★【除外日・除外曜日の厳格適用（超重要）】:
     - 「日曜日を除く」「土日を除く」「○日と○日を除く」「祝日を除く」などの【除外条件】が指定された場合、対象期間から該当する日付を【完全に除外（スキップ）】した日程のみを出力してください！
     - 例: 「9/12〜9/26、日曜日と9/17,18を除いた日全部に連絡タスク」
       → カレンダー対照表を確認: 9/13(日), 9/20(日), 9/17(木), 9/18(金) の4日間を完全に除外！
       → 対象日: 9/12, 9/14, 9/15, 9/16, 9/19, 9/21, 9/22, 9/23, 9/24, 9/25, 9/26 の【11日間のみ】を1日1件ずつ展開する。
       ※除外日が適用されずに全日（15日間）が出力されたり、予定とタスクで除外適用がバラバラになる食い違いは絶対に起こしてはなりません！

2. 【「スケジュールにタスクとして」等の多義表現・二重出力の絶対防止】:
   - ユーザーが「スケジュールにタスクとして入れて」「カレンダーにこのToDoを入れて」と言った場合、ユーザーの意図は「手帳画面上にチェック可能なタスク（ToDo）を登録すること」です。
   - 【同一の用件を schedules と tasks の両方に二重出力しては絶対にダメ】です！
   - 「タスクとして」と指定されている場合、または連絡・作業・買い出しなどのToDoは【tasks 配列】にのみ出力してください。schedules に同じものを重複出力しないでください。

3. 【全体工期（大枠） ＋ 日次定例タスクが1つの発話に含まれる場合】:
   - 例: 「岸本邸の塗装工事が9/12〜9/26で行う。雨が続くので朝8時に連絡する。連絡は日曜と17,18除く。スケジュールにタスクとして入れて」
   - この場合、ユーザーが求めている日次の実体は「朝8時の連絡タスク（日・17・18除外の11件）」です。
   - 工期全体の「9/12〜9/26 岸本邸塗装工事」については、メモ(memos)に概要（工期全体サマリー）を残すか、または1件の終日予定（isAllDay: true）とするかのいずれかにし、日次タスクと日付が矛盾するような中途半端な日割り分割は絶対にしないでください。

4. 【予定 (schedules) と タスク (tasks) の明確な区別】:
   - 【予定 (schedules)】: 来客、会議、打合せ、移動、現調など、他者との約束や特定の時間帯を拘束するイベント。
   - 【タスク (tasks)】: メッセージ連絡、電話、買い出し、書類作成、準備、清掃など、本人が完了チェックを入れるべきToDo。
   - ※時刻指定（例: 「朝8時」）があっても、「メッセージ連絡」「電話する」「ゴミ出し」「確認する」などのアクションは【タスク (dueTime: "08:00")】として扱います。「朝8時だから無条件に予定(schedule)」と決めつけないでください。

5. 【複数用件の分割】:
   - 「AとBとC」のように複数の異なる用件がある場合は、それぞれ独立したアイテムに分割して出力してください。

6. 【曜日指定（月水金のみ、平日のみ、週末のみ、1日おき等）】:
   - 「月水金のみ」→ カレンダー対照表の該当曜日の日付のみを出力。
   - 「平日のみ」→ 月〜金の日付のみを出力（土日はスキップ）。
   - 「1日おき（隔日）」→ 基準日の翌日から1日飛ばしの日付のみを出力。

【出力形式】
JSONオブジェクトのみを出力してください（Markdown不可）:
{
  "schedules": [{ "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm" | null, "endTime": "HH:mm" | null, "isAllDay": boolean, "location": string | null }],
  "tasks": [{ "title": "...", "genre": "...", "priority": "S"|"A"|"B"|"C", "dueDate": "YYYY-MM-DD" | null, "dueTime": "HH:mm" | null, "endTime": "HH:mm" | null, "isNoDate": boolean, "location": string | null }],
  "memos": [{ "content": "...", "date": "YYYY-MM-DD" }]
}`;

    const parsePrompt = `${systemPrompt}\n\n---\n【ユーザー吹き込み原文】\n${text.trim()}`;
    const parsedDataRes = await callGeminiJson(apiKey, parsePrompt);

    let parsed: { schedules: any[]; tasks: any[]; memos: any[] } = parsedDataRes || { schedules: [], tasks: [], memos: [] };

    if (!Array.isArray(parsed.schedules)) parsed.schedules = [];
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!Array.isArray(parsed.memos)) parsed.memos = [];

    // 二重防護ガードレール（重複排除・意図保護）
    parsed = harmonizeItems(parsed, text);

    if (parsed.schedules.length === 0 && parsed.tasks.length === 0 && parsed.memos.length === 0) {
      parsed.memos = [{ content: text.trim(), date: effectiveBaseDate }];
    }

    return NextResponse.json({
      success: true,
      parsed,
      rawText: text.trim(),
    });
  } catch (err: any) {
    console.error('Unified inbox route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
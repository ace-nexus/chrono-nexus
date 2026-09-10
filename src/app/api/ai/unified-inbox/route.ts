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
4. 未指示項目: 維持する。

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

      return NextResponse.json({
        success: true,
        parsed: {
          schedules: Array.isArray(refined.schedules) ? refined.schedules : [],
          tasks: Array.isArray(refined.tasks) ? refined.tasks : [],
          memos: Array.isArray(refined.memos) ? refined.memos : [],
        },
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

【最優先・仕分けルール】
1. 【予定 (schedules) - 絶対最優先】:
   - 「明日」「今日」「明後日」「来週」「○月○日」等の日付、あるいは「7:40」「14時」「朝○時」「夕方○時」等の時刻情報が含まれている発話は、具体的な会議名や用件名が省略・未指定であっても【100%最優先で予定 (schedules)】として仕分けしてください！
   - 例: 「明日の7:40」→ title: "予定 (7:40)" または文脈に応じた簡潔なタイトル、date: 翌日、startTime: "07:40"
   - 例: 「明日7時40分に出発」→ title: "出発", startTime: "07:40"
   - 例: 「10日 15時 見積もり」→ title: "見積もり", startTime: "15:00"
   - ※日付や時刻が指定されている発話を【メモ】や【タスク】に落とすことは重大な誤りです。絶対に予定に仕分けしてください。
   - 用件名が明示されていない場合は「予定」または「用事」などとしてタイトルを自動補完してください。
   - title: 予定名（簡潔に）
   - date: YYYY-MM-DD（基準日カレンダーに従って正確に出力）
   - startTime: 24時間表記の HH:mm または null。※「2時」「3時」など午前午後が曖昧な場合は一般的な活動時間（午後 14:00, 15:00等）を優先。「朝7時40分」なら "07:40"。「夜8時」なら "20:00"。
   - endTime: 24時間表記の HH:mm または null
   - isAllDay: true または false
   - location: 現場名や店舗名（あれば）

2. 【タスク (tasks)】:
   - やるべきこと、買い出し、書類作成、準備、連絡など（特定の時刻の予定ではなく、期限までに片付けるToDo）。
   - title: タスク名（具体的かつ簡潔）
   - genre: 「買い物」「見積」「その他」または適切なジャンル
   - priority: "S"（至急/最優先）, "A"（急ぎ）, "B"（普通）, "C"（急ぎでない）
   - dueDate: 締切日（YYYY-MM-DD）または null（基準日カレンダー参照）
   - dueTime: 開始時間または実施希望時刻（HH:mm）または null
   - endTime: 終了時間（HH:mm）または null
   - isNoDate: 締切なしなら true
   - location: 店名や現場（あれば）

3. 【メモ (memos)】:
   - 具体的な日付や特定の実施時刻の指定が一切ない、単なる気づき、アイデア、現場の出来事、数値などの記録・備忘録。
   - ※日付や時刻が含まれるものは絶対にメモにしないでください。
   - content: 整理されたメモ文章
   - date: YYYY-MM-DD（通常は本日: ${effectiveBaseDate}）

【出力形式】
JSONオブジェクトのみを出力してください:
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
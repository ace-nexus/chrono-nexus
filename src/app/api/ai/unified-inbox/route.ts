import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

function getTodayDateStr(): string {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().split('T')[0];
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

// 履歴ログの保存
async function saveInboxLog(rawText: string, actions: any) {
  try {
    const { data: logRow } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('raw_payload')
      .eq('user_id', 'chrono_ai_inbox_logs')
      .maybeSingle();

    const prevLogs = (logRow?.raw_payload?.logs && Array.isArray(logRow.raw_payload.logs))
      ? logRow.raw_payload.logs
      : [];

    const newEntry = {
      id: `inbox-${Date.now()}`,
      rawText,
      actions,
      createdAt: new Date().toISOString(),
    };

    // 最新50件を保持
    const updatedLogs = [newEntry, ...prevLogs].slice(0, 50);

    await supabaseAdmin
      .from('chrono_google_tokens')
      .upsert({
        user_id: 'chrono_ai_inbox_logs',
        raw_payload: { logs: updatedLogs },
        access_token: 'dummy',
        refresh_token: 'dummy',
      });
  } catch (e) {
    console.warn('Failed to save inbox log:', e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, currentDate } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const todayStr = currentDate || getTodayDateStr();
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
    }

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
ユーザーが何でも吹き込んだ音声やテキストを受け取り、その内容を【予定 (schedules)】【タスク (tasks)】【メモ (memos)】の3種類に自動判定・仕分けしてください。

【基準日】
本日: ${todayStr}

【仕分けルール】
1. 【予定 (schedules)】: 日時が明確に決まっている約束・訪問・現場打ち合わせ・会議など。
   - title: 予定名
   - date: YYYY-MM-DD（「明日」「来週火曜」などを正確に西暦換算）
   - startTime: HH:mm または null（終日）
   - endTime: HH:mm または null
   - isAllDay: true または false
   - location: 場所（あれば）

2. 【タスク (tasks)】: やるべきこと、買い出し、見積作成、準備、電話連絡など。
   - title: タスク名（具体的かつ簡潔）
   - genre: 「買い物」「見積」「その他」または適切なジャンル名
   - priority: 重要度。「至急」「絶対」「急ぎ」なら "S" または "A"。普通なら "B"。いつかやる・急ぎでないなら "C"。
   - dueDate: 締切日（YYYY-MM-DD）または null（期日なし）
   - isNoDate: 期日なしなら true、期日指定があれば false
   - location: 対象の店名や現場名（あれば）

3. 【メモ (memos)】: 単なる気づき、現場での出来事、備忘録（予定でもタスクでもない情報）。
   - content: 整理されたメモ内容
   - date: YYYY-MM-DD

【出力形式】
必ず以下のJSON形式のみを出力してください（Markdownコードブロックや前置きは不要）:
{
  "schedules": [ ... ],
  "tasks": [ ... ],
  "memos": [ ... ]
}`;

    const candidateModels = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
    let rawResponse = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n【ユーザー吹き込み原文】\n${text.trim()}` }] }],
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
          rawResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (rawResponse) break;
        }
      } catch (fErr: any) {
        console.warn(`Gemini model ${model} failed in unified-inbox:`, fErr.message);
      }
    }

    let parsed: { schedules: any[]; tasks: any[]; memos: any[] } = { schedules: [], tasks: [], memos: [] };
    if (rawResponse) {
      try {
        const cleaned = rawResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pErr) {
        console.warn('Failed to parse Gemini output:', pErr);
      }
    }

    const createdResults: any = {
      schedules: [],
      tasks: [],
      memos: [],
    };

    // 1. 予定の即時DB保存
    if (Array.isArray(parsed.schedules)) {
      for (const item of parsed.schedules) {
        if (!item.title) continue;
        const sDate = item.date || todayStr;
        const noteId = await getOrCreateDailyNote(sDate);
        if (!noteId) continue;

        let startIso: string;
        let endIso: string | null = null;
        if (item.isAllDay || !item.startTime) {
          startIso = `${sDate}T00:00:00+09:00`;
        } else {
          startIso = `${sDate}T${item.startTime}:00+09:00`;
          if (item.endTime) {
            endIso = `${sDate}T${item.endTime}:00+09:00`;
          } else {
            const [h, m] = item.startTime.split(':').map(Number);
            const endH = Math.min(23, h + 1).toString().padStart(2, '0');
            endIso = `${sDate}T${endH}:${m.toString().padStart(2, '0')}:00+09:00`;
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
            source: 'manual',
            raw_payload: {
              isAllDay: Boolean(item.isAllDay || !item.startTime),
              source_transcript: text.trim(),
            },
          })
          .select()
          .single();

        if (schData) {
          createdResults.schedules.push(schData);
        }
      }
    }

    // 2. タスクの即時DB保存
    if (Array.isArray(parsed.tasks)) {
      for (const item of parsed.tasks) {
        if (!item.title) continue;
        const tDate = item.dueDate || todayStr;
        const noteId = await getOrCreateDailyNote(tDate);
        if (!noteId) continue;

        const isNoDate = Boolean(item.isNoDate || !item.dueDate);
        const startIso = isNoDate ? new Date().toISOString() : `${item.dueDate}T00:00:00+09:00`;

        const { data: taskData } = await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteId,
            title: item.title,
            start_time: startIso,
            location: item.location || null,
            source: 'chrono_task',
            raw_payload: {
              is_task: true,
              genre: item.genre || 'その他',
              priority: ['S', 'A', 'B', 'C'].includes(item.priority) ? item.priority : 'B',
              is_completed: false,
              completed_at: null,
              archived: false,
              is_nodate: isNoDate,
              due_date: isNoDate ? null : item.dueDate,
              due_time: null,
              is_all_day: true,
              location_name: item.location || null,
              source_transcript: text.trim(),
            },
          })
          .select()
          .single();

        if (taskData) {
          createdResults.tasks.push(taskData);
        }
      }
    }

    // 3. メモの即時DB保存
    if (Array.isArray(parsed.memos)) {
      for (const item of parsed.memos) {
        if (!item.content) continue;
        const mDate = item.date || todayStr;
        const noteId = await getOrCreateDailyNote(mDate);
        if (!noteId) continue;

        const { data: memoData } = await supabaseAdmin
          .from('chrono_raw_inputs')
          .insert({
            note_id: noteId,
            input_type: 'text',
            content: item.content,
            recorded_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (memoData) {
          createdResults.memos.push(memoData);
        }
      }
    }

    // 履歴ログを非同期保存
    await saveInboxLog(text.trim(), createdResults);

    // 要約メッセージの生成
    const summaryParts = [];
    if (createdResults.schedules.length > 0) summaryParts.push(`予定${createdResults.schedules.length}件`);
    if (createdResults.tasks.length > 0) summaryParts.push(`タスク${createdResults.tasks.length}件`);
    if (createdResults.memos.length > 0) summaryParts.push(`メモ${createdResults.memos.length}件`);

    const summaryMessage = summaryParts.length > 0
      ? `${summaryParts.join('、')} を登録しました`
      : '内容をメモとして記録しました';

    return NextResponse.json({
      success: true,
      summaryMessage,
      created: createdResults,
    });
  } catch (err: any) {
    console.error('Unified inbox error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

const INBOX_LOGS_SOURCE = 'chrono_ai_inbox_logs';
const INBOX_LOGS_EXTERNAL_ID = 'ai_inbox_logs';

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
    const { text, currentDate, mode = 'auto', parsedData } = body;
    const todayStr = currentDate || getTodayDateStr();

    // ── 1. 確定コミットモード (mode: 'commit') ──
    // ユーザーがプレビュー画面で確認・編集したデータを一括保存
    if (mode === 'commit') {
      const { schedules = [], tasks = [], memos = [] } = parsedData || {};
      const createdResults: any = { schedules: [], tasks: [], memos: [] };

      // A. 予定の保存
      for (const item of schedules) {
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
            endIso = `${sDate}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
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
              source_transcript: text || '',
            },
          })
          .select('id, title')
          .single();

        if (schData) createdResults.schedules.push(schData);
      }

      // B. タスクの保存
      for (const item of tasks) {
        if (!item.title) continue;
        const tDueDate = item.dueDate || null;
        const isNoDate = Boolean(item.isNoDate || !tDueDate);

        const { data: taskData } = await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            source: 'chrono_task',
            title: item.title,
            description: item.description || '',
            location: item.location || null,
            raw_payload: {
              genre: item.genre || 'その他',
              priority: ['S', 'A', 'B', 'C'].includes(item.priority) ? item.priority : 'B',
              dueDate: isNoDate ? null : tDueDate,
              isNoDate,
              isCompleted: false,
              completedAt: null,
              archived: false,
              locationName: item.location || null,
              sourceTranscript: text || '',
            },
          })
          .select('id, title')
          .single();

        if (taskData) createdResults.tasks.push(taskData);
      }

      // C. メモの保存
      for (const item of memos) {
        if (!item.content) continue;
        const mDate = item.date || todayStr;
        const noteId = await getOrCreateDailyNote(mDate);
        if (!noteId) continue;

        const { data: rawData } = await supabaseAdmin
          .from('chrono_raw_inputs')
          .insert({
            daily_note_id: noteId,
            input_type: 'memo',
            content: item.content,
            recorded_at: new Date().toISOString(),
          })
          .select('id, content')
          .single();

        if (rawData) createdResults.memos.push(rawData);
      }

      // 履歴ログを非同期保存
      saveInboxLog(text || 'AI仕分け一括登録', createdResults);

      const msgParts: string[] = [];
      if (createdResults.schedules.length > 0) msgParts.push(`予定${createdResults.schedules.length}件`);
      if (createdResults.tasks.length > 0) msgParts.push(`タスク${createdResults.tasks.length}件`);
      if (createdResults.memos.length > 0) msgParts.push(`メモ${createdResults.memos.length}件`);
      const summaryMsg = msgParts.length > 0 ? `${msgParts.join('、')}を登録しました` : '登録しました';

      return NextResponse.json({
        success: true,
        summaryMessage: summaryMsg,
        results: createdResults,
      });
    }

    // ── 2. 解析モード (mode: 'parse' または mode: 'auto') ──
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
    }

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
ユーザーが話しかけた内容を【予定 (schedules)】【タスク (tasks)】【メモ (memos)】の3種類に高精度に自動仕分けしてください。

【基準日】
本日: ${todayStr}

【仕分けルール】
1. 【予定 (schedules)】: 日時や訪問先が決まっている約束・会議・現場作業など。
   - title: 予定名（簡潔に）
   - date: YYYY-MM-DD（「明日」「来週月曜」等は基準日から正確に計算）
   - startTime: HH:mm または null（時間指定なしの場合）
   - endTime: HH:mm または null
   - isAllDay: true または false
   - location: 現場名や店舗名（あれば）

2. 【タスク (tasks)】: やるべきこと、買い出し、見積作成、準備、連絡など。
   - title: タスク名（具体的かつ簡潔）
   - genre: 「買い物」「見積」「その他」または適切なジャンル
   - priority: "S"（至急/最優先）, "A"（急ぎ）, "B"（普通）, "C"（急ぎでない）
   - dueDate: 締切日（YYYY-MM-DD）または null
   - isNoDate: 締切なしなら true
   - location: 店名や現場（あれば）

3. 【メモ (memos)】: 単なる気づき、アイデア、現場の出来事、数値などの記録。
   - content: 整理されたメモ文章
   - date: YYYY-MM-DD（通常は本日）

【出力形式】
JSONオブジェクトのみを出力してください:
{
  "schedules": [
    { "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm" | null, "endTime": "HH:mm" | null, "isAllDay": boolean, "location": string | null }
  ],
  "tasks": [
    { "title": "...", "genre": "...", "priority": "S"|"A"|"B"|"C", "dueDate": "YYYY-MM-DD" | null, "isNoDate": boolean, "location": string | null }
  ],
  "memos": [
    { "content": "...", "date": "YYYY-MM-DD" }
  ]
}`;

    const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
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

    // もし何にも該当しなかった場合の安全フォールバック（メモとして扱う）
    if (
      (!parsed.schedules || parsed.schedules.length === 0) &&
      (!parsed.tasks || parsed.tasks.length === 0) &&
      (!parsed.memos || parsed.memos.length === 0)
    ) {
      parsed.memos = [{ content: text.trim(), date: todayStr }];
    }

    // mode: 'parse' の場合、解析結果のみを返し、DB登録はユーザー確認待ちにする
    if (mode === 'parse') {
      return NextResponse.json({
        success: true,
        parsed,
        rawText: text.trim(),
      });
    }

    // mode: 'auto'（従来の即時保存）の場合も後方互換でそのまま登録
    // (UI側からは mode: 'parse' -> mode: 'commit' の2ステップで呼び出されます)
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
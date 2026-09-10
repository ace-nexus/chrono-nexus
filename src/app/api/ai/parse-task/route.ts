import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';
import { getJstDateStr, getJstCalendarReference } from '@/lib/dateUtils';

export const maxDuration = 25;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, currentDate, availableGenres = [] } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const effectiveDate = currentDate || getJstDateStr();
    const calRef = getJstCalendarReference(effectiveDate);
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
    }

    const genresList = availableGenres.length > 0 ? availableGenres.join('、') : '買い物、見積、その他';

    const prompt = `あなたは個人業務手帳のタスク判別AIです。
ユーザーが話した音声（または入力したテキスト）から、タスク管理用の項目を抽出・補完してください。

${calRef.promptText}
【選択可能ジャンル】: ${genresList}

【判定ルール】
- title: 何をするべきか（簡潔で明確なタイトル）
- description: 補足詳細やメモ（あれば）
- genre: 選択可能ジャンルの中から最適なものを選択。合致するものが無ければ「その他」
- priority:
  - "S": 最優先、緊急、至急、絶対今日中、重要度S
  - "A": 急ぎ、重要、重要度A
  - "B": 通常のタスク（指定がなければデフォルトはB）
  - "C": いつかやる、急ぎでない、暇なとき
- dueDate: 締切日（YYYY-MM-DD）。「明日」「来週火曜」などは基準日をもとに正確に西暦換算。期日の言及がない場合は null
- dueTime: 締切時間（HH:mm）。「14時」「15:30」「午後3時」「夕方5時」等の時間指定があれば "14:00"、"15:30"、"17:00" の形式。時間指定がなければ null
- isNoDate: dueDateがnullならtrue、期日があればfalse
- locationName: 対象の現場名、店名（コーナン等）、訪問先（あれば）

【出力形式】
JSONオブジェクトのみを出力してください:
{
  "title": "...",
  "description": "...",
  "genre": "...",
  "priority": "S" | "A" | "B" | "C",
  "dueDate": "YYYY-MM-DD" | null,
  "dueTime": "HH:mm" | null,
  "isNoDate": boolean,
  "locationName": string | null
}

【入力テキスト】:
${text.trim()}`;

    const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    let rawResponse = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (res.ok) {
          const d = await res.json();
          rawResponse = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (rawResponse) break;
        }
      } catch (e: any) {
        console.warn(`parse-task model ${model} error:`, e.message);
      }
    }

    let parsed: any = null;
    if (rawResponse) {
      try {
        const cleaned = rawResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pErr) {
        console.warn('Failed to parse Gemini output:', pErr);
      }
    }

    if (!parsed || !parsed.title) {
      // フォールバック
      parsed = {
        title: text.trim(),
        description: '',
        genre: 'その他',
        priority: 'B',
        dueDate: null,
        dueTime: null,
        isNoDate: true,
        locationName: null,
      };
    }

    return NextResponse.json({ success: true, task: parsed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

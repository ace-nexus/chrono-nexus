import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';

export const maxDuration = 60;

function getTodayDateStr(): string {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().split('T')[0];
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, mimeType = 'image/jpeg', currentDate, availableGenres = [] } = body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json({ error: '画像データ（Base64）が必要です' }, { status: 400 });
    }

    const todayStr = currentDate || getTodayDateStr();
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini APIキーが設定されていません' }, { status: 500 });
    }

    // 不要なdata URLヘッダを除去（ある場合）
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z0-9+-]+;base64,/i, '');
    const genresList = availableGenres.length > 0 ? availableGenres.join('、') : '買い物、見積、その他';

    const prompt = `あなたは優秀な個人業務手帳秘書AIです。
提供された画像（手書きのメモ用紙、付箋、ホワイトボード、作業指示書、レシートなど）の文字を高精度にOCR解析し、書かれている「やること・タスク・メモ」を抽出してください。

【基準日（本日）】: ${todayStr}
【選択可能ジャンル】: ${genresList}

【判定ルール】
- スマホ撮影による多少の傾きや影、崩し字があっても柔軟に手書き文字を読み取ってください。
- 画像内に明確な「タスク」という表現がなくても、書かれている品名、現場名、数量、連絡先、ToDoをタスクとして認識してください。
- 1つの項目ごとにタスクオブジェクトを作成してください。
- title: やるべきことや品名（簡潔・明瞭に）
- description: 補足や寸法、型番、電話番号などの付随情報（あれば）
- genre: 選択可能ジャンルから最も適したもの（「コーナン」「買う」などは「買い物」、「見積」は「見積」、その他適切なもの）
- priority: 「至急」「急ぎ」「！」があれば "S" または "A"、通常は "B"、急ぎでなければ "C"
- dueDate: 期日の記載があれば YYYY-MM-DD（基準日を元に計算）。無ければ null
- isNoDate: dueDateがnullなら true
- locationName: 店名や現場名、訪問先が書かれていれば抽出

【出力形式】
必ず以下のJSON形式のみを出力してください（Markdownコードブロックや前置きは不要）:
{
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "genre": "...",
      "priority": "S" | "A" | "B" | "C",
      "dueDate": "YYYY-MM-DD" | null,
      "isNoDate": boolean,
      "locationName": string | null
    }
  ],
  "rawOcrText": "画像から読み取った手書き文字の全文"
}`;

    const candidateModels = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    let rawResponse = '';
    let lastError = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType: mimeType || 'image/jpeg',
                        data: cleanBase64,
                      },
                    },
                  ],
                },
              ],
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
        } else {
          const errText = await res.text();
          lastError = `Gemini API ${res.status}: ${errText}`;
        }
      } catch (e: any) {
        lastError = e.message;
        console.warn(`vision-tasks model ${model} error:`, e.message);
      }
    }

    let parsed: { tasks: any[]; rawOcrText?: string } = { tasks: [] };
    if (rawResponse) {
      try {
        const cleaned = rawResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pErr) {
        console.warn('Failed to parse Gemini Vision JSON:', pErr);
      }
    }

    // フォールバック: JSON配列としてタスクが取れなかったが何らかのテキストがある場合
    if ((!parsed.tasks || parsed.tasks.length === 0) && rawResponse) {
      const lines = rawResponse
        .split('\n')
        .map((l) => l.replace(/^[-*•0-9.)\s]+/, '').trim())
        .filter((l) => l && !l.startsWith('{') && !l.startsWith('}') && !l.includes('"tasks"'));

      if (lines.length > 0) {
        parsed.tasks = lines.slice(0, 5).map((line) => ({
          title: line.substring(0, 50),
          description: line.length > 50 ? line : '',
          genre: 'その他',
          priority: 'B',
          dueDate: null,
          isNoDate: true,
          locationName: null,
        }));
      }
    }

    if (!parsed.tasks || parsed.tasks.length === 0) {
      if (lastError) {
        return NextResponse.json({ error: `AI解析に失敗しました: ${lastError}` }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      tasks: parsed.tasks || [],
      rawOcrText: parsed.rawOcrText || '',
    });
  } catch (err: any) {
    console.error('Vision tasks error:', err);
    return NextResponse.json({ error: err.message || '内部エラー' }, { status: 500 });
  }
}

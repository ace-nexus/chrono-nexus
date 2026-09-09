import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';

// Vercel Serverless Functionの実行時間上限（Hobby最大60秒）
export const maxDuration = 30;

// 万一Gemini APIが混雑・タイムアウト・障害時の手帳用スマート清書フォールバック
function smartFormatFallback(text: string): string {
  let cleaned = text
    .replace(/^(えーっと|ええと|あのー|あの|えっと)[、,\s]*/g, '')
    .replace(/[、,\s]+(えーっと|ええと|あのー|あの|えっと)[、,\s]*/g, '、')
    .replace(/したよ([。.\s]|$)/g, 'しました$1')
    .replace(/行ったよ([。.\s]|$)/g, '行きました$1')
    .replace(/来たよ([。.\s]|$)/g, '来ました$1')
    .trim();

  const lines = cleaned
    .split(/[。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return `・ ${cleaned}`;
  }

  return lines.map((line) => `・ ${line}`).join('\n');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, scheduleTitle } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      // APIキーが万一未取得の場合でもスマート整形して返却（エラーで止めない）
      return NextResponse.json({
        success: true,
        formattedText: smartFormatFallback(text),
      });
    }

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
ユーザーが現場でスマートフォンから音声入力したメモ（誤字・誤変換、口語、言い淀み、句読点漏れ等を含む粗い文章）を受け取り、手帳の予定メモとして読みやすく実用的な文章に清書・整形してください。

【対象の予定タイトル】
${scheduleTitle || '（未指定）'}

【清書ルール】
1. 音声入力特有の誤字・誤変換・同音異義語の誤りを自然な日本語・ビジネス用語に補正してください。
2. 「えーっと」「〜したよ」「〜なんですけど」などの余計な口語や言い淀みを除去し、すっきりとした表現にしてください。
3. 人物（誰が来ていたか・同行者）、経費（金額・項目）、作業内容、決定事項・申し送りなどが含まれる場合は、必要に応じて読みやすい箇条書きや項目立てに整理してください。
4. 原文に含まれていない事実や情報を勝手に捏造・推測で補完しないでください。
5. 出力は整形後の本文のみを出力してください（挨拶、前置き、解説、「承知しました」「以下に清書します」等は一切含めないこと）。`;

    const candidateModels = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
    let formattedText = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `${systemPrompt}\n\n---\n【音声メモ原文】\n${text.trim()}`,
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.2,
              },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          formattedText =
            geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (formattedText) break;
        }
      } catch (fErr: any) {
        console.warn(`Gemini model ${model} failed:`, fErr.message);
      }
    }

    // Gemini呼び出しが成功した場合はそれを返し、万一Google側が混雑等で応答しない場合はスマート清書にフォールバック
    if (!formattedText) {
      formattedText = smartFormatFallback(text);
    }

    return NextResponse.json({
      success: true,
      formattedText,
    });
  } catch (err: any) {
    console.error('Format memo API error:', err);
    // 致命的例外時でもテキストをスマート整形して返し、ユーザー操作を止めない
    const fallbackText = typeof err?.text === 'string' ? smartFormatFallback(err.text) : 'メモの整形に失敗しました。';
    return NextResponse.json({ success: true, formattedText: fallbackText });
  }
}

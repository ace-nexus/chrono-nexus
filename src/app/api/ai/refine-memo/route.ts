import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/gemini';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { currentText, instruction, originalText } = body;

    if (!currentText || !instruction) {
      return NextResponse.json({ error: '現在のテキストと修正指示が必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return NextResponse.json({
        success: true,
        refinedText: currentText,
      });
    }

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
既に清書・整理された手帳の予定メモに対して、ユーザーから追加のカスタム修正要望がありました。
元のメモの事実関係や重要情報を損なわないよう配慮しながら、ユーザーの追加指示・意図を最優先かつ柔軟に反映して、さらに洗練された読みやすい手帳メモに再清書してください。

【ユーザーからの追加指示】
${instruction.trim()}

【再清書ルール】
1. ユーザーの指示（「もっと短く」「箇条書きにして」「金額を目立たせて」「敬語にして」など）を柔軟に忠実に実行してください。
2. 事実の捏造や原文にない新しい情報の勝手な追加は行わないでください。
3. 出力は再清書された本文のみを出力してください（「承知しました」「以下のように修正しました」等の前置き・解説・挨拶は一切含めないこと）。`;

    const candidateModels = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
    let refinedText = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);

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
                      text: `${systemPrompt}

---
【現在のメモ】
${currentText.trim()}${originalText ? `

【当初の音声原文】
${originalText.trim()}` : ''}`,
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
          refinedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (refinedText) break;
        }
      } catch (fErr: any) {
        console.warn(`Gemini model ${model} in refine-memo failed:`, fErr.message);
      }
    }

    if (!refinedText) {
      refinedText = currentText;
    }

    return NextResponse.json({
      success: true,
      refinedText,
    });
  } catch (err: any) {
    console.error('Refine memo API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
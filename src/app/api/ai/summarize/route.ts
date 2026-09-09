import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getGeminiApiKey } from '@/lib/gemini';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { noteId, rawInputId, textToSummarize } = body;

    if (!noteId || !textToSummarize) {
      return NextResponse.json({ error: 'noteId と textToSummarize が必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();
    let summaryContent = '';
    let modelName = 'gemini-flash-latest';

    if (apiKey) {
      // Gemini API を呼び出して要約・構造化
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `あなたは優秀な個人秘書AIです。以下の手帳の生メモや音声書き起こしを、オーナーが後から見返しやすいように【重要事項】【やったこと】【アクションアイテム（ToDo）】に整理・構造化して出力してください。\n\n---\nメモ内容:\n${textToSummarize}`,
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          summaryContent =
            geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
            'AI要約を取得できませんでした。';
        } else {
          throw new Error(`Gemini API error: ${geminiRes.status}`);
        }
      } catch (geminiErr: any) {
        console.warn('Gemini call failed, using rule-based formatter:', geminiErr);
        summaryContent = `【AI要約（暫定整形）】\n${textToSummarize
          .split('\n')
          .filter(Boolean)
          .map((line: string) => `・ ${line.trim()}`)
          .join('\n')}`;
      }
    } else {
      // APIキー未設定時のスマート箇条書き整形
      summaryContent = `【AI要約（ローカル整形）】\n${textToSummarize
        .split('\n')
        .filter(Boolean)
        .map((line: string) => `・ ${line.trim()}`)
        .join('\n')}\n\n※GEMINI_API_KEYを設定すると、Gemini 1.5 Flashによる自動要約が有効になります。`;
    }

    // Supabase の chrono_ai_summaries に保存（元入力とは別行で保持！）
    const { data: summaryItem, error } = await supabaseAdmin
      .from('chrono_ai_summaries')
      .insert({
        note_id: noteId,
        raw_input_id: rawInputId || null,
        summary_type: 'general',
        summary_content: summaryContent,
        model_name: modelName,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, summary: summaryItem });
  } catch (err: any) {
    console.error('AI Summarize API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
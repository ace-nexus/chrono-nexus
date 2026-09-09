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
    const { text, scheduleTitle, currentDate, currentDayOfWeek } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストが必要です' }, { status: 400 });
    }

    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      // APIキーが万一未取得の場合でもスマート整形して返却（エラーで止めない）
      return NextResponse.json({
        success: true,
        formattedText: smartFormatFallback(text),
        tasks: [],
      });
    }

    const todayStr = currentDate || new Date().toISOString().split('T')[0];
    const dayOfWeekStr = currentDayOfWeek || '';

    const systemPrompt = `あなたは優秀な個人業務手帳秘書AIです。
ユーザーが現場でスマートフォンから音声入力したメモ（誤字・誤変換、口語、言い淀み、句読点漏れ、乱雑な文章）を受け取り、手帳の予定メモとして読みやすく実用的な文章に清書・整形し、さらに今後のタスク・ToDoが含まれる場合は抽出してください。

【対象の予定タイトル】
${scheduleTitle || '（未指定）'}

【基準日時】
基準日: ${todayStr} ${dayOfWeekStr ? `(${dayOfWeekStr})` : ''}

【指示1：文章の清書・ひも解き（formattedText）】
1. 音声入力特有の誤字・誤変換・同音異義語の誤りを自然な日本語・正しいビジネス用語に補正してください。
2. 「えーっと」「〜したよ」「〜なんですけど」などの余計な口語や言い淀みを除去し、すっきりとした表現にしてください。
3. 箇条書きにした方が分かりやすい場合は積極的に箇条書き（・）を活用してください。
4. 主語や述語が乱れていたり、分かりにくい・散らかった文章ならば、意味を正確に保ちながら誰が読んでも一目で伝わるように分かりやすくひも解いて整理してください。
5. 参加者・同行者、経費・金額、作業内容、決定事項・申し送りなどが含まれる場合は、必要に応じて見やすい項目立てや箇条書きに整理してください。
6. 原文に含まれていない事実や情報を勝手に捏造・推測で補完しないでください。

【指示2：タスク・ToDoの抽出（tasks）】
メモの中に、今後やるべきタスク、提出物、連絡・電話、次回アクション、持ち物準備などが含まれている場合、それらを抽出してください。
- タイトル（title）は具体的かつ簡潔なアクション形式（例：「A社に見積書を送付」「現場工具を補充」など）にしてください。
- メモ内に「明日」「明後日」「来週月曜」「週末」「15日」「午後3時」などの日時表現があれば、基準日（${todayStr}）をもとに正確な西暦日付（YYYY-MM-DD）に換算して date に設定してください。
- 時間の言及がある場合は startTime（HH:mm形式、例: "14:00"）を設定し、言及がない・終日と判断できる場合は isAllDay: true としてください。
- 相対日程の言及がなく単に「今後やる」「次回までに」という場合は、基準日または翌日を date に設定し isAllDay: true にしてください。
- タスクがメモ内に一切含まれていない場合は空配列 [] を返してください。

【出力形式】
必ず以下のJSON形式のオブジェクトのみを出力してください（Markdownの装飾や前置き、解説は一切不要です）。
{
  "formattedText": "清書・整形された読みやすい本文（改行や箇条書き含む）",
  "tasks": [
    {
      "title": "タスクのタイトル",
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm" または null,
      "isAllDay": true または false
    }
  ]
}`;

    const candidateModels = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
    let rawResponse = '';

    for (const model of candidateModels) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000); // 9秒タイムアウト

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
                responseMimeType: 'application/json',
              },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          rawResponse =
            geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (rawResponse) break;
        }
      } catch (fErr: any) {
        console.warn(`Gemini model ${model} failed:`, fErr.message);
      }
    }

    let formattedText = '';
    let tasks: any[] = [];

    if (rawResponse) {
      try {
        // バッククォート囲み（```json ... ```）がある場合の除去
        const cleanedJson = rawResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);
        if (typeof parsed.formattedText === 'string') {
          formattedText = parsed.formattedText.trim();
        }
        if (Array.isArray(parsed.tasks)) {
          tasks = parsed.tasks.map((t: any, i: number) => ({
            id: `task-${Date.now()}-${i}`,
            title: String(t.title || '').trim(),
            date: String(t.date || todayStr).trim(),
            startTime: t.startTime ? String(t.startTime).trim() : null,
            isAllDay: t.isAllDay !== false,
          })).filter((t: any) => t.title.length > 0);
        }
      } catch (pErr) {
        console.warn('Failed to parse Gemini JSON output:', pErr);
        formattedText = rawResponse;
      }
    }

    // Gemini呼び出しが不発だった場合はスマート清書にフォールバック
    if (!formattedText) {
      formattedText = smartFormatFallback(text);
    }

    return NextResponse.json({
      success: true,
      formattedText,
      tasks,
    });
  } catch (err: any) {
    console.error('Format memo API error:', err);
    const fallbackText = typeof err?.text === 'string' ? smartFormatFallback(err.text) : 'メモの整形に失敗しました。';
    return NextResponse.json({ success: true, formattedText: fallbackText, tasks: [] });
  }
}

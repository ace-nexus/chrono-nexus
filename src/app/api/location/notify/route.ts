import { NextResponse } from 'next/server';

// LINE Messaging API を使用した途絶え通知送信エンドポイント
// 環境変数 LINE_CHANNEL_ACCESS_TOKEN および LINE_USER_ID を利用
export async function POST(req: Request) {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = process.env.LINE_USER_ID;

    if (!token || !userId) {
      return NextResponse.json(
        {
          success: false,
          configured: false,
          message: 'LINE通知設定（LINE_CHANNEL_ACCESS_TOKEN または LINE_USER_ID）が未設定です。',
        },
        { status: 200 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const messageText =
      body.message ||
      '⚠️ 【Chrono Nexus】OwnTracksの位置情報記録が途絶えています。\nスマホのOwnTracksアプリがバックグラウンドで停止しているか、通信がオフになっている可能性があります。アプリをご確認ください。';

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [
          {
            type: 'text',
            text: messageText,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errData = await res.text();
      console.error('LINE push message error:', errData);
      return NextResponse.json({ success: false, error: errData }, { status: res.status });
    }

    return NextResponse.json({ success: true, message: 'LINE通知を正常に送信しました。' });
  } catch (error: any) {
    console.error('LINE notify error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET: 現在のLINE通知設定状況の確認
export async function GET() {
  const isConfigured = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID);
  return NextResponse.json({
    configured: isConfigured,
    message: isConfigured
      ? 'LINE通知は有効化されています。'
      : 'LINE通知は未設定です。.env.local に LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID を設定してください。',
  });
}

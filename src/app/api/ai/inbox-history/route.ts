import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET: 振り分け履歴一覧取得
export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('raw_payload')
      .eq('user_id', 'chrono_ai_inbox_logs')
      .maybeSingle();

    const logs = (data?.raw_payload?.logs && Array.isArray(data.raw_payload.logs))
      ? data.raw_payload.logs
      : [];

    return NextResponse.json({ success: true, logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 履歴ログの削除または登録項目の取消
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const logId = searchParams.get('id');

    if (!logId) {
      return NextResponse.json({ error: 'ログIDが必要です' }, { status: 400 });
    }

    const { data } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('raw_payload')
      .eq('user_id', 'chrono_ai_inbox_logs')
      .maybeSingle();

    const logs = (data?.raw_payload?.logs && Array.isArray(data.raw_payload.logs))
      ? data.raw_payload.logs
      : [];

    const updated = logs.filter((l: any) => l.id !== logId);

    await supabaseAdmin
      .from('chrono_google_tokens')
      .upsert({
        user_id: 'chrono_ai_inbox_logs',
        raw_payload: { logs: updated },
        access_token: 'dummy',
        refresh_token: 'dummy',
      });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
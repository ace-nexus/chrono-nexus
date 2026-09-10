import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const INBOX_LOGS_SOURCE = 'chrono_ai_inbox_logs';
const INBOX_LOGS_EXTERNAL_ID = 'ai_inbox_logs';

// GET: 振り分け履歴一覧取得
export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('raw_payload')
      .eq('source', INBOX_LOGS_SOURCE)
      .maybeSingle();

    const logs = (data?.raw_payload?.logs && Array.isArray(data.raw_payload.logs))
      ? data.raw_payload.logs
      : [];

    return NextResponse.json({ success: true, logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 履歴ログの削除
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const logId = searchParams.get('id');

    if (!logId) {
      return NextResponse.json({ error: 'ログIDが必要です' }, { status: 400 });
    }

    const { data } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('id, raw_payload')
      .eq('source', INBOX_LOGS_SOURCE)
      .maybeSingle();

    const logs = (data?.raw_payload?.logs && Array.isArray(data.raw_payload.logs))
      ? data.raw_payload.logs
      : [];

    const updated = logs.filter((l: any) => l.id !== logId);

    if (data?.id) {
      await supabaseAdmin
        .from('chrono_schedule_events')
        .update({
          raw_payload: { logs: updated },
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
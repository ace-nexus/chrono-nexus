import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const userId = searchParams.get('userId') || 'owner';

    if (!query.trim()) {
      // 直近のノート一覧をツリー用に返す
      const { data: recentNotes } = await supabaseAdmin
        .from('chrono_daily_notes')
        .select('id, date, title')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(30);

      const { data: tags } = await supabaseAdmin.from('chrono_tags').select('*');

      return NextResponse.json({ notes: recentNotes || [], tags: tags || [] });
    }

    // 全文検索: 生メモとAI要約からキーワード一致を検索
    const [rawRes, summaryRes, actRes] = await Promise.all([
      supabaseAdmin
        .from('chrono_raw_inputs')
        .select('id, note_id, content, input_type, recorded_at')
        .ilike('content', `%${query}%`)
        .limit(20),
      supabaseAdmin
        .from('chrono_ai_summaries')
        .select('id, note_id, summary_content, created_at')
        .ilike('summary_content', `%${query}%`)
        .limit(20),
      supabaseAdmin
        .from('chrono_activity_logs')
        .select('id, note_id, title, location_name, created_at')
        .ilike('title', `%${query}%`)
        .limit(20),
    ]);

    return NextResponse.json({
      rawInputs: rawRes.data || [],
      summaries: summaryRes.data || [],
      activities: actRes.data || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
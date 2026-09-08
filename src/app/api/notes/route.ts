import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET: 指定日付のデイリーノート情報（予定・実績・生メモ・AI要約・位置）を一括取得
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const userId = searchParams.get('userId') || 'owner';

    // 1. ノートの取得（なければ作成）
    let { data: note, error: noteErr } = await supabaseAdmin
      .from('chrono_daily_notes')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();

    if (noteErr) {
      return NextResponse.json({ error: noteErr.message }, { status: 500 });
    }

    if (!note) {
      const { data: newNote, error: createErr } = await supabaseAdmin
        .from('chrono_daily_notes')
        .insert({
          user_id: userId,
          date,
          title: `${date} の手帳`,
        })
        .select()
        .single();

      if (createErr) {
        return NextResponse.json({ error: createErr.message }, { status: 500 });
      }
      note = newNote;
    }

    const noteId = note.id;

    // 2. 予定・実績・生入力・AI要約を並列取得
    const [scheduleRes, activityRes, rawInputRes, summaryRes, tracksRes] = await Promise.all([
      supabaseAdmin.from('chrono_schedule_events').select('*').eq('note_id', noteId).order('start_time'),
      supabaseAdmin.from('chrono_activity_logs').select('*').eq('note_id', noteId).order('created_at'),
      supabaseAdmin.from('chrono_raw_inputs').select('*').eq('note_id', noteId).order('recorded_at'),
      supabaseAdmin.from('chrono_ai_summaries').select('*').eq('note_id', noteId).order('created_at'),
      supabaseAdmin
        .from('chrono_location_tracks')
        .select('*')
        .gte('recorded_at', `${date}T00:00:00.000Z`)
        .lte('recorded_at', `${date}T23:59:59.999Z`)
        .order('recorded_at', { ascending: true }),
    ]);

    return NextResponse.json({
      note,
      scheduleEvents: scheduleRes.data || [],
      activityLogs: activityRes.data || [],
      rawInputs: rawInputRes.data || [],
      aiSummaries: summaryRes.data || [],
      locationTracks: tracksRes.data || [],
    });
  } catch (err: any) {
    console.error('Notes API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 生メモや実績・予定の追加・保存
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, noteId, data } = body;

    if (!noteId) {
      return NextResponse.json({ error: 'noteIdが必要です' }, { status: 400 });
    }

    if (action === 'add_raw_input') {
      const { inputType, content, durationSeconds, fileSize } = data;
      const { data: raw, error } = await supabaseAdmin
        .from('chrono_raw_inputs')
        .insert({
          note_id: noteId,
          input_type: inputType,
          content,
          duration_seconds: durationSeconds || null,
          file_size_bytes: fileSize || null,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: raw });
    }

    if (action === 'add_activity') {
      const { title, startTime, endTime, locationName } = data;
      const { data: act, error } = await supabaseAdmin
        .from('chrono_activity_logs')
        .insert({
          note_id: noteId,
          title,
          start_time: startTime || null,
          end_time: endTime || null,
          location_name: locationName || null,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: act });
    }

    if (action === 'add_schedule') {
      const { title, startTime, endTime, location } = data;
      const { data: sc, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .insert({
          note_id: noteId,
          title,
          start_time: startTime || new Date().toISOString(),
          end_time: endTime || null,
          location: location || null,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: sc });
    }

    return NextResponse.json({ error: '不明なアクションです' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
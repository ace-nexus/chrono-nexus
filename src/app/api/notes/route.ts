import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET: 指定日付のデイリーノート情報（予定・実績・生メモ・AI要約・位置）を一括取得
// または年月（year, month）が指定された場合は月間サマリー（予定・記録がある日のリスト）を取得
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');
    const userId = searchParams.get('userId') || 'owner';

    // ── 月間サマリーモード（カレンダー表示用） ──
    if (mode === 'month') {
      const year = searchParams.get('year') || new Date().getFullYear().toString();
      const month = searchParams.get('month') || (new Date().getMonth() + 1).toString().padStart(2, '0');
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      const lastDay = new Date(y, m, 0).getDate();
      const lastDayStr = lastDay.toString().padStart(2, '0');
      const start = `${year}-${month}-01`;
      const end = `${year}-${month}-${lastDayStr}`;

      // タイムゾーンによる月初・月末の境界ズレ（JST +9h）を完全にカバーするバッファ範囲
      const queryStartUtc = new Date(y, m - 1, 1, -12, 0, 0).toISOString();
      const queryEndUtc = new Date(y, m, 1, 12, 0, 0).toISOString();

      const [notesRes, schedulesRes] = await Promise.all([
        supabaseAdmin
          .from('chrono_daily_notes')
          .select('id, date, title')
          .eq('user_id', userId)
          .gte('date', start)
          .lte('date', end),
        supabaseAdmin
          .from('chrono_schedule_events')
          .select('id, note_id, title, start_time, end_time, raw_payload')
          .lte('start_time', queryEndUtc)
          .or(`end_time.gte.${queryStartUtc},end_time.is.null,start_time.gte.${queryStartUtc}`),
      ]);

      return NextResponse.json({
        notes: notesRes.data || [],
        schedules: schedulesRes.data || [],
      });
    }

    // ── 日次ノート取得モード ──
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const dayStartUtc = new Date(`${date}T00:00:00+09:00`).toISOString();
    const dayEndUtc = new Date(`${date}T23:59:59.999+09:00`).toISOString();

    // 1. ノートの取得（なければ自動作成）
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

    // 2. 予定・実績・生入力・AI要約・位置情報を並列取得
    const [scheduleRes, activityRes, rawInputRes, summaryRes, tracksRes] = await Promise.all([
      supabaseAdmin
        .from('chrono_schedule_events')
        .select('*')
        .or(`note_id.eq.${noteId},and(start_time.lte.${dayEndUtc},end_time.gte.${dayStartUtc})`)
        .order('start_time'),
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

// POST: 生メモや実績・予定の追加・削除
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, noteId, data, id } = body;

    // ── 削除アクション ──
    if (action === 'delete_schedule') {
      const { error } = await supabaseAdmin.from('chrono_schedule_events').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, deletedId: id });
    }

    if (action === 'delete_activity') {
      const { error } = await supabaseAdmin.from('chrono_activity_logs').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, deletedId: id });
    }

    if (action === 'delete_raw_input') {
      const { error } = await supabaseAdmin.from('chrono_raw_inputs').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, deletedId: id });
    }

    // ── 更新アクション（各レコードの id で更新するため noteId 不要） ──
    if (action === 'update_raw_input') {
      const { id, content } = data;
      if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_raw_inputs')
        .update({
          content,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === 'update_activity') {
      const { id, title, startTime, endTime, locationName } = data;
      if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const updateData: any = {
        title,
        updated_at: new Date().toISOString(),
      };
      if (startTime !== undefined) updateData.start_time = startTime || null;
      if (endTime !== undefined) updateData.end_time = endTime || null;
      if (locationName !== undefined) updateData.location_name = locationName || null;

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_activity_logs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === 'update_schedule') {
      const { id, title, startTime, endTime, location, color, isAllDay, isCompleted } = data;
      if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const updateData: any = {
        title,
        start_time: startTime,
        end_time: endTime || null,
        location: location || null,
        raw_payload: {
          color: color || null,
          isAllDay: !!isAllDay,
          isCompleted: isCompleted !== undefined ? !!isCompleted : false,
        },
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    // ── 追加アクション（noteId 必須） ──
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
      const { title, startTime, endTime, location, color, isAllDay, isCompleted } = data;
      const { data: sc, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .insert({
          note_id: noteId,
          title,
          start_time: startTime || new Date().toISOString(),
          end_time: endTime || null,
          location: location || null,
          raw_payload: {
            color: color || null,
            isAllDay: !!isAllDay,
            isCompleted: !!isCompleted,
          },
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
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export interface SearchResultItem {
  id: string;
  source: 'calendar' | 'task' | 'memo' | 'activity';
  sourceLabel: string;
  sourceBadgeColor: string; // Tailwind color class
  date: string; // "YYYY-MM-DD"
  title: string;
  snippet: string;
  noteId?: string;
  rawPayload?: any;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get('q') || '').trim();
    const userId = searchParams.get('userId') || 'owner';

    if (!query) {
      // 直近のノート一覧を返す
      const { data: recentNotes } = await supabaseAdmin
        .from('chrono_daily_notes')
        .select('id, date, title')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(20);

      return NextResponse.json({ success: true, items: [], recentNotes: recentNotes || [] });
    }

    // 1. カレンダー予定 ＆ タスクの検索（chrono_schedule_events）
    // 2. デイリー生メモの検索（chrono_raw_inputs）
    // 3. 実績行動ログの検索（chrono_activity_logs）
    const [eventsRes, rawRes, actRes] = await Promise.all([
      supabaseAdmin
        .from('chrono_schedule_events')
        .select('id, note_id, title, description, start_time, location, source, raw_payload')
        .or(`title.ilike.%${query}%,description.ilike.%${query}%,location.ilike.%${query}%`)
        .limit(30),
      supabaseAdmin
        .from('chrono_raw_inputs')
        .select('id, note_id, content, input_type, recorded_at')
        .ilike('content', `%${query}%`)
        .limit(30),
      supabaseAdmin
        .from('chrono_activity_logs')
        .select('id, note_id, title, location_name, start_time, created_at')
        .or(`title.ilike.%${query}%,location_name.ilike.%${query}%`)
        .limit(30),
    ]);

    // 全ヒットアイテムの note_id を収集して日付を引く
    const noteIdSet = new Set<string>();
    (eventsRes.data || []).forEach((r) => r.note_id && noteIdSet.add(r.note_id));
    (rawRes.data || []).forEach((r) => r.note_id && noteIdSet.add(r.note_id));
    (actRes.data || []).forEach((r) => r.note_id && noteIdSet.add(r.note_id));

    const noteDateMap = new Map<string, string>();
    if (noteIdSet.size > 0) {
      const { data: notesData } = await supabaseAdmin
        .from('chrono_daily_notes')
        .select('id, date')
        .in('id', Array.from(noteIdSet));
      (notesData || []).forEach((n) => noteDateMap.set(n.id, n.date));
    }

    const items: SearchResultItem[] = [];

    // 1. カレンダー予定 ＆ タスク
    (eventsRes.data || []).forEach((r) => {
      const isTask = r.source === 'chrono_task' || Boolean(r.raw_payload?.is_task);
      const schDate = noteDateMap.get(r.note_id) || (r.start_time ? r.start_time.split('T')[0] : '日付未定');
      const memoText = r.raw_payload?.memo || r.description || '';

      if (isTask) {
        items.push({
          id: r.id,
          source: 'task',
          sourceLabel: `タスク (${r.raw_payload?.genre || 'その他'})`,
          sourceBadgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
          date: r.raw_payload?.due_date || schDate,
          title: r.title,
          snippet: memoText || r.location || '',
          noteId: r.note_id,
          rawPayload: r.raw_payload,
        });
      } else {
        items.push({
          id: r.id,
          source: 'calendar',
          sourceLabel: 'カレンダー予定',
          sourceBadgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
          date: schDate,
          title: r.title,
          snippet: [r.location, memoText].filter(Boolean).join(' / '),
          noteId: r.note_id,
          rawPayload: r.raw_payload,
        });
      }
    });

    // 2. 生メモ
    (rawRes.data || []).forEach((r) => {
      const mDate = noteDateMap.get(r.note_id) || (r.recorded_at ? r.recorded_at.split('T')[0] : '日付未定');
      const text = (r.content || '').trim();
      const firstLine = text.split('\n')[0].slice(0, 40);
      items.push({
        id: r.id,
        source: 'memo',
        sourceLabel: 'デイリー生メモ',
        sourceBadgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        date: mDate,
        title: firstLine || 'メモ',
        snippet: text.length > 40 ? text.slice(0, 100) + '...' : text,
        noteId: r.note_id,
      });
    });

    // 3. 実績ログ
    (actRes.data || []).forEach((r) => {
      const aDate = noteDateMap.get(r.note_id) || (r.created_at ? r.created_at.split('T')[0] : '日付未定');
      items.push({
        id: r.id,
        source: 'activity',
        sourceLabel: '実績行動ログ',
        sourceBadgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
        date: aDate,
        title: r.title,
        snippet: r.location_name || '',
        noteId: r.note_id,
      });
    });

    // 日付降順でソート
    items.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({
      success: true,
      query,
      count: items.length,
      items,
    });
  } catch (err: any) {
    console.error('Search API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
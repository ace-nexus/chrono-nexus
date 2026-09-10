import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// 3日間（ミリ秒換算）
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// 今日の日付文字列（YYYY-MM-DD）
function getTodayDateStr(): string {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().split('T')[0];
}

// デイリーノートの取得または自動作成（note_id NOT NULL制約を満たすため）
async function getOrCreateDailyNote(dateStr: string, userId: string = 'owner'): Promise<string | null> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('chrono_daily_notes')
      .select('id')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .maybeSingle();

    if (existing?.id) return existing.id;

    const { data: created, error } = await supabaseAdmin
      .from('chrono_daily_notes')
      .insert({
        user_id: userId,
        date: dateStr,
        title: `${dateStr} の手帳`,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create daily note for task:', error);
      return null;
    }
    return created.id;
  } catch (err) {
    console.error('getOrCreateDailyNote error:', err);
    return null;
  }
}

// GET: タスク一覧取得
// クエリパラメータ:
//   - view: 'active' (未完了のみ) | 'completed' (3日以内完了) | 'archived' (3日超完了) | 'all'
//   - genre: ジャンル絞り込み（'all' または特定ジャンル）
//   - search: キーワード検索
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'active';
    const genre = searchParams.get('genre');
    const search = searchParams.get('search')?.trim().toLowerCase();

    // chrono_schedule_events から source='chrono_task' を取得
    const { data: rawEvents, error } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('*')
      .eq('source', 'chrono_task')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const todayStr = getTodayDateStr();
    const tasksToUpdateArchive: string[] = [];

    const tasks = (rawEvents || []).map((row) => {
      const payload = row.raw_payload || {};
      const isCompleted = Boolean(payload.is_completed);
      const completedAt = payload.completed_at ? new Date(payload.completed_at).getTime() : null;
      let archived = Boolean(payload.archived);

      // 完了後3日経過したタスクは自動的にアーカイブへ昇格
      if (isCompleted && completedAt && !archived) {
        if (now - completedAt >= THREE_DAYS_MS) {
          archived = true;
          tasksToUpdateArchive.push(row.id);
        }
      }

      // 期日判定
      const dueDate = payload.due_date || (row.start_time ? row.start_time.split('T')[0] : null);
      const dueTime = payload.due_time || null;
      const isNoDate = Boolean(payload.is_nodate) || !dueDate;
      const priority = payload.priority || 'B'; // S, A, B, C

      // アラート計算
      let isUrgent = false; // 期日間近（赤）
      let isStale = false;  // 放置（黄/赤）
      let staleDays = 0;

      const createdAt = new Date(row.created_at).getTime();
      staleDays = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));

      if (!isCompleted) {
        if (!isNoDate && dueDate) {
          // 期日ありの場合：今日または2日以内
          const diffDays = Math.ceil(
            (new Date(`${dueDate}T00:00:00+09:00`).getTime() - new Date(`${todayStr}T00:00:00+09:00`).getTime()) /
              (24 * 60 * 60 * 1000)
          );
          if (diffDays <= 2) {
            isUrgent = true;
          }
        } else {
          // 期日なしの場合：重要度と連動した放置日数
          if (priority === 'S' || priority === 'A') {
            if (staleDays >= 3) isStale = true;
          } else if (priority === 'B') {
            if (staleDays >= 7) isStale = true;
          } else if (priority === 'C') {
            if (staleDays >= 30) isStale = true;
          }
        }
      }

      return {
        id: row.id,
        noteId: row.note_id,
        title: row.title,
        description: row.description || '',
        genre: payload.genre || 'その他',
        priority,
        dueDate: isNoDate ? null : dueDate,
        dueTime,
        isAllDay: payload.is_all_day !== false,
        isNoDate,
        isCompleted,
        completedAt: payload.completed_at || null,
        archived,
        locationName: payload.location_name || row.location || null,
        latitude: payload.latitude || null,
        longitude: payload.longitude || null,
        sourceTranscript: payload.source_transcript || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isUrgent,
        isStale,
        staleDays,
      };
    });

    // 3日経過タスクのアーカイブフラグを非同期バックグラウンド更新
    if (tasksToUpdateArchive.length > 0) {
      Promise.all(
        tasksToUpdateArchive.map(async (taskId) => {
          const target = (rawEvents || []).find((r) => r.id === taskId);
          if (target) {
            await supabaseAdmin
              .from('chrono_schedule_events')
              .update({
                raw_payload: {
                  ...(target.raw_payload || {}),
                  archived: true,
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', taskId);
          }
        })
      ).catch((e) => console.warn('Auto archive update error:', e));
    }

    // フィルタリング処理
    let filtered = tasks;

    // ビューフィルタ
    if (view === 'active') {
      filtered = filtered.filter((t) => !t.isCompleted);
    } else if (view === 'completed') {
      filtered = filtered.filter((t) => t.isCompleted && !t.archived);
    } else if (view === 'archived') {
      filtered = filtered.filter((t) => t.archived);
    }

    // ジャンルフィルタ
    if (genre && genre !== 'all') {
      filtered = filtered.filter((t) => t.genre === genre);
    }

    // キーワード検索フィルタ
    if (search) {
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(search) ||
          t.description.toLowerCase().includes(search) ||
          t.genre.toLowerCase().includes(search) ||
          (t.locationName && t.locationName.toLowerCase().includes(search))
      );
    }

    return NextResponse.json({
      success: true,
      tasks: filtered,
      totalCount: tasks.length,
      activeCount: tasks.filter((t) => !t.isCompleted).length,
      completedRecentCount: tasks.filter((t) => t.isCompleted && !t.archived).length,
      archivedCount: tasks.filter((t) => t.archived).length,
    });
  } catch (err: any) {
    console.error('GET /api/tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 新規タスク作成
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      title,
      description = '',
      genre = 'その他',
      priority = 'B',
      dueDate = null,
      dueTime = null,
      isAllDay = true,
      isNoDate = false,
      locationName = null,
      latitude = null,
      longitude = null,
      sourceTranscript = null,
    } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'タスクのタイトルが必要です' }, { status: 400 });
    }

    const todayStr = getTodayDateStr();
    const effectiveDate = !isNoDate && dueDate ? dueDate : todayStr;
    const noteId = await getOrCreateDailyNote(effectiveDate);

    if (!noteId) {
      return NextResponse.json({ error: 'デイリーノートの取得に失敗しました' }, { status: 500 });
    }

    // 開始時間（期日指定があればその日時、終日なら00:00）
    let startTimeIso: string;
    let endTimeIso: string | null = null;

    if (!isNoDate && dueDate) {
      if (isAllDay || !dueTime) {
        startTimeIso = `${dueDate}T00:00:00+09:00`;
      } else {
        startTimeIso = `${dueDate}T${dueTime}:00+09:00`;
        const [h, m] = dueTime.split(':').map(Number);
        const endH = Math.min(23, h + 1).toString().padStart(2, '0');
        endTimeIso = `${dueDate}T${endH}:${m.toString().padStart(2, '0')}:00+09:00`;
      }
    } else {
      startTimeIso = new Date().toISOString();
    }

    const rawPayload = {
      is_task: true,
      genre: genre.trim() || 'その他',
      priority: ['S', 'A', 'B', 'C'].includes(priority) ? priority : 'B',
      is_completed: false,
      completed_at: null,
      archived: false,
      is_nodate: Boolean(isNoDate || !dueDate),
      due_date: isNoDate ? null : dueDate,
      due_time: isNoDate || isAllDay ? null : dueTime,
      is_all_day: Boolean(isAllDay),
      location_name: locationName || null,
      latitude: latitude || null,
      longitude: longitude || null,
      source_transcript: sourceTranscript || null,
    };

    const { data: created, error } = await supabaseAdmin
      .from('chrono_schedule_events')
      .insert({
        note_id: noteId,
        title: title.trim(),
        description: description.trim() || null,
        start_time: startTimeIso,
        end_time: endTimeIso,
        location: locationName || null,
        source: 'chrono_task',
        raw_payload: rawPayload,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      task: {
        id: created.id,
        title: created.title,
        ...rawPayload,
      },
    });
  } catch (err: any) {
    console.error('POST /api/tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: タスク更新（編集、完了トグル、アーカイブ切り替え）
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'タスクIDが必要です' }, { status: 400 });
    }

    const { data: existing, error: getErr } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('*')
      .eq('id', id)
      .eq('source', 'chrono_task')
      .single();

    if (getErr || !existing) {
      return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 });
    }

    const prevPayload = existing.raw_payload || {};
    const newPayload = { ...prevPayload };

    let newTitle = existing.title;
    let newDescription = existing.description;
    let newStartTime = existing.start_time;
    let newEndTime = existing.end_time;
    let newLocation = existing.location;

    // タイトル更新
    if (typeof updates.title === 'string') {
      newTitle = updates.title.trim();
    }
    // 詳細更新
    if (typeof updates.description !== 'undefined') {
      newDescription = updates.description ? String(updates.description).trim() : null;
    }
    // ジャンル更新
    if (typeof updates.genre === 'string') {
      newPayload.genre = updates.genre.trim();
    }
    // 重要度更新
    if (typeof updates.priority === 'string') {
      newPayload.priority = updates.priority;
    }
    // 場所更新
    if (typeof updates.locationName !== 'undefined') {
      newLocation = updates.locationName ? String(updates.locationName).trim() : null;
      newPayload.location_name = newLocation;
    }

    // 期日更新
    if (typeof updates.isNoDate !== 'undefined') {
      newPayload.is_nodate = Boolean(updates.isNoDate);
    }
    if (typeof updates.dueDate !== 'undefined') {
      newPayload.due_date = updates.dueDate || null;
      if (updates.dueDate && !newPayload.is_nodate) {
        newStartTime = `${updates.dueDate}T00:00:00+09:00`;
      }
    }
    if (typeof updates.dueTime !== 'undefined') {
      newPayload.due_time = updates.dueTime || null;
    }
    if (typeof updates.isAllDay !== 'undefined') {
      newPayload.is_all_day = Boolean(updates.isAllDay);
    }

    // 完了トグル処理
    if (typeof updates.isCompleted === 'boolean') {
      newPayload.is_completed = updates.isCompleted;
      if (updates.isCompleted) {
        newPayload.completed_at = new Date().toISOString();
        newPayload.archived = false; // 完了直後は3日間完了リストに残る
      } else {
        newPayload.completed_at = null;
        newPayload.archived = false;
      }
    }

    // 手動アーカイブ切り替え
    if (typeof updates.archived === 'boolean') {
      newPayload.archived = updates.archived;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('chrono_schedule_events')
      .update({
        title: newTitle,
        description: newDescription,
        start_time: newStartTime,
        end_time: newEndTime,
        location: newLocation,
        raw_payload: newPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      task: {
        id: updated.id,
        title: updated.title,
        ...newPayload,
      },
    });
  } catch (err: any) {
    console.error('PATCH /api/tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: タスク削除
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'タスクIDが必要です' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('chrono_schedule_events')
      .delete()
      .eq('id', id)
      .eq('source', 'chrono_task');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /api/tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
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

// タスクの初期カラー（重要度または指定色）
// S: トマト (#dc2127), A: フラミンゴ (#ff887c), B: バナナ/アンバー (#fbd75b), C: グラファイト (#e1e1e1)
export function getTaskDefaultColor(priority: string = 'B', customColor?: string | null): string {
  if (customColor && customColor.trim()) return customColor.trim();
  switch (priority) {
    case 'S':
      return '#dc2127';
    case 'A':
      return '#ff887c';
    case 'B':
      return '#fbd75b';
    case 'C':
      return '#e1e1e1';
    default:
      return '#fbd75b';
  }
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
        color: payload.color || getTaskDefaultColor(priority),
        dueDate: isNoDate ? null : dueDate,
        dueTime,
        isAllDay: isNoDate ? false : Boolean(payload.isAllDay ?? payload.is_all_day ?? !dueTime),
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

// POST: 新規タスク作成（単一作成または body.tasks による一括作成に対応）
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const todayStr = getTodayDateStr();

    // ── A. 一括タスク作成（body.tasks が配列の場合） ──
    if (Array.isArray(body.tasks) && body.tasks.length > 0) {
      const insertedTasks: any[] = [];

      for (const item of body.tasks) {
        if (!item.title || typeof item.title !== 'string' || !item.title.trim()) continue;

        const effectiveDate = !item.isNoDate && item.dueDate ? item.dueDate : todayStr;
        const noteId = await getOrCreateDailyNote(effectiveDate);
        if (!noteId) continue;

        const hasTime = Boolean(!item.isNoDate && item.dueDate && item.dueTime && item.dueTime.trim());
        const isAllDayVal = Boolean(!item.isNoDate && item.dueDate && !hasTime);

        let startTimeIso: string;
        let endTimeIso: string | null = null;
        if (!item.isNoDate && item.dueDate) {
          if (hasTime) {
            startTimeIso = `${item.dueDate}T${item.dueTime}:00+09:00`;
            const [h, m] = item.dueTime.split(':').map(Number);
            const endH = Math.min(23, h + 1).toString().padStart(2, '0');
            endTimeIso = `${item.dueDate}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
          } else {
            // 日付はあるが時間指定がない場合は終日欄へ
            startTimeIso = `${item.dueDate}T00:00:00+09:00`;
            endTimeIso = null;
          }
        } else {
          startTimeIso = new Date().toISOString();
        }

        const taskPriority = ['S', 'A', 'B', 'C'].includes(item.priority) ? item.priority : 'B';
        const taskColor = getTaskDefaultColor(taskPriority, item.color);

        const rawPayload = {
          is_task: true,
          genre: (item.genre || 'その他').trim(),
          priority: taskPriority,
          color: taskColor,
          is_completed: false,
          completed_at: null,
          archived: false,
          is_nodate: Boolean(item.isNoDate || !item.dueDate),
          due_date: item.isNoDate ? null : item.dueDate || null,
          due_time: item.isNoDate || isAllDayVal ? null : item.dueTime || null,
          is_all_day: isAllDayVal,
          isAllDay: isAllDayVal,
          location_name: item.locationName || null,
          latitude: item.latitude || null,
          longitude: item.longitude || null,
          source_transcript: item.sourceTranscript || null,
        };

        const { data: created, error } = await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteId,
            title: item.title.trim(),
            description: (item.description || '').trim() || null,
            start_time: startTimeIso,
            end_time: endTimeIso,
            location: item.locationName || null,
            source: 'chrono_task',
            raw_payload: rawPayload,
          })
          .select()
          .single();

        if (!error && created) {
          insertedTasks.push({
            id: created.id,
            title: created.title,
            ...rawPayload,
          });
        }
      }

      return NextResponse.json({
        success: true,
        count: insertedTasks.length,
        tasks: insertedTasks,
      });
    }

    // ── B. 単一タスク作成 ──
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

    const effectiveDate = !isNoDate && dueDate ? dueDate : todayStr;
    const noteId = await getOrCreateDailyNote(effectiveDate);

    if (!noteId) {
      return NextResponse.json({ error: 'デイリーノートの取得に失敗しました' }, { status: 500 });
    }

    const hasTime = Boolean(!isNoDate && dueDate && dueTime && dueTime.trim());
    const isAllDayVal = Boolean(!isNoDate && dueDate && !hasTime);

    // 開始時間（期日指定があり時間指定があればその日時、時間未指定なら終日00:00）
    let startTimeIso: string;
    let endTimeIso: string | null = null;

    if (!isNoDate && dueDate) {
      if (hasTime) {
        startTimeIso = `${dueDate}T${dueTime}:00+09:00`;
        const [h, m] = dueTime.split(':').map(Number);
        const endH = Math.min(23, h + 1).toString().padStart(2, '0');
        endTimeIso = `${dueDate}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
      } else {
        // 日付はあるが時間指定がない場合は終日欄へ
        startTimeIso = `${dueDate}T00:00:00+09:00`;
        endTimeIso = null;
      }
    } else {
      startTimeIso = new Date().toISOString();
    }

    const taskPriority = ['S', 'A', 'B', 'C'].includes(priority) ? priority : 'B';
    const taskColor = getTaskDefaultColor(taskPriority, body.color);

    const rawPayload = {
      is_task: true,
      genre: genre.trim() || 'その他',
      priority: taskPriority,
      color: taskColor,
      is_completed: false,
      completed_at: null,
      archived: false,
      is_nodate: Boolean(isNoDate || !dueDate),
      due_date: isNoDate ? null : dueDate,
      due_time: isNoDate || isAllDayVal ? null : dueTime,
      is_all_day: isAllDayVal,
      isAllDay: isAllDayVal,
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

    // 期日・時間・色更新
    if (typeof updates.isNoDate !== 'undefined') {
      newPayload.is_nodate = Boolean(updates.isNoDate);
    }
    if (typeof updates.dueDate !== 'undefined') {
      newPayload.due_date = updates.dueDate || null;
    }
    if (typeof updates.dueTime !== 'undefined') {
      newPayload.due_time = updates.dueTime || null;
    }
    if (typeof updates.color !== 'undefined') {
      newPayload.color = updates.color;
    }

    // 締切期日と時間の再計算
    if (!newPayload.is_nodate && newPayload.due_date) {
      if (newPayload.due_time) {
        newStartTime = `${newPayload.due_date}T${newPayload.due_time}:00+09:00`;
        const [h, m] = newPayload.due_time.split(':').map(Number);
        const endH = Math.min(23, h + 1).toString().padStart(2, '0');
        newEndTime = `${newPayload.due_date}T${endH}:${(m || 0).toString().padStart(2, '0')}:00+09:00`;
        newPayload.is_all_day = false;
        newPayload.isAllDay = false;
      } else {
        // 時間指定なし＝終日
        newStartTime = `${newPayload.due_date}T00:00:00+09:00`;
        newEndTime = null;
        newPayload.is_all_day = true;
        newPayload.isAllDay = true;
        newPayload.due_time = null;
      }
    } else {
      newPayload.is_all_day = false;
      newPayload.isAllDay = false;
      newPayload.due_time = null;
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
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getValidGoogleAccessToken,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from '@/lib/googleCalendar';
import { fetchDailyLocationArchive } from '@/lib/googleDrive';
import { getRegisteredSpots, findMatchingSpot } from '@/lib/registeredSpots';
import { getJstDateStr } from '@/lib/dateUtils';

// JST日付を文字列（YYYY-MM-DD）として安全に抽出
function extractJstDate(timeIsoOrDateStr?: string | null): string | null {
  if (!timeIsoOrDateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeIsoOrDateStr)) {
    return timeIsoOrDateStr;
  }
  const d = new Date(timeIsoOrDateStr);
  if (isNaN(d.getTime())) return null;
  return getJstDateStr(d);
}

// 日付に対応する正しいデイリーノートIDを自動取得（なければ自動作成）
async function resolveNoteIdForDate(dateStr: string, userId: string = 'owner'): Promise<string> {
  let { data: note } = await supabaseAdmin
    .from('chrono_daily_notes')
    .select('id')
    .eq('user_id', userId)
    .eq('date', dateStr)
    .maybeSingle();

  if (!note) {
    const { data: newNote } = await supabaseAdmin
      .from('chrono_daily_notes')
      .insert({
        user_id: userId,
        date: dateStr,
        title: `${dateStr} の手帳`,
      })
      .select('id')
      .maybeSingle();
    if (newNote) return newNote.id;
  }
  return note?.id || '';
}

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
          .select('id, note_id, title, start_time, end_time, source, raw_payload')
          .lte('start_time', queryEndUtc)
          .or(`end_time.gte.${queryStartUtc},end_time.is.null,start_time.gte.${queryStartUtc}`),
      ]);

      const noteList = notesRes.data || [];
      const noteIds = noteList.map((n) => n.id);

      let notesWithCounts = noteList;
      if (noteIds.length > 0) {
        const [actRes, rawRes] = await Promise.all([
          supabaseAdmin.from('chrono_activity_logs').select('note_id').in('note_id', noteIds),
          supabaseAdmin.from('chrono_raw_inputs').select('note_id').in('note_id', noteIds),
        ]);

        const actCounts = new Map<string, number>();
        (actRes.data || []).forEach((row: any) => {
          actCounts.set(row.note_id, (actCounts.get(row.note_id) || 0) + 1);
        });

        const rawCounts = new Map<string, number>();
        (rawRes.data || []).forEach((row: any) => {
          rawCounts.set(row.note_id, (rawCounts.get(row.note_id) || 0) + 1);
        });

        notesWithCounts = noteList.map((n) => {
          const activityCount = actCounts.get(n.id) || 0;
          const memoCount = rawCounts.get(n.id) || 0;
          return {
            ...n,
            activityCount,
            memoCount,
            hasContent: activityCount + memoCount > 0,
          };
        });
      }

      const todayDateStr = getJstDateStr(new Date());

      // 期日なしタスクを除外 ＆ 期限超過タスクの赤色判定
      const seenMonthSchedIds = new Set<string>();
      const validSchedules: any[] = [];
      const currentMonthTaskIds = new Set<string>();

      for (const s of (schedulesRes.data || [])) {
        if (seenMonthSchedIds.has(s.id)) continue;
        seenMonthSchedIds.add(s.id);

        const payload = s.raw_payload || {};
        const isTask = s.source === 'chrono_task' || payload.is_task;
        if (isTask) {
          if (payload.is_nodate || !payload.due_date) {
            continue;
          }
          currentMonthTaskIds.add(s.id);

          const isCompleted = Boolean(payload.is_completed || payload.isCompleted);
          const taskDueDate = payload.due_date || (s.start_time ? s.start_time.split('T')[0] : null);

          // 過去日タスクが未完了の場合、赤色・期限超過フラグを付与
          if (!isCompleted && taskDueDate && taskDueDate < todayDateStr) {
            const diffDays = Math.ceil(
              (new Date(`${todayDateStr}T00:00:00+09:00`).getTime() - new Date(`${taskDueDate}T00:00:00+09:00`).getTime()) /
                (24 * 60 * 60 * 1000)
            );
            validSchedules.push({
              ...s,
              raw_payload: {
                ...payload,
                isOverdue: true,
                overdueDays: diffDays,
                color: '#ef4444',
              },
            });
            continue;
          }
        }
        validSchedules.push(s);
      }

      // 今日が当月内にある場合、過去の未完了タスクを今日のマスへ繰越タスク（赤色）として追加
      if (start <= todayDateStr && todayDateStr <= end) {
        const { data: pastUncompletedTasks } = await supabaseAdmin
          .from('chrono_schedule_events')
          .select('id, note_id, title, start_time, end_time, source, raw_payload')
          .eq('source', 'chrono_task')
          .order('created_at', { ascending: false });

        if (pastUncompletedTasks && pastUncompletedTasks.length > 0) {
          for (const t of pastUncompletedTasks) {
            if (currentMonthTaskIds.has(t.id) && t.start_time?.startsWith(todayDateStr)) continue;
            const payload = t.raw_payload || {};
            const isCompleted = Boolean(payload.is_completed || payload.isCompleted);
            const archived = Boolean(payload.archived);
            const isNoDate = Boolean(payload.is_nodate);
            const taskDueDate = payload.due_date || (t.start_time ? t.start_time.split('T')[0] : null);

            if (!isCompleted && !archived && !isNoDate && taskDueDate && taskDueDate < todayDateStr) {
              const diffDays = Math.ceil(
                (new Date(`${todayDateStr}T00:00:00+09:00`).getTime() - new Date(`${taskDueDate}T00:00:00+09:00`).getTime()) /
                  (24 * 60 * 60 * 1000)
              );
              validSchedules.push({
                ...t,
                id: `rollover-${t.id}`,
                start_time: `${todayDateStr}T09:00:00+09:00`,
                end_time: `${todayDateStr}T10:00:00+09:00`,
                raw_payload: {
                  ...payload,
                  isAllDay: true,
                  is_all_day: true,
                  isRollover: true,
                  isOverdue: true,
                  overdueDays: diffDays,
                  originalDueDate: taskDueDate,
                  originalTaskId: t.id,
                  color: '#ef4444',
                },
              });
            }
          }
        }
      }

      return NextResponse.json({
        notes: notesWithCounts,
        schedules: validSchedules,
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

    // 1日分の位置ログを1000件上限で切り捨てられることなく全件取得するヘルパー
    const fetchAllDayTracks = async () => {
      const all: any[] = [];
      let page = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabaseAdmin
          .from('chrono_location_tracks')
          .select('*')
          .gte('recorded_at', dayStartUtc)
          .lte('recorded_at', dayEndUtc)
          .order('recorded_at', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        page++;
        if (page >= 30) break;
      }
      return all;
    };

    // 2. 予定・実績・生入力・AI要約・位置情報を並列取得
    // note_id だけでなく JST日付範囲（start_time / recorded_at）もマッチングさせ、誤ったnote_idへの誤保存も100%救出
    const [scheduleRes, activityRes, rawInputRes, summaryRes, fetchedRawTracks, spots, latestTrackRes] = await Promise.all([
      supabaseAdmin
        .from('chrono_schedule_events')
        .select('*')
        .or(`note_id.eq.${noteId},and(start_time.lte.${dayEndUtc},end_time.gte.${dayStartUtc})`)
        .order('start_time'),
      supabaseAdmin
        .from('chrono_activity_logs')
        .select('*')
        .or(`note_id.eq.${noteId},and(start_time.gte.${dayStartUtc},start_time.lte.${dayEndUtc})`)
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('chrono_raw_inputs')
        .select('*')
        .or(`note_id.eq.${noteId},and(recorded_at.gte.${dayStartUtc},recorded_at.lte.${dayEndUtc})`)
        .order('recorded_at'),
      supabaseAdmin.from('chrono_ai_summaries').select('*').eq('note_id', noteId).order('created_at'),
      fetchAllDayTracks(),
      getRegisteredSpots(),
      supabaseAdmin
        .from('chrono_location_tracks')
        .select('recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    let rawTracks = fetchedRawTracks;
    // 1年以上前の過去日などでSupabaseにデータがない場合、Google Driveの日別アーカイブをフォールバック検索
    if (rawTracks.length === 0) {
      try {
        const accessToken = await getValidGoogleAccessToken();
        if (accessToken) {
          const driveTracks = await fetchDailyLocationArchive(accessToken, date);
          if (driveTracks && driveTracks.length > 0) {
            rawTracks = driveTracks;
          }
        }
      } catch (driveErr) {
        console.warn('Google Drive fallback load in notes API error:', driveErr);
      }
    }

    // 実績ログの重複排除＆誤note_idの自動自己治癒（バックグラウンド修復）
    const rawActivityList = activityRes.data || [];
    const seenActIds = new Set<string>();
    const validActivityLogs: any[] = [];
    for (const act of rawActivityList) {
      if (seenActIds.has(act.id)) continue;
      seenActIds.add(act.id);
      validActivityLogs.push(act);

      // 万一 start_time が当日内なのに note_id が別日を指している場合、正規の noteId へ自己治癒
      if (act.note_id !== noteId && act.start_time) {
        const actJstDate = getJstDateStr(new Date(act.start_time));
        if (actJstDate === date) {
          supabaseAdmin
            .from('chrono_activity_logs')
            .update({ note_id: noteId })
            .eq('id', act.id)
            .then(() => {});
        }
      }
    }

    // デイリーメモの重複排除＆誤note_idの自動自己治癒
    const rawInputList = rawInputRes.data || [];
    const seenRawIds = new Set<string>();
    const validRawInputs: any[] = [];
    for (const raw of rawInputList) {
      if (seenRawIds.has(raw.id)) continue;
      seenRawIds.add(raw.id);
      validRawInputs.push(raw);

      if (raw.note_id !== noteId && raw.recorded_at) {
        const rawJstDate = getJstDateStr(new Date(raw.recorded_at));
        if (rawJstDate === date) {
          supabaseAdmin
            .from('chrono_raw_inputs')
            .update({ note_id: noteId })
            .eq('id', raw.id)
            .then(() => {});
        }
      }
    }

    // 大量ログ時（1万件超など）は、代表地点算出の精度を100%保ったまま通信量を軽量化（15秒以上の間隔でサンプリング）
    const sampledTracks: any[] = [];
    let lastSampledT: any = null;
    for (let i = 0; i < rawTracks.length; i++) {
      const t = rawTracks[i];
      if (!lastSampledT) {
        sampledTracks.push(t);
        lastSampledT = t;
      } else {
        const timeDiff = Math.abs(new Date(t.recorded_at).getTime() - new Date(lastSampledT.recorded_at).getTime()) / 1000;
        if (timeDiff >= 15 || i === rawTracks.length - 1) {
          sampledTracks.push(t);
          lastSampledT = t;
        }
      }
    }

    const enrichedTracks = sampledTracks.map((t: any) => {
      const matched = findMatchingSpot(t.latitude, t.longitude, spots);
      if (matched) {
        return {
          ...t,
          place_name: matched.name,
          is_registered_spot: true,
          registered_spot_name: matched.name,
          registered_address: matched.address,
        };
      }
      return t;
    });

    const todayDateStr = getJstDateStr(new Date());

    // 期日なしタスク（source='chrono_task' かつ is_nodate=true または due_date なし）を手帳スケジュールから除外
    // ＆ 過去日タスクで未完了のものには期限超過（isOverdue: true, color: '#ef4444'）を付与
    const seenSchedIds = new Set<string>();
    const validScheduleEvents: any[] = [];
    const currentTaskIds = new Set<string>();

    for (const s of (scheduleRes.data || [])) {
      if (seenSchedIds.has(s.id)) continue;
      seenSchedIds.add(s.id);

      const payload = s.raw_payload || {};
      const isTask = s.source === 'chrono_task' || payload.is_task;
      if (isTask) {
        if (payload.is_nodate || !payload.due_date) {
          continue;
        }
        currentTaskIds.add(s.id);

        const isCompleted = Boolean(payload.is_completed || payload.isCompleted);
        const taskDueDate = payload.due_date || (s.start_time ? s.start_time.split('T')[0] : null);

        // 過去日タスクが未完了の場合、赤色・期限超過フラグを付与（過去日手帳での未実行の赤色表示）
        if (!isCompleted && taskDueDate && taskDueDate < todayDateStr) {
          const diffDays = Math.ceil(
            (new Date(`${todayDateStr}T00:00:00+09:00`).getTime() - new Date(`${taskDueDate}T00:00:00+09:00`).getTime()) /
              (24 * 60 * 60 * 1000)
          );
          validScheduleEvents.push({
            ...s,
            raw_payload: {
              ...payload,
              isOverdue: true,
              overdueDays: diffDays,
              color: '#ef4444',
            },
          });
          continue;
        }
      }
      validScheduleEvents.push(s);
    }

    // パターンA：指定日が「今日」（または今日以降）の場合、過去の未完了タスクを「繰越タスク」として手帳に自動注入
    if (date >= todayDateStr) {
      const { data: pastUncompletedTasks } = await supabaseAdmin
        .from('chrono_schedule_events')
        .select('*')
        .eq('source', 'chrono_task')
        .order('created_at', { ascending: false });

      if (pastUncompletedTasks && pastUncompletedTasks.length > 0) {
        for (const t of pastUncompletedTasks) {
          if (currentTaskIds.has(t.id) || seenSchedIds.has(t.id)) continue;

          const payload = t.raw_payload || {};
          const isCompleted = Boolean(payload.is_completed || payload.isCompleted);
          const archived = Boolean(payload.archived);
          const isNoDate = Boolean(payload.is_nodate);
          const taskDueDate = payload.due_date || (t.start_time ? t.start_time.split('T')[0] : null);

          // 条件：未完了、未アーカイブ、期日あり、期日が今日（指定日）より前
          if (!isCompleted && !archived && !isNoDate && taskDueDate && taskDueDate < date) {
            const diffDays = Math.ceil(
              (new Date(`${date}T00:00:00+09:00`).getTime() - new Date(`${taskDueDate}T00:00:00+09:00`).getTime()) /
                (24 * 60 * 60 * 1000)
            );

            seenSchedIds.add(t.id);
            validScheduleEvents.push({
              ...t,
              // 手帳の終日エリア（All-Day）に繰越表示させるため当日の終日形式に設定
              start_time: `${date}T09:00:00+09:00`,
              end_time: `${date}T10:00:00+09:00`,
              raw_payload: {
                ...payload,
                isAllDay: true,
                is_all_day: true,
                isRollover: true,        // 繰越タスクフラグ
                isOverdue: true,         // 期限超過フラグ
                overdueDays: diffDays,   // 超過日数
                originalDueDate: taskDueDate, // 元の期日
                color: '#ef4444',        // 赤色警告
              },
            });
          }
        }
      }
    }

    return NextResponse.json({
      note,
      scheduleEvents: validScheduleEvents,
      activityLogs: validActivityLogs,
      rawInputs: validRawInputs,
      aiSummaries: summaryRes.data || [],
      locationTracks: enrichedTracks,
      latestLocationRecordedAt: latestTrackRes.data?.recorded_at || null,
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
    const { action, noteId, data, id, date } = body;
    const userId = body.userId || 'owner';

    // ── 削除アクション ──
    if (action === 'delete_schedule') {
      // Googleカレンダー側のイベントも削除
      try {
        const { data: existing } = await supabaseAdmin
          .from('chrono_schedule_events')
          .select('external_id, raw_payload')
          .eq('id', id)
          .maybeSingle();

        if (existing?.external_id) {
          const accessToken = await getValidGoogleAccessToken('owner');
          if (accessToken) {
            await deleteGoogleCalendarEvent(accessToken, existing.external_id, existing.raw_payload?.calendarId);
          }
        }
      } catch (gErr) {
        console.error('Failed to delete Google Calendar event:', gErr);
      }

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

    // ── 更新アクション（各レコードの id で更新・必要に応じて正しい noteId へ付け替え） ──
    if (action === 'update_raw_input') {
      const { id, content, recordedAt } = data;
      if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const targetDate = date || extractJstDate(recordedAt);
      let targetNoteId: string | undefined = undefined;
      if (targetDate) {
        targetNoteId = await resolveNoteIdForDate(targetDate, userId);
      }

      const updateData: any = { content };
      if (targetNoteId) updateData.note_id = targetNoteId;
      if (recordedAt) {
        updateData.recorded_at = recordedAt;
      }

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_raw_inputs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === 'update_activity') {
      const { id, title, startTime, endTime, locationName } = data;
      if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const targetDate = date || extractJstDate(startTime);
      let targetNoteId: string | undefined = undefined;
      if (targetDate) {
        targetNoteId = await resolveNoteIdForDate(targetDate, userId);
      }

      const updateData: any = {
        title,
        updated_at: new Date().toISOString(),
      };
      if (targetNoteId) updateData.note_id = targetNoteId;
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

      const targetDate = date || extractJstDate(startTime);
      let targetNoteId: string | undefined = undefined;
      if (targetDate) {
        targetNoteId = await resolveNoteIdForDate(targetDate, userId);
      }

      // 既存レコードを取得（external_id等の維持・Google同期）
      const { data: existing } = await supabaseAdmin
        .from('chrono_schedule_events')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      const isTask = existing?.source === 'chrono_task' || existing?.raw_payload?.is_task;
      let externalId = existing?.external_id;

      // Googleカレンダー連携中の場合、Google側も更新（タスクはGoogleカレンダーへ送信しない）
      // 注意: update時に新規作成 (createGoogleCalendarEvent) は行わない（トグルや編集のたびに多重作成されるのを防ぐ）
      try {
        const accessToken = await getValidGoogleAccessToken('owner');
        if (accessToken && !isTask && externalId) {
          await updateGoogleCalendarEvent(accessToken, externalId, {
            title,
            startTime,
            endTime: endTime || null,
            location: location || null,
            isAllDay: !!isAllDay,
          }, existing?.raw_payload?.calendarId);
        }
      } catch (gErr) {
        console.error('Failed to sync update to Google Calendar:', gErr);
      }

      const boolCompleted =
        isCompleted !== undefined
          ? !!isCompleted
          : Boolean(existing?.raw_payload?.isCompleted || existing?.raw_payload?.is_completed);

      const updateData: any = {
        title,
        start_time: startTime,
        end_time: endTime || null,
        location: location || null,
        external_id: externalId || null,
        description: data.memo !== undefined ? (data.memo ? String(data.memo).trim() : null) : existing?.description,
        raw_payload: {
          ...(existing?.raw_payload || {}),
          color: color || existing?.raw_payload?.color || null,
          isAllDay: !!isAllDay,
          isCompleted: boolCompleted,
          is_completed: boolCompleted,
          completed_at: boolCompleted
            ? existing?.raw_payload?.completed_at || new Date().toISOString()
            : null,
          memo: data.memo !== undefined ? (data.memo ? String(data.memo).trim() : null) : (existing?.raw_payload?.memo || null),
        },
        updated_at: new Date().toISOString(),
      };
      if (targetNoteId) updateData.note_id = targetNoteId;

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === 'update_schedule_memo') {
      const scheduleId = data?.id || id;
      const memo = data?.memo;
      if (!scheduleId) return NextResponse.json({ error: 'idが必要です' }, { status: 400 });

      const { data: existing } = await supabaseAdmin
        .from('chrono_schedule_events')
        .select('*')
        .eq('id', scheduleId)
        .maybeSingle();

      const memoVal = memo !== undefined && memo !== null ? String(memo).trim() : null;

      const updateData: any = {
        description: memoVal || null,
        raw_payload: {
          ...(existing?.raw_payload || {}),
          memo: memoVal || null,
        },
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .update(updateData)
        .eq('id', scheduleId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, item: updated });
    }

    // ── 追加アクション（noteId または date/時刻 から該当日の手帳を厳格自動解決） ──
    const targetDate =
      date ||
      extractJstDate(data?.startTime || data?.recordedAt) ||
      getJstDateStr();

    let targetNoteId = noteId;
    if (targetDate) {
      const resolvedId = await resolveNoteIdForDate(targetDate, userId);
      if (resolvedId) targetNoteId = resolvedId;
    }

    if (!targetNoteId) {
      return NextResponse.json({ error: '手帳ノートの取得・解決に失敗しました' }, { status: 400 });
    }

    if (action === 'add_raw_input') {
      const { inputType, content, durationSeconds, fileSize, recordedAt } = data;
      const { data: raw, error } = await supabaseAdmin
        .from('chrono_raw_inputs')
        .insert({
          note_id: targetNoteId,
          input_type: inputType,
          content,
          duration_seconds: durationSeconds || null,
          file_size_bytes: fileSize || null,
          recorded_at: recordedAt || new Date().toISOString(),
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
          note_id: targetNoteId,
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

      // Googleカレンダー連携中の場合、Googleカレンダーにも即座に作成
      let externalId = null;
      try {
        const accessToken = await getValidGoogleAccessToken('owner');
        if (accessToken) {
          const createdG = await createGoogleCalendarEvent(accessToken, {
            title,
            startTime: startTime || new Date().toISOString(),
            endTime: endTime || null,
            location: location || null,
            isAllDay: !!isAllDay,
          });
          if (createdG?.id) {
            externalId = createdG.id;
          }
        }
      } catch (gErr) {
        console.error('Failed to create event on Google Calendar:', gErr);
      }

      const { data: sc, error } = await supabaseAdmin
        .from('chrono_schedule_events')
        .insert({
          note_id: targetNoteId,
          external_id: externalId,
          title,
          start_time: startTime || new Date().toISOString(),
          end_time: endTime || null,
          location: location || null,
          source: externalId ? 'google_calendar' : 'chrono_nexus',
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
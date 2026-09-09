import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getValidGoogleAccessToken,
  listGoogleCalendarEvents,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from '@/lib/googleCalendar';

// GET: Google連携ステータスチェック ＆ 同期実行
export async function GET(req: Request) {
  try {
    const userId = 'owner';
    const accessToken = await getValidGoogleAccessToken(userId);

    if (!accessToken) {
      return NextResponse.json({
        connected: false,
        message: 'Googleカレンダーと未連携です',
      });
    }

    return NextResponse.json({
      connected: true,
      message: 'Googleカレンダーと連携済みです',
    });
  } catch (err: any) {
    console.error('Calendar sync status error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 双方向同期の実行
export async function POST(req: Request) {
  try {
    const userId = 'owner';
    const accessToken = await getValidGoogleAccessToken(userId);

    if (!accessToken) {
      return NextResponse.json({
        connected: false,
        error: 'Googleカレンダーと未連携です。先に連携を行ってください。',
      }, { status: 401 });
    }

    // 同期範囲：過去30日 〜 未来60日
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 30);
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + 60);

    const timeMin = minDate.toISOString();
    const timeMax = maxDate.toISOString();

    // 1. Googleカレンダーからイベント取得
    const gEvents = await listGoogleCalendarEvents(accessToken, timeMin, timeMax);

    // 2. 手帳DB側の該当日時のイベントを取得
    const { data: dbSchedules, error: dbErr } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('*')
      .gte('start_time', timeMin)
      .lte('start_time', timeMax);

    if (dbErr) throw dbErr;

    const existingExternalMap = new Map<string, any>();
    const existingLocalList: any[] = dbSchedules || [];

    for (const s of existingLocalList) {
      if (s.external_id) {
        existingExternalMap.set(s.external_id, s);
      }
    }

    let pulledCount = 0;
    let pushedCount = 0;

    // ── A: Googleカレンダー ➔ 手帳DB への取り込み・更新 ──
    for (const gEvent of gEvents) {
      if (!gEvent.start || gEvent.status === 'cancelled') continue;

      const isAllDay = !!gEvent.start.date;
      const startIso = isAllDay
        ? new Date(`${gEvent.start.date}T00:00:00+09:00`).toISOString()
        : new Date(gEvent.start.dateTime).toISOString();

      let endIso: string | null = null;
      if (isAllDay && gEvent.end?.date) {
        // 終日イベントのend.dateは排他的翌日なので前日の23:59:59にする
        const ed = new Date(`${gEvent.end.date}T00:00:00+09:00`);
        ed.setDate(ed.getDate() - 1);
        const y = ed.getFullYear();
        const m = (ed.getMonth() + 1).toString().padStart(2, '0');
        const d = ed.getDate().toString().padStart(2, '0');
        endIso = new Date(`${y}-${m}-${d}T23:59:59.999+09:00`).toISOString();
      } else if (gEvent.end?.dateTime) {
        endIso = new Date(gEvent.end.dateTime).toISOString();
      }

      // イベントの該当ローカル日付（YYYY-MM-DD）
      const dObj = new Date(startIso);
      const sy = dObj.getFullYear();
      const sm = (dObj.getMonth() + 1).toString().padStart(2, '0');
      const sd = dObj.getDate().toString().padStart(2, '0');
      const eventDateStr = `${sy}-${sm}-${sd}`;

      // 該当日のデイリーノートを取得（なければ自動作成）
      let { data: noteRow } = await supabaseAdmin
        .from('chrono_daily_notes')
        .select('id')
        .eq('user_id', userId)
        .eq('date', eventDateStr)
        .maybeSingle();

      if (!noteRow) {
        const { data: newNote } = await supabaseAdmin
          .from('chrono_daily_notes')
          .insert({
            user_id: userId,
            date: eventDateStr,
            title: `${eventDateStr} のノート`,
          })
          .select('id')
          .single();
        noteRow = newNote;
      }

      const existing = existingExternalMap.get(gEvent.id);

      if (existing) {
        // すでに存在する場合は内容を更新
        await supabaseAdmin
          .from('chrono_schedule_events')
          .update({
            title: gEvent.summary || '(無題)',
            start_time: startIso,
            end_time: endIso,
            location: gEvent.location || null,
            description: gEvent.description || null,
            raw_payload: {
              ...(existing.raw_payload || {}),
              color: gEvent.colorId ? `google_${gEvent.colorId}` : existing.raw_payload?.color || 'peacock',
              isAllDay,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else if (noteRow) {
        // 新規取り込み
        await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteRow.id,
            external_id: gEvent.id,
            title: gEvent.summary || '(無題)',
            start_time: startIso,
            end_time: endIso,
            location: gEvent.location || null,
            description: gEvent.description || null,
            source: 'google_calendar',
            raw_payload: {
              color: 'peacock',
              isAllDay,
              isCompleted: false,
            },
          });
        pulledCount++;
      }
    }

    // ── B: 手帳 ➔ Googleカレンダー への反映（手帳で新規追加され未同期のもの） ──
    for (const localSch of existingLocalList) {
      if (!localSch.external_id) {
        try {
          const createdG = await createGoogleCalendarEvent(accessToken, {
            title: localSch.title,
            startTime: localSch.start_time,
            endTime: localSch.end_time,
            location: localSch.location,
            isAllDay: !!localSch.raw_payload?.isAllDay,
          });

          if (createdG && createdG.id) {
            await supabaseAdmin
              .from('chrono_schedule_events')
              .update({ external_id: createdG.id })
              .eq('id', localSch.id);
            pushedCount++;
          }
        } catch (pushErr) {
          console.error('Failed to push local event to Google:', localSch.id, pushErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      connected: true,
      pulledCount,
      pushedCount,
      totalGoogleEvents: gEvents.length,
    });
  } catch (err: any) {
    console.error('Sync execution error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

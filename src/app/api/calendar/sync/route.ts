const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1': 'lavender',
  '2': 'sage',
  '3': 'grape',
  '4': 'flamingo',
  '5': 'banana',
  '6': 'tangerine',
  '7': 'peacock',
  '8': 'graphite',
  '9': 'blueberry',
  '10': 'basil',
  '11': 'tomato',
};

const CALENDAR_DEFAULT_COLOR: Record<string, string> = {
  'リビンユニティ': 'peacock',
  '組合': 'graphite',
  'Family': 'grape',
  'ファミリー カレンダー': 'flamingo',
  '日本の祝日': 'tomato',
};

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getValidGoogleAccessToken,
  createGoogleCalendarEvent,
  listUserCalendars,
  getTargetCalendarId,
} from '@/lib/googleCalendar';

// GET: Google連携ステータスチェック
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

// POST: 双方向同期の実行（「リビンユニティ」含む全カレンダーの予定を漏れなく同期）
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

    // 同期範囲：過去60日 〜 未来120日（Vercel 15秒制限を確実に回避し1〜2秒で高速同期）
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 60);
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + 120);

    const timeMin = minDate.toISOString();
    const timeMax = maxDate.toISOString();

    // 1. ユーザーのカレンダー一覧を取得（「リビンユニティ」やメインカレンダー等）
    const userCalendars = await listUserCalendars(accessToken);
    console.log('Found user calendars:', userCalendars.map((c) => c.summary));

    // 2. 各カレンダーからイベントを取得
    let gEvents: any[] = [];
    const seenEventIds = new Set<string>();

    for (const cal of userCalendars) {
      let pageToken: string | null = null;
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
        url.searchParams.set('timeMin', timeMin);
        url.searchParams.set('timeMax', timeMax);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', '2500');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.items) {
            for (const item of data.items) {
              if (!seenEventIds.has(item.id)) {
                seenEventIds.add(item.id);
                // カレンダー名を付与
                item._calendarSummary = cal.summary;
                item._calendarId = cal.id;
                gEvents.push(item);
              }
            }
          }
          pageToken = data.nextPageToken || null;
        } else {
          console.warn(`Failed to fetch events from calendar ${cal.summary}: ${res.status}`);
          break;
        }
      } while (pageToken);
    }

    // 3. 手帳DB側の該当日時のイベントを取得
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
    let updatedCount = 0;
    let pushedCount = 0;

    // 既存ノートのキャッシュ（DBクエリ削減）
    const noteCache = new Map<string, string>(); // date -> noteId
    const { data: allNotes } = await supabaseAdmin
      .from('chrono_daily_notes')
      .select('id, date')
      .eq('user_id', userId)
      .gte('date', '2024-01-01');

    if (allNotes) {
      for (const n of allNotes) {
        noteCache.set(n.date, n.id);
      }
    }

    // ── A: Googleカレンダー ➔ 手帳DB への取り込み・更新 ──
    for (const gEvent of gEvents) {
      if (!gEvent.start || gEvent.status === 'cancelled') continue;

      const isAllDay = !!gEvent.start.date;
      const startIso = isAllDay
        ? new Date(`${gEvent.start.date}T00:00:00+09:00`).toISOString()
        : new Date(gEvent.start.dateTime).toISOString();

      let endIso: string | null = null;
      if (isAllDay) {
        let endDateObj;
        if (gEvent.end?.date && gEvent.end.date > gEvent.start.date) {
          endDateObj = new Date(`${gEvent.end.date}T00:00:00+09:00`);
          endDateObj.setDate(endDateObj.getDate() - 1);
        } else {
          endDateObj = new Date(`${gEvent.start.date}T00:00:00+09:00`);
        }
        const y = endDateObj.getFullYear();
        const m = (endDateObj.getMonth() + 1).toString().padStart(2, '0');
        const d = endDateObj.getDate().toString().padStart(2, '0');
        endIso = new Date(`${y}-${m}-${d}T23:59:59.999+09:00`).toISOString();
      } else if (gEvent.end?.dateTime) {
        endIso = new Date(gEvent.end.dateTime).toISOString();
      }

      // 日本時間（JST）基準のローカル日付文字列（YYYY-MM-DD）
      const dJst = new Date(new Date(startIso).getTime() + 9 * 3600 * 1000);
      const eventDateStr = dJst.toISOString().split('T')[0];

      // 該当日のデイリーノートを取得（なければ自動作成）
      let noteId = noteCache.get(eventDateStr);

      if (!noteId) {
        const { data: newNote, error: nErr } = await supabaseAdmin
          .from('chrono_daily_notes')
          .insert({
            user_id: userId,
            date: eventDateStr,
            title: `${eventDateStr} の手帳`,
          })
          .select('id')
          .single();

        if (newNote && newNote.id) {
          noteId = newNote.id;
          noteCache.set(eventDateStr, newNote.id);
        } else if (nErr) {
          console.error('Note creation error:', eventDateStr, nErr);
          continue;
        }
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
              color: gEvent.colorId ? (GOOGLE_COLOR_MAP[gEvent.colorId] || 'peacock') : (CALENDAR_DEFAULT_COLOR[gEvent._calendarSummary] || existing.raw_payload?.color || 'peacock'),
              calendarName: gEvent._calendarSummary || existing.raw_payload?.calendarName || null,
              isAllDay,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        updatedCount++;
      } else if (noteId) {
        // 新規取り込み
        await supabaseAdmin
          .from('chrono_schedule_events')
          .insert({
            note_id: noteId,
            external_id: gEvent.id,
            title: gEvent.summary || '(無題)',
            start_time: startIso,
            end_time: endIso,
            location: gEvent.location || null,
            description: gEvent.description || null,
            source: 'google_calendar',
            raw_payload: {
              color: gEvent.colorId ? (GOOGLE_COLOR_MAP[gEvent.colorId] || 'peacock') : (CALENDAR_DEFAULT_COLOR[gEvent._calendarSummary] || 'peacock'),
              calendarName: gEvent._calendarSummary || null,
              isAllDay,
              isCompleted: false,
            },
          });
        pulledCount++;
      }
    }

    // ── B: 手帳 ➔ Googleカレンダー への反映（手帳で新規追加され未同期のもの） ──
    const targetCalendarId = await getTargetCalendarId(accessToken);

    for (const localSch of existingLocalList) {
      if (!localSch.external_id) {
        try {
          const createdG = await createGoogleCalendarEvent(accessToken, {
            title: localSch.title,
            startTime: localSch.start_time,
            endTime: localSch.end_time,
            location: localSch.location,
            isAllDay: !!localSch.raw_payload?.isAllDay,
          }, targetCalendarId);

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
      updatedCount,
      pushedCount,
      totalGoogleEvents: gEvents.length,
      calendars: userCalendars.map((c) => c.summary),
    });
  } catch (err: any) {
    console.error('Sync execution error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

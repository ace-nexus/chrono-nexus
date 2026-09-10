import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getValidGoogleAccessToken,
  createGoogleCalendarEvent,
  listUserCalendars,
  getTargetCalendarId,
} from '@/lib/googleCalendar';
import { toJstDateStr, getJstAllDayEndIso } from '@/lib/dateUtils';
import { GOOGLE_EVENT_COLORS } from '@/components/calendar/GoogleColors';

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
                // カレンダー名とカラーを付与
                item._calendarSummary = cal.summary;
                item._calendarId = cal.id;
                item._calendarBackgroundColor = cal.backgroundColor;
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

    // 2.5. 複数カレンダー（「リビンユニティ」と「組合」など）間の同一予定の重複排除
    // (カレンダー優先度: リビンユニティ > メインカレンダー > その他)
    const normalizedGoogleEvents: any[] = [];
    const contentKeyMap = new Map<string, any>();

    for (const item of gEvents) {
      if (!item.start || item.status === 'cancelled') continue;
      const isAllDay = !!item.start.date;
      const sKey = isAllDay ? item.start.date : item.start.dateTime;
      const contentKey = `${(item.summary || '').trim()}:::${sKey}`;

      const existingCandidate = contentKeyMap.get(contentKey);
      if (!existingCandidate) {
        contentKeyMap.set(contentKey, item);
        normalizedGoogleEvents.push(item);
      } else {
        const isCurrentLivingUnity = (item._calendarSummary || '').includes('リビンユニティ');
        const isExistingLivingUnity = (existingCandidate._calendarSummary || '').includes('リビンユニティ');
        if (isCurrentLivingUnity && !isExistingLivingUnity) {
          const idx = normalizedGoogleEvents.indexOf(existingCandidate);
          if (idx !== -1) normalizedGoogleEvents[idx] = item;
          contentKeyMap.set(contentKey, item);
        }
      }
    }

    // 3. 手帳DB側の該当日時のイベントを取得
    const { data: dbSchedules, error: dbErr } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('*')
      .gte('start_time', timeMin)
      .lte('start_time', timeMax);

    if (dbErr) throw dbErr;

    const existingLocalList: any[] = dbSchedules || [];

    // 全期間の external_id マップ（60日境界外イベントの多重INSERTを100%防止）
    const { data: allExternalRows } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('id, external_id, raw_payload')
      .not('external_id', 'is', null);

    const existingExternalMap = new Map<string, any>();
    (allExternalRows || []).forEach((row: any) => {
      if (row.external_id) {
        existingExternalMap.set(row.external_id, row);
      }
    });

    let pulledCount = 0;
    let updatedCount = 0;
    let pushedCount = 0;
    let deletedCount = 0;

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
    for (const gEvent of normalizedGoogleEvents) {
      if (!gEvent.start || gEvent.status === 'cancelled') continue;

      const isAllDay = !!gEvent.start.date;
      const startIso = isAllDay
        ? new Date(`${gEvent.start.date}T00:00:00+09:00`).toISOString()
        : new Date(gEvent.start.dateTime).toISOString();

      let endIso: string | null = null;
      if (isAllDay) {
        endIso = getJstAllDayEndIso(gEvent.end?.date, gEvent.start.date);
      } else if (gEvent.end?.dateTime) {
        endIso = new Date(gEvent.end.dateTime).toISOString();
      }

      // 日本時間（JST）基準のローカル日付文字列（YYYY-MM-DD）
      const eventDateStr = toJstDateStr(startIso);

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

      // カラーの完全同期:
      // 1. 予定個別に colorId が設定されている場合はそのGoogle公式イベント色
      // 2. 個別指定がない場合はカレンダー本体の色（例: リビンユニティ=#9fe1e7, 組合=#cabdbf, 祝日=#42d692）
      let resolvedColor = gEvent._calendarBackgroundColor || '#9fe1e7';
      if (gEvent.colorId && GOOGLE_EVENT_COLORS[gEvent.colorId]) {
        resolvedColor = GOOGLE_EVENT_COLORS[gEvent.colorId].background;
      }

      const existing = existingExternalMap.get(gEvent.id);

      // 手帳側に同一タイトル・同日時の既存レコード（external_id未設定または別ID）があるか照合
      const localMatch = existingLocalList.find(
        (l) => (l.title || '').trim() === (gEvent.summary || '(無題)').trim() && l.start_time === startIso
      );

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
              color: resolvedColor,
              colorHex: resolvedColor,
              calendarName: gEvent._calendarSummary || existing.raw_payload?.calendarName || null,
              calendarId: gEvent._calendarId || existing.raw_payload?.calendarId || null,
              isAllDay,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        updatedCount++;
      } else if (localMatch) {
        // 手帳側に同名・同日時の予定が既に存在する場合、二重INSERTせず既存レコードにGoogle IDを紐付け！
        await supabaseAdmin
          .from('chrono_schedule_events')
          .update({
            external_id: gEvent.id,
            source: 'google_calendar',
            end_time: endIso,
            location: gEvent.location || localMatch.location || null,
            description: gEvent.description || localMatch.description || null,
            raw_payload: {
              ...(localMatch.raw_payload || {}),
              color: resolvedColor,
              colorHex: resolvedColor,
              calendarName: gEvent._calendarSummary || localMatch.raw_payload?.calendarName || null,
              calendarId: gEvent._calendarId || localMatch.raw_payload?.calendarId || null,
              isAllDay,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', localMatch.id);
        existingExternalMap.set(gEvent.id, localMatch);
        updatedCount++;
      } else if (noteId) {
        // 新規取り込み（同一IDの多重登録を完全に防ぐ）
        const { data: insertedEvent } = await supabaseAdmin
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
              color: resolvedColor,
              colorHex: resolvedColor,
              calendarName: gEvent._calendarSummary || null,
              calendarId: gEvent._calendarId || null,
              isAllDay,
              isCompleted: false,
            },
          })
          .select('id, external_id')
          .single();

        if (insertedEvent) {
          existingExternalMap.set(gEvent.id, insertedEvent);
        }
        pulledCount++;
      }
    }

    // ── B: Google側で削除されたイベントを手帳DBからも削除 ──
    const activeGEventIds = new Set<string>();
    gEvents.forEach((e) => {
      if (e.status !== 'cancelled') activeGEventIds.add(e.id);
    });

    for (const localSch of existingLocalList) {
      if (
        localSch.source === 'google_calendar' &&
        localSch.external_id &&
        !activeGEventIds.has(localSch.external_id)
      ) {
        await supabaseAdmin.from('chrono_schedule_events').delete().eq('id', localSch.id);
        deletedCount++;
      }
    }

    // ── C: 手帳 ➔ Googleカレンダー への反映（手帳で新規追加され未同期のもの） ──
    const targetCalendarId = await getTargetCalendarId(accessToken);

    for (const localSch of existingLocalList) {
      // タスク（chrono_task や is_task）はGoogleカレンダーへPushしない
      const isTask = localSch.source === 'chrono_task' || localSch.raw_payload?.is_task;
      if (isTask) continue;

      if (!localSch.external_id) {
        // すでにGoogleカレンダー側に同一タイトル・同日時のイベントが存在しないかチェック！
        const matchingGoogle = normalizedGoogleEvents.find((g) => {
          const gStart = g.start.dateTime
            ? new Date(g.start.dateTime).toISOString()
            : new Date(`${g.start.date}T00:00:00+09:00`).toISOString();
          return (g.summary || '').trim() === (localSch.title || '').trim() && gStart === localSch.start_time;
        });

        if (matchingGoogle) {
          // Google側にすでに存在する！Google側に二重作成せず、そのIDを紐付け！
          await supabaseAdmin
            .from('chrono_schedule_events')
            .update({
              external_id: matchingGoogle.id,
              source: 'google_calendar',
              raw_payload: {
                ...(localSch.raw_payload || {}),
                calendarId: matchingGoogle._calendarId || targetCalendarId,
              },
            })
            .eq('id', localSch.id);
          existingExternalMap.set(matchingGoogle.id, { id: localSch.id, external_id: matchingGoogle.id });
          continue;
        }

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
              .update({
                external_id: createdG.id,
                raw_payload: {
                  ...(localSch.raw_payload || {}),
                  calendarId: targetCalendarId,
                }
              })
              .eq('id', localSch.id);
            existingExternalMap.set(createdG.id, { id: localSch.id, external_id: createdG.id });
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
      deletedCount,
      totalGoogleEvents: gEvents.length,
      calendars: userCalendars.map((c) => c.summary),
    });
  } catch (err: any) {
    console.error('Sync execution error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

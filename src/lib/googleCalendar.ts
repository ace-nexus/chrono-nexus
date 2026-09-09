import { supabaseAdmin } from './supabase';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// リダイレクトURIの解決（Google Cloud Consoleの承認済みURIと完全一致させる）
export function getRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`;
  }
  // ローカル開発環境の場合
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    return 'http://localhost:3000/api/auth/google/callback';
  }
  // Vercel本番環境（固定URL）
  return 'https://chrono-nexus-one.vercel.app/api/auth/google/callback';
}

// 1. Googleトークンの取得（有効期限切れの場合は自動更新）
export async function getValidGoogleAccessToken(userId: string = 'owner'): Promise<string | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from('chrono_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !tokenRow) {
    console.warn('Google token not found in DB:', error?.message);
    return null;
  }

  const now = Date.now();
  // 有効期限が切れているか、残り5分未満の場合はリフレッシュ
  if (tokenRow.expiry_date && tokenRow.expiry_date - now < 5 * 60 * 1000 && tokenRow.refresh_token) {
    try {
      const refreshed = await refreshGoogleToken(tokenRow.refresh_token);
      if (refreshed && refreshed.access_token) {
        const newExpiry = Date.now() + (refreshed.expires_in || 3600) * 1000;
        await supabaseAdmin
          .from('chrono_google_tokens')
          .update({
            access_token: refreshed.access_token,
            expiry_date: newExpiry,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
        return refreshed.access_token;
      }
    } catch (refreshErr) {
      console.error('Failed to refresh Google token:', refreshErr);
    }
  }

  return tokenRow.access_token;
}

// 2. リフレッシュトークンによるアクセストークン再取得
export async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to refresh token: ${res.status} ${errText}`);
  }

  return res.json();
}

// 3. 認可コードからトークン一式を取得
export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to exchange code: ${res.status} ${errText}`);
  }

  return res.json();
}

// 4. Googleカレンダーのイベント一覧取得（期間指定）
export async function listGoogleCalendarEvents(accessToken: string, timeMin: string, timeMax: string) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list events: ${res.status} ${errText}`);
  }

  const json = await res.json();
  return json.items || [];
}

// 5. Googleカレンダーにイベントを作成
export async function createGoogleCalendarEvent(accessToken: string, eventData: {
  title: string;
  startTime: string; // ISO
  endTime?: string | null; // ISO
  location?: string | null;
  isAllDay?: boolean;
}, calendarId?: string) {
  const body: any = {
    summary: eventData.title,
    location: eventData.location || undefined,
  };

  if (eventData.isAllDay) {
    const startDateStr = eventData.startTime.split('T')[0];
    let endDateStr = eventData.endTime ? eventData.endTime.split('T')[0] : startDateStr;
    // Googleカレンダーの終日イベントのendは翌日（exclusive）
    const endD = new Date(endDateStr);
    endD.setDate(endD.getDate() + 1);
    const endNextStr = endD.toISOString().split('T')[0];

    body.start = { date: startDateStr };
    body.end = { date: endNextStr };
  } else {
    body.start = { dateTime: eventData.startTime };
    body.end = { dateTime: eventData.endTime || eventData.startTime };
  }

  const targetCalId = calendarId || await getTargetCalendarId(accessToken);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create event: ${res.status} ${err}`);
  }

  return res.json();
}

// 6. Googleカレンダーのイベントを更新
export async function updateGoogleCalendarEvent(accessToken: string, eventId: string, eventData: {
  title: string;
  startTime: string;
  endTime?: string | null;
  location?: string | null;
  isAllDay?: boolean;
}) {
  const body: any = {
    summary: eventData.title,
    location: eventData.location || undefined,
  };

  if (eventData.isAllDay) {
    const startDateStr = eventData.startTime.split('T')[0];
    let endDateStr = eventData.endTime ? eventData.endTime.split('T')[0] : startDateStr;
    const endD = new Date(endDateStr);
    endD.setDate(endD.getDate() + 1);
    const endNextStr = endD.toISOString().split('T')[0];

    body.start = { date: startDateStr };
    body.end = { date: endNextStr };
  } else {
    body.start = { dateTime: eventData.startTime };
    body.end = { dateTime: eventData.endTime || eventData.startTime };
  }

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update event: ${res.status} ${err}`);
  }

  return res.json();
}

// 7. Googleカレンダーのイベントを削除
export async function deleteGoogleCalendarEvent(accessToken: string, eventId: string, calendarId?: string) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.text();
    throw new Error(`Failed to delete event: ${res.status} ${err}`);
  }

  return true;
}

// ユーザーのカレンダー一覧を取得（ファミリーの予定は業務手帳から完全除外、カレンダー背景色も含めて取得）
export async function listUserCalendars(accessToken: string): Promise<Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string; foregroundColor?: string }>> {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn('Failed to fetch calendarList, fallback to primary:', res.status);
      return [{ id: 'primary', summary: 'メインカレンダー', primary: true }];
    }
    const data = await res.json();
    return (data.items || [])
      .filter((item: any) => {
        const name = (item.summary || '').toLowerCase();
        const id = (item.id || '').toLowerCase();
        // ファミリーカレンダー（Family, ファミリーカレンダー等）を完全除外
        return !name.includes('family') && !name.includes('ファミリー') && !id.includes('family');
      })
      .map((item: any) => ({
        id: item.id,
        summary: item.summary,
        primary: !!item.primary,
        backgroundColor: item.backgroundColor,
        foregroundColor: item.foregroundColor,
      }));
  } catch (err) {
    console.error('listUserCalendars error:', err);
    return [{ id: 'primary', summary: 'メインカレンダー', primary: true }];
  }
}

// 優先カレンダーID（「リビンユニティ」があればそのID、なければprimary）を取得
export async function getTargetCalendarId(accessToken: string): Promise<string> {
  const calendars = await listUserCalendars(accessToken);
  const livingUnity = calendars.find((c) => c.summary && c.summary.includes('リビンユニティ'));
  if (livingUnity) {
    return livingUnity.id;
  }
  return 'primary';
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// 2点間の距離を計算（Haversineの公式、メートル）
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// シークレットキーの取得または初期生成
async function getOrInitLocationSecret(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('access_token')
      .eq('user_id', 'location_secret_key')
      .maybeSingle();

    if (data?.access_token) {
      return data.access_token;
    }

    // 初回生成
    const newKey = `nexus-loc-${Math.random().toString(36).substring(2, 12)}-${Date.now().toString(36)}`;
    await supabaseAdmin
      .from('chrono_google_tokens')
      .upsert({
        user_id: 'location_secret_key',
        access_token: newKey,
        refresh_token: 'dummy',
      });
    return newKey;
  } catch (e) {
    return 'nexus-default-secure-loc-key';
  }
}

// 逆ジオコーディング（市町村・町名取得）
async function getMunicipalityName(lat: number, lon: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const hrRes = await fetch(
      `https://geoapi.heartrails.com/api/json?method=getTowns&x=${lon}&y=${lat}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (hrRes.ok) {
      const hrData = await hrRes.json();
      const loc = hrData?.response?.location?.[0];
      if (loc) {
        return loc.city || `${loc.prefecture} ${loc.city}`;
      }
    }
  } catch (e) {
    // fallback
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=ja`,
      {
        headers: { 'User-Agent': 'ChronoNexus/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      const addr = nomData?.address;
      if (addr) {
        return addr.city_district || addr.suburb || addr.city || addr.town || addr.village || null;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// POST: 位置情報記録（ブラウザまたはGPS Loggerアプリ）
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const serverSecret = await getOrInitLocationSecret();

    // 認証チェック:
    // ヘッダー x-location-secret, または クエリ ?secret=..., または Authorization: Bearer
    const reqSecret =
      req.headers.get('x-location-secret') ||
      searchParams.get('secret') ||
      (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

    const isAppInternal = req.headers.get('referer')?.includes(req.headers.get('host') || '');

    if (!isAppInternal && reqSecret !== serverSecret) {
      return NextResponse.json({ error: '認証エラー: 無効なシークレットキーです' }, { status: 401 });
    }

    let lat: number | null = null;
    let lon: number | null = null;
    let accuracy: number | null = null;
    let recordedAt: string = new Date().toISOString();
    let placeName: string | null = null;
    let userId = 'owner';

    // JSON body または URLSearchParams から柔軟に取得（GPS Logger for Android 対応）
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      lat = parseFloat(body.latitude || body.lat);
      lon = parseFloat(body.longitude || body.lon);
      accuracy = body.accuracy ? parseFloat(body.accuracy) : null;
      recordedAt = body.recordedAt || body.time || recordedAt;
      placeName = body.placeName || null;
      userId = body.userId || 'owner';
    } else {
      // Form / Query params
      lat = parseFloat(searchParams.get('lat') || searchParams.get('latitude') || '');
      lon = parseFloat(searchParams.get('lon') || searchParams.get('longitude') || '');
      accuracy = searchParams.get('acc') ? parseFloat(searchParams.get('acc')!) : null;
      recordedAt = searchParams.get('time') || recordedAt;
    }

    if (isNaN(lat as number) || isNaN(lon as number) || lat === null || lon === null) {
      return NextResponse.json({ error: '有効な緯度(lat)と経度(lon)が必要です' }, { status: 400 });
    }

    let resolvedPlace = placeName;
    if (!resolvedPlace) {
      resolvedPlace = await getMunicipalityName(lat, lon);
    }

    const { data, error } = await supabaseAdmin
      .from('chrono_location_tracks')
      .insert({
        user_id: userId,
        latitude: lat,
        longitude: lon,
        accuracy,
        recorded_at: recordedAt,
        place_name: resolvedPlace || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      record: data,
    });
  } catch (err: any) {
    console.error('Location API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET: 位置情報履歴および3大活用集計（日次移動距離・滞在場所・シークレット取得）
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');
    const date = searchParams.get('date'); // YYYY-MM-DD

    // 1. シークレットキー表示モード（設定用）
    if (mode === 'secret') {
      const secret = await getOrInitLocationSecret();
      return NextResponse.json({ success: true, secret });
    }

    // 2. 滞在・移動距離集計モード（3大活用機能）
    if (mode === 'summary' && date) {
      const dayStartUtc = new Date(`${date}T00:00:00+09:00`).toISOString();
      const dayEndUtc = new Date(`${date}T23:59:59.999+09:00`).toISOString();

      const { data: records } = await supabaseAdmin
        .from('chrono_location_tracks')
        .select('*')
        .gte('recorded_at', dayStartUtc)
        .lte('recorded_at', dayEndUtc)
        .order('recorded_at', { ascending: true });

      const tracks = records || [];

      // 総移動距離の計算
      let totalDistanceMeters = 0;
      for (let i = 1; i < tracks.length; i++) {
        const prev = tracks[i - 1];
        const curr = tracks[i];
        const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        // 異常値（時速150km以上のテレポート等）を除外
        if (dist < 50000) {
          totalDistanceMeters += dist;
        }
      }

      const totalDistanceKm = Math.round((totalDistanceMeters / 1000) * 10) / 10;
      // ガソリン代目安（リッター10km, 160円換算）
      const estimatedGasCost = Math.round((totalDistanceKm / 10) * 160);

      // 滞在ポイントの検出（15分以上、半径150m以内に留まった地点）
      const stays: any[] = [];
      let clusterStartIdx = 0;

      for (let i = 1; i < tracks.length; i++) {
        const startPoint = tracks[clusterStartIdx];
        const currentPoint = tracks[i];
        const distFromClusterStart = calculateDistance(
          startPoint.latitude,
          startPoint.longitude,
          currentPoint.latitude,
          currentPoint.longitude
        );

        // 150m以上離れたらクラスター終了
        if (distFromClusterStart > 150 || i === tracks.length - 1) {
          const startTime = new Date(startPoint.recorded_at).getTime();
          const endTime = new Date(tracks[i - 1].recorded_at).getTime();
          const durationMinutes = Math.round((endTime - startTime) / (60 * 1000));

          if (durationMinutes >= 15) {
            stays.push({
              placeName: startPoint.place_name || `${Math.round(startPoint.latitude * 1000) / 1000}, ${Math.round(startPoint.longitude * 1000) / 1000}`,
              latitude: startPoint.latitude,
              longitude: startPoint.longitude,
              startTime: startPoint.recorded_at,
              endTime: tracks[i - 1].recorded_at,
              durationMinutes,
            });
          }
          clusterStartIdx = i;
        }
      }

      return NextResponse.json({
        success: true,
        date,
        totalTracks: tracks.length,
        totalDistanceKm,
        estimatedGasCost,
        stays,
      });
    }

    // 3. 通常の履歴取得
    let query = supabaseAdmin
      .from('chrono_location_tracks')
      .select('*')
      .order('recorded_at', { ascending: true });

    if (date) {
      const start = `${date}T00:00:00+09:00`;
      const end = `${date}T23:59:59.999+09:00`;
      query = query.gte('recorded_at', start).lte('recorded_at', end);
    } else {
      query = query.limit(100);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, records: data || [] });
  } catch (err: any) {
    console.error('GET /api/location error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
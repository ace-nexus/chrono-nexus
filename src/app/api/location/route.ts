import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getRegisteredSpots,
  findMatchingSpot,
  calculateDistanceMeters,
  RegisteredSpot,
} from '@/lib/registeredSpots';

// 2点間の距離を計算（Haversineの公式、メートル）
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return calculateDistanceMeters(lat1, lon1, lat2, lon2);
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

// フォールバック用簡易逆ジオコーディング（HeartRails）
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
    // ignore
  }
  return null;
}

export interface ResolvedLocation {
  name: string; // 表示用名称（登録名 > 建物名 > 現場住所）
  buildingName: string | null;
  fullAddress: string;
  isRegistered: boolean;
  registeredSpot?: RegisteredSpot;
}

// 高精度リバースジオコーダー（登録スポット最優先 -> 建物名 -> 現場住所）
export async function resolveLocationDetails(
  lat: number,
  lon: number,
  spots?: RegisteredSpot[]
): Promise<ResolvedLocation> {
  // 1. 登録スポット（自宅・現場・会社等）の最優先判定
  const registeredList = spots || (await getRegisteredSpots());
  const matched = findMatchingSpot(lat, lon, registeredList);

  if (matched) {
    return {
      name: matched.name,
      buildingName: null,
      fullAddress: matched.address,
      isRegistered: true,
      registeredSpot: matched,
    };
  }

  // 2. OpenStreetMap Nominatim zoom=18 による建物名と現場住所の精密分離判定
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ja&zoom=18&addressdetails=1`,
      {
        headers: { 'User-Agent': 'ChronoNexus/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (nomRes.ok) {
      const data = await nomRes.json();
      const nonBuildingCategories = new Set([
        'highway',
        'boundary',
        'place',
        'waterway',
        'natural',
        'landuse',
        'junction',
      ]);
      const cat = data.category || '';
      const rawName = (data.name || '').trim();

      let buildingName: string | null = null;
      if (rawName && !nonBuildingCategories.has(cat)) {
        buildingName = rawName;
      } else {
        const addr = data.address || {};
        for (const k of ['amenity', 'building', 'shop', 'office', 'tourism', 'leisure']) {
          if (addr[k]) {
            buildingName = addr[k];
            break;
          }
        }
      }

      // 日本の現場住所（番地まで）の構築
      const addr = data.address || {};
      const pref = addr.province || addr.state || '';
      const city = addr.city || addr.ward || addr.county || addr.town || addr.village || '';
      const town = addr.suburb || addr.quarter || addr.neighbourhood || '';
      const road = addr.road || '';
      const houseNum = addr.house_number || '';

      const addrParts = [pref, city, town].filter(Boolean);
      if (road && !road.endsWith('通り') && !road.startsWith('エレベーター')) {
        addrParts.push(road);
      }
      if (houseNum) {
        addrParts.push(houseNum);
      }

      let fullAddress = addrParts.join('');
      if (!fullAddress) {
        fullAddress = data.display_name || '';
      }

      // 建物名があれば建物名を出す。なければ現場住所を出す。
      const finalName = buildingName || fullAddress || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

      return {
        name: finalName,
        buildingName,
        fullAddress,
        isRegistered: false,
      };
    }
  } catch (e) {
    // fallback
  }

  // 3. フォールバック（HeartRails）
  const hrCity = await getMunicipalityName(lat, lon);
  return {
    name: hrCity || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    buildingName: null,
    fullAddress: hrCity || '',
    isRegistered: false,
  };
}

// POST: 位置情報記録（ブラウザまたはGPS Loggerアプリ）
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const serverSecret = await getOrInitLocationSecret();

    // 認証チェック
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
      const resolved = await resolveLocationDetails(lat, lon);
      resolvedPlace = resolved.name;
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

    // 1. シークレットキー表示モード
    if (mode === 'secret') {
      const secret = await getOrInitLocationSecret();
      return NextResponse.json({ success: true, secret });
    }

    // 2. 滞在・移動距離集計モード（3大活用機能）
    if (mode === 'summary' && date) {
      const dayStartUtc = new Date(`${date}T00:00:00+09:00`).toISOString();
      const dayEndUtc = new Date(`${date}T23:59:59.999+09:00`).toISOString();

      const [recordsRes, spots] = await Promise.all([
        supabaseAdmin
          .from('chrono_location_tracks')
          .select('*')
          .gte('recorded_at', dayStartUtc)
          .lte('recorded_at', dayEndUtc)
          .order('recorded_at', { ascending: true }),
        getRegisteredSpots(),
      ]);

      const tracks = recordsRes.data || [];

      // 総移動距離の計算
      let totalDistanceMeters = 0;
      for (let i = 1; i < tracks.length; i++) {
        const prev = tracks[i - 1];
        const curr = tracks[i];
        const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        if (dist < 50000) {
          totalDistanceMeters += dist;
        }
      }

      const totalDistanceKm = Math.round((totalDistanceMeters / 1000) * 10) / 10;
      const estimatedGasCost = Math.round((totalDistanceKm / 10) * 160);

      // 滞在ポイントの検出（15分以上、半径150m以内に留まった地点）
      const rawStays: Array<{
        startPoint: any;
        endTime: string;
        durationMinutes: number;
      }> = [];
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
            rawStays.push({
              startPoint,
              endTime: tracks[i - 1].recorded_at,
              durationMinutes,
            });
          }
          clusterStartIdx = i;
        }
      }

      // 各滞在の場所名（登録名最優先 -> 建物名 -> 現場住所）を順次解決
      const stays: any[] = [];
      for (const rs of rawStays) {
        const resolved = await resolveLocationDetails(
          rs.startPoint.latitude,
          rs.startPoint.longitude,
          spots
        );

        stays.push({
          placeName: resolved.name,
          buildingName: resolved.buildingName,
          fullAddress: resolved.fullAddress,
          isRegistered: resolved.isRegistered,
          spotCategory: resolved.registeredSpot?.category || null,
          registeredSpotId: resolved.registeredSpot?.id || null,
          latitude: rs.startPoint.latitude,
          longitude: rs.startPoint.longitude,
          startTime: rs.startPoint.recorded_at,
          endTime: rs.endTime,
          durationMinutes: rs.durationMinutes,
        });
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

    // 3. 通常の履歴取得（必要に応じて登録スポット名を反映）
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

    const [{ data, error }, spots] = await Promise.all([query, getRegisteredSpots()]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 登録スポットがある場合、該当座標のトラックのplace_nameを登録名でオーバーライド
    const records = (data || []).map((t) => {
      const matched = findMatchingSpot(t.latitude, t.longitude, spots);
      if (matched) {
        return { ...t, place_name: matched.name, is_registered_spot: true };
      }
      return t;
    });

    return NextResponse.json({ success: true, records });
  } catch (err: any) {
    console.error('GET /api/location error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

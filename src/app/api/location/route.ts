import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getRegisteredSpots,
  findMatchingSpot,
  calculateDistanceMeters,
  RegisteredSpot,
} from '@/lib/registeredSpots';
import { reverseGeocodeGoogle } from '@/lib/googleGeocoding';
import rawMuniMap from '@/lib/muniMap.json';

const muniMap: Record<string, string> = rawMuniMap;

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

// 国土地理院（GSI）公式APIによる市区町村・町丁目コードの解決（都道府県＋市区町村＋町丁目）
async function getGsiAddress(
  lat: number,
  lon: number
): Promise<{ municipality: string; wardOrCity: string; town: string; fullAddress: string } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
      {
        headers: { 'User-Agent': 'ChronoNexus/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const muniCd = data?.results?.muniCd;
      const lv01Nm = (data?.results?.lv01Nm || '').trim();

      if (muniCd && muniMap[muniCd]) {
        const municipality = muniMap[muniCd];
        const fullAddress = `${municipality}${lv01Nm}`;

        // 区または市町村名を抽出（手帳タイムライン短縮表示用）
        const kuMatch = municipality.match(/([^都道府県市区町村\s]+区)/);
        const cityMatch = municipality.match(/([^都道府県\s]+?[市町村])/);
        const wardOrCity = kuMatch ? kuMatch[1] : (cityMatch ? cityMatch[1] : municipality);

        return { municipality, wardOrCity, town: lv01Nm, fullAddress };
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
  wardOrCity: string; // 手帳右側用短縮名（区・市）
  isRegistered: boolean;
  registeredSpot?: RegisteredSpot;
}

// 高精度リバースジオコーダー（登録スポット最優先 -> GSI公式町名 + OSM建物名/番地）
export async function resolveLocationDetails(
  lat: number,
  lon: number,
  spots?: RegisteredSpot[],
  options?: { enableGoogleGeocoding?: boolean }
): Promise<ResolvedLocation> {
  // 1. 登録スポット（自宅・現場・会社等）の最優先判定（API呼び出し0回）
  const registeredList = spots || (await getRegisteredSpots());
  const matched = findMatchingSpot(lat, lon, registeredList);

  if (matched) {
    return {
      name: matched.name,
      buildingName: null,
      fullAddress: matched.address,
      wardOrCity: matched.name,
      isRegistered: true,
      registeredSpot: matched,
    };
  }

  // 2. Google Geocoding API による高精度番地・建物名・市区町村の解決（15分滞在判定時等の指定時のみ実行）
  const shouldCallGoogle = options?.enableGoogleGeocoding !== false;
  if (shouldCallGoogle) {
    const googleGeo = await reverseGeocodeGoogle(lat, lon);
    if (googleGeo && googleGeo.fullAddress) {
      const finalName = googleGeo.buildingName || googleGeo.fullAddress;
      return {
        name: finalName,
        buildingName: googleGeo.buildingName,
        fullAddress: googleGeo.fullAddress,
        wardOrCity: googleGeo.wardOrCity || finalName,
        isRegistered: false,
      };
    }
  }

  // 3. フォールバック: GSI公式住所（都道府県＋市区町村＋町丁目）と OpenStreetMap（建物名・番地）の並行取得
  const [gsiRes, osmData] = await Promise.all([
    getGsiAddress(lat, lon),
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ja&zoom=18&addressdetails=1`,
          {
            headers: { 'User-Agent': 'ChronoNexus/1.0' },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        if (nomRes.ok) {
          return await nomRes.json();
        }
      } catch (e) {
        // ignore
      }
      return null;
    })(),
  ]);

  let buildingName: string | null = null;
  let houseNumber: string = '';
  let roadName: string = '';

  if (osmData) {
    const nonBuildingCategories = new Set([
      'highway',
      'boundary',
      'place',
      'waterway',
      'natural',
      'landuse',
      'junction',
    ]);
    const cat = osmData.category || '';
    const rawName = (osmData.name || '').trim();

    if (rawName && !nonBuildingCategories.has(cat)) {
      buildingName = rawName;
    } else {
      const addr = osmData.address || {};
      for (const k of ['amenity', 'building', 'shop', 'office', 'tourism', 'leisure']) {
        if (addr[k]) {
          buildingName = addr[k];
          break;
        }
      }
    }

    const addr = osmData.address || {};
    houseNumber = (addr.house_number || '').trim();
    roadName = (addr.road || '').trim();
  }

  // 現場住所（番地まで）の構築
  let baseAddress = '';
  let wardOrCity = '';

  if (gsiRes) {
    baseAddress = gsiRes.fullAddress;
    wardOrCity = gsiRes.wardOrCity;
  } else if (osmData) {
    const addr = osmData.address || {};
    const pref = addr.province || addr.state || '';
    const city = addr.city || addr.ward || addr.county || addr.town || addr.village || '';
    const town = addr.suburb || addr.quarter || addr.neighbourhood || '';
    baseAddress = [pref, city, town].filter(Boolean).join('');
    wardOrCity = addr.city_district || addr.suburb || city || '';
  }

  // 番地・号や道路名があれば末尾に付加
  let fullAddress = baseAddress;
  if (houseNumber) {
    fullAddress = `${fullAddress}${houseNumber}`;
  } else if (roadName && !fullAddress.includes(roadName) && !roadName.startsWith('エレベーター')) {
    fullAddress = `${fullAddress} ${roadName}`;
  }

  if (!fullAddress) {
    fullAddress = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    wardOrCity = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }

  const finalName = buildingName || fullAddress;

  return {
    name: finalName,
    buildingName,
    fullAddress,
    wardOrCity: wardOrCity || finalName,
    isRegistered: false,
  };
}

// POST: 位置情報記録（ブラウザまたはGPS Loggerアプリ）
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const serverSecret = await getOrInitLocationSecret();

    // 認証チェック
    let reqSecret =
      req.headers.get('x-location-secret') ||
      searchParams.get('secret') ||
      (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

    // Basic認証サポート（OwnTracksのユーザー名/パスワード送信に対応）
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf8');
        const [u, p] = decoded.split(':');
        if (p === serverSecret || u === serverSecret) {
          reqSecret = serverSecret;
        }
      } catch (_) {}
    }

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
    const userAgent = (req.headers.get('user-agent') || '').toLowerCase();
    let isOwnTracks = userAgent.includes('owntracks');

    if (contentType.includes('application/json')) {
      const body = await req.json();

      if (body._type) {
        isOwnTracks = true;
      }

      // OwnTracksの非位置情報パケット（_type: "waypoint", "configuration"等）は正常終了でスキップ
      if (body._type && body._type !== 'location') {
        return NextResponse.json([]);
      }

      lat = parseFloat(body.latitude ?? body.lat);
      lon = parseFloat(body.longitude ?? body.lon);
      accuracy = body.accuracy != null ? parseFloat(body.accuracy) : (body.acc != null ? parseFloat(body.acc) : null);

      // OwnTracks の tst (UNIX秒) に対応
      if (typeof body.tst === 'number') {
        recordedAt = new Date(body.tst * 1000).toISOString();
      } else if (body.recordedAt || body.time) {
        recordedAt = body.recordedAt || body.time;
      }

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
      // 生ログ受信（移動・通過点）時は Google API を叩かず、登録スポットまたは国土地理院（無料）で高速記録
      const resolved = await resolveLocationDetails(lat, lon, undefined, { enableGoogleGeocoding: false });
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

    if (isOwnTracks) {
      // OwnTracks HTTPプロトコル仕様（周囲フレンド情報配列として [] を200 OKで返却）
      return NextResponse.json([]);
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

      // 各滞在の場所名（登録名最優先 -> 建物名 -> 番地まで詳細住所）を解決
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
          wardOrCity: resolved.wardOrCity,
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

    const records = (data || []).map((t) => {
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

    return NextResponse.json({ success: true, records });
  } catch (err: any) {
    console.error('GET /api/location error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

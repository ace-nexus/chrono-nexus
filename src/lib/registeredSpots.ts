import { supabaseAdmin } from './supabase';

export interface RegisteredSpot {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  category: 'home' | 'site' | 'office' | 'client' | 'other';
  createdAt: string;
  updatedAt: string;
}

// 2点間の距離（Haversineの公式、メートル）
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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

// 登録スポット一覧の取得
export async function getRegisteredSpots(): Promise<RegisteredSpot[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('*')
      .like('user_id', 'spot_%')
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.error('getRegisteredSpots error:', error);
      return [];
    }

    const spots: RegisteredSpot[] = [];
    for (const row of data) {
      try {
        const payload = JSON.parse(row.access_token);
        spots.push({
          id: row.user_id.replace(/^spot_/, ''),
          name: payload.name || row.scope || '未命名スポット',
          address: payload.address || row.refresh_token || '',
          latitude: Number(payload.latitude ?? payload.lat),
          longitude: Number(payload.longitude ?? payload.lon),
          radiusMeters: Number(payload.radiusMeters ?? payload.radius ?? 150),
          category: payload.category || row.token_type || 'site',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      } catch (e) {
        // payload parse error
      }
    }

    return spots;
  } catch (err) {
    console.error('getRegisteredSpots exception:', err);
    return [];
  }
}

// 座標から最も近い登録スポットを検索
export function findMatchingSpot(
  lat: number,
  lon: number,
  spots: RegisteredSpot[]
): RegisteredSpot | null {
  let closestSpot: RegisteredSpot | null = null;
  let minDistance = Infinity;

  for (const spot of spots) {
    if (isNaN(spot.latitude) || isNaN(spot.longitude)) continue;
    const dist = calculateDistanceMeters(lat, lon, spot.latitude, spot.longitude);
    const threshold = spot.radiusMeters || 150;
    if (dist <= threshold && dist < minDistance) {
      minDistance = dist;
      closestSpot = spot;
    }
  }

  return closestSpot;
}

// スポットの保存（新規または更新）
export async function saveRegisteredSpot(spotData: {
  id?: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  category?: 'home' | 'site' | 'office' | 'client' | 'other';
}): Promise<RegisteredSpot> {
  const spotId = spotData.id || `s_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userId = `spot_${spotId}`;
  const now = new Date().toISOString();

  const spotObj: RegisteredSpot = {
    id: spotId,
    name: spotData.name.trim(),
    address: spotData.address.trim(),
    latitude: spotData.latitude,
    longitude: spotData.longitude,
    radiusMeters: spotData.radiusMeters || 150,
    category: spotData.category || 'site',
    createdAt: now,
    updatedAt: now,
  };

  const payload = {
    user_id: userId,
    access_token: JSON.stringify(spotObj),
    scope: spotObj.name,
    refresh_token: spotObj.address,
    token_type: spotObj.category,
    updated_at: now,
  };

  const { error } = await supabaseAdmin
    .from('chrono_google_tokens')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`Failed to save spot: ${error.message}`);
  }

  // 過去の該当近傍ログ（chrono_location_tracks）を遡及して一括更新
  await retroactiveUpdateLocationTracks(spotObj);

  return spotObj;
}

// スポットの削除
export async function deleteRegisteredSpot(id: string): Promise<boolean> {
  const userId = `spot_${id}`;
  const { error } = await supabaseAdmin
    .from('chrono_google_tokens')
    .delete()
    .eq('user_id', userId);

  return !error;
}

// 近傍の過去位置情報ログを登録名に遡及更新
export async function retroactiveUpdateLocationTracks(spot: RegisteredSpot): Promise<number> {
  try {
    // 緯度経度の概算バウンディングボックス（約500m圏内）を取得
    const latDelta = 0.005;
    const lonDelta = 0.005;

    const { data: tracks, error } = await supabaseAdmin
      .from('chrono_location_tracks')
      .select('id, latitude, longitude')
      .gte('latitude', spot.latitude - latDelta)
      .lte('latitude', spot.latitude + latDelta)
      .gte('longitude', spot.longitude - lonDelta)
      .lte('longitude', spot.longitude + lonDelta);

    if (error || !tracks || tracks.length === 0) return 0;

    const matchingIds: string[] = [];
    for (const t of tracks) {
      const dist = calculateDistanceMeters(spot.latitude, spot.longitude, t.latitude, t.longitude);
      if (dist <= (spot.radiusMeters || 150)) {
        matchingIds.push(t.id);
      }
    }

    if (matchingIds.length > 0) {
      // 一括更新
      const { error: updateErr } = await supabaseAdmin
        .from('chrono_location_tracks')
        .update({ place_name: spot.name })
        .in('id', matchingIds);

      if (updateErr) {
        console.error('retroactiveUpdateLocationTracks update error:', updateErr);
      }
      return matchingIds.length;
    }

    return 0;
  } catch (err) {
    console.error('retroactiveUpdateLocationTracks error:', err);
    return 0;
  }
}

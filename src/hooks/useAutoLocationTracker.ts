'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
  place_name?: string;
}

// 2点間の距離を計算（Haversineの公式、単位: メートル）
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // 地球の半径 (m)
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

export function useAutoLocationTracker(userId: string = 'owner') {
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<LocationRecord | null>(null);
  const [lastSavedLocation, setLastSavedLocation] = useState<LocationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastSavedRef = useRef<LocationRecord | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  // サーバーへ位置情報を送信して保存
  const saveLocationToServer = useCallback(async (record: LocationRecord) => {
    try {
      const res = await fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          latitude: record.latitude,
          longitude: record.longitude,
          accuracy: record.accuracy,
          recordedAt: record.recorded_at,
          placeName: record.place_name || null,
        }),
      });

      if (res.ok) {
        setLastSavedLocation(record);
        lastSavedRef.current = record;
        lastSaveTimeRef.current = Date.now();
        console.log('[GPS Auto-Track] 位置を自動記録しました:', record.latitude, record.longitude);
      }
    } catch (err) {
      console.error('[GPS Auto-Track] 保存エラー:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('お使いのブラウザは位置情報に対応していません。');
      return;
    }

    setIsTracking(true);

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const nowRecord: LocationRecord = {
          latitude,
          longitude,
          accuracy: accuracy || null,
          recorded_at: new Date().toISOString(),
        };

        setCurrentLocation(nowRecord);
        setError(null);

        // 自動保存の判定ロジック（省エネ＆重複排除）:
        // 1. 初回記録
        // 2. または前回の記録地点から100メートル以上移動した
        // 3. または前回の記録から15分以上経過した
        const last = lastSavedRef.current;
        const timeSinceLastSave = Date.now() - lastSaveTimeRef.current;

        if (!last) {
          saveLocationToServer(nowRecord);
        } else {
          const distance = calculateDistance(last.latitude, last.longitude, latitude, longitude);
          if (distance >= 100 || timeSinceLastSave >= 15 * 60 * 1000) {
            saveLocationToServer(nowRecord);
          }
        }
      },
      (err) => {
        console.warn('[GPS Auto-Track] 取得警告:', err.message);
        setError(`位置情報取得エラー: ${err.message}`);
      },
      {
        enableHighAccuracy: true, // 高精度GPS
        timeout: 20000,
        maximumAge: 10000, // 10秒以内のキャッシュ
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      setIsTracking(false);
    };
  }, [saveLocationToServer]);

  // 手動で「今ここ！」を即座に記録する関数
  const recordManual = useCallback(async () => {
    if (!currentLocation) return;
    await saveLocationToServer(currentLocation);
  }, [currentLocation, saveLocationToServer]);

  return {
    isTracking,
    currentLocation,
    lastSavedLocation,
    error,
    recordManual,
  };
}
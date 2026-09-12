'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  Clock,
  Car,
  Navigation,
  Calendar,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  Tag,
  Plus,
  Check,
  Building,
  Home,
  Briefcase,
  Users,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Fuel,
  Sparkles,
  Loader2,
  Layers,
  Settings,
} from 'lucide-react';
import SpotRegistrationModal from './SpotRegistrationModal';

interface TimelineStayItem {
  type: 'stay';
  stayIndex: number;
  placeName: string;
  buildingName?: string | null;
  fullAddress?: string;
  wardOrCity?: string;
  isRegistered?: boolean;
  spotCategory?: string | null;
  registeredSpotId?: string | null;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

interface TimelineMoveItem {
  type: 'move';
  mode: 'drive' | 'walk';
  startTime: string;
  endTime: string;
  durationMinutes: number;
  distanceKm: number;
  path: Array<{ lat: number; lng: number }>;
}

type TimelineSegment = TimelineStayItem | TimelineMoveItem;

interface GoogleMapsTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate: string;
  onAddScheduleFromStay?: (stay: { placeName: string; startTime: string; endTime: string }) => void;
  lastRecordedAt?: string | null;
  onOpenSettings?: () => void;
  initialFocusPoint?: {
    latitude: number;
    longitude: number;
    label: string;
    fullName?: string;
    durationMinutes?: number;
    hour: number;
  } | null;
}

export default function GoogleMapsTimeline({
  isOpen,
  onClose,
  initialDate,
  onAddScheduleFromStay,
  lastRecordedAt,
  onOpenSettings,
  initialFocusPoint = null,
}: GoogleMapsTimelineProps) {
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false);
  const [isFullscreenMap, setIsFullscreenMap] = useState<boolean>(false);

  const [totalDistanceKm, setTotalDistanceKm] = useState<number>(0);
  const [estimatedGasCost, setEstimatedGasCost] = useState<number>(0);
  const [timelineSegments, setTimelineSegments] = useState<TimelineSegment[]>([]);
  const [fullPath, setFullPath] = useState<Array<{ lat: number; lng: number }>>([]);
  const [lastTrack, setLastTrack] = useState<{ latitude: number; longitude: number; recorded_at: string } | null>(null);

  // 選択中のセグメント（タップで地図フォーカス）
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);

  // スポット登録モーダル
  const [showSpotModal, setShowSpotModal] = useState<boolean>(false);
  const [spotModalTarget, setSpotModalTarget] = useState<{
    initialName?: string;
    initialAddress?: string;
    initialBuildingName?: string | null;
    latitude: number;
    longitude: number;
  } | null>(null);

  // 転記完了トースト
  const [transferredStayIdx, setTransferredStayIdx] = useState<number | null>(null);

  // 地図オブジェクト参照
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const activePolylineRef = useRef<any>(null);
  const focusMarkerRef = useRef<any>(null);
  const focusInfoWindowRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedDate(initialDate);
      fetchTimeline(initialDate);
    }
  }, [isOpen, initialDate]);

  // Google Maps JavaScript APIの動的読み込み
  useEffect(() => {
    if (!isOpen) return;

    if (typeof window !== 'undefined' && (window as any).google?.maps) {
      setIsMapLoaded(true);
      return;
    }

    const loadGoogleMapsScript = (key: string) => {
      if (!key) return;
      const scriptId = 'google-maps-script';
      if (document.getElementById(scriptId)) {
        setIsMapLoaded(true);
        return;
      }
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&language=ja`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        setIsMapLoaded(true);
      };
      document.head.appendChild(script);
    };

    const envKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (envKey) {
      loadGoogleMapsScript(envKey);
    } else {
      fetch('/api/location/config')
        .then((res) => res.json())
        .then((data) => {
          if (data.apiKey) {
            loadGoogleMapsScript(data.apiKey);
          }
        })
        .catch((e) => console.error('Load maps config error:', e));
    }
  }, [isOpen]);

  // データ取得
  const fetchTimeline = async (dateStr: string) => {
    try {
      setIsLoading(true);
      setActiveSegmentIndex(null);
      const res = await fetch(`/api/location?mode=summary&date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setTotalDistanceKm(data.totalDistanceKm || 0);
        setEstimatedGasCost(data.estimatedGasCost || 0);
        setTimelineSegments(data.timelineSegments || []);
        setFullPath(data.fullPath || []);
        setLastTrack(data.lastTrack || null);
      }
    } catch (e) {
      console.error('Fetch timeline error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Googleマップの初期化とマーカー・ポリライン描画
  useEffect(() => {
    if (!isMapLoaded || !mapContainerRef.current || !isOpen) return;

    const google = (window as any).google;
    if (!google?.maps) return;

    // 初回マップインスタンス生成
    if (!mapInstanceRef.current) {
      const defaultCenter = fullPath.length > 0
        ? { lat: fullPath[0].lat, lng: fullPath[0].lng }
        : { lat: 35.4894, lng: 139.5763 }; // 横浜羽沢付近

      mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'on' }],
          },
        ],
      });
    }

    const map = mapInstanceRef.current;

    // 既存マーカーとポリラインのクリア
    if (polylineRef.current) polylineRef.current.setMap(null);
    if (activePolylineRef.current) activePolylineRef.current.setMap(null);
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();

    // 1. 今日の全走行ルート（青いポリライン）の描画
    if (fullPath.length > 1) {
      const pathCoordinates = fullPath.map((p) => {
        const pt = new google.maps.LatLng(p.lat, p.lng);
        bounds.extend(pt);
        return pt;
      });

      polylineRef.current = new google.maps.Polyline({
        path: pathCoordinates,
        geodesic: true,
        strokeColor: '#3B82F6', // Google Blue
        strokeOpacity: 0.8,
        strokeWeight: 5,
        map,
      });
    } else if (fullPath.length === 1) {
      bounds.extend(new google.maps.LatLng(fullPath[0].lat, fullPath[0].lng));
    }

    // 2. 滞在スポットの番号付きマーカーピン
    timelineSegments.forEach((seg, idx) => {
      if (seg.type !== 'stay') return;

      const pos = new google.maps.LatLng(seg.latitude, seg.longitude);
      bounds.extend(pos);

      // マーカーのカスタムSVGアイコン（Google Maps Timelineスタイルの丸バッジ）
      const isHome = seg.spotCategory === 'home' || seg.placeName.includes('自宅');
      const badgeColor = isHome ? '#10B981' : '#4F46E5'; // 自宅は緑、現場は紫紺

      const markerIcon = {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
            <path d="M17 0C7.6 0 0 7.6 0 17C0 29.8 17 42 17 42C17 42 34 29.8 34 17C34 7.6 26.4 0 17 0Z" fill="${badgeColor}"/>
            <circle cx="17" cy="16" r="12" fill="white"/>
            <text x="17" y="21" font-size="13" font-weight="900" font-family="sans-serif" fill="${badgeColor}" text-anchor="middle">${seg.stayIndex}</text>
          </svg>
        `)}`,
        scaledSize: new google.maps.Size(34, 42),
        anchor: new google.maps.Point(17, 42),
      };

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `${seg.stayIndex}. ${seg.placeName}`,
        icon: markerIcon,
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family: sans-serif; padding: 4px; max-width: 220px;">
            <div style="font-size: 11px; font-weight: bold; color: ${badgeColor}; margin-bottom: 2px;">
              #${seg.stayIndex} ${isHome ? '🏠 自宅' : '🏢 現場・スポット'}
            </div>
            <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-bottom: 4px;">
              ${seg.placeName}
            </div>
            <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">
              ${new Date(seg.startTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 〜 ${new Date(seg.endTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} (${seg.durationMinutes}分滞在)
            </div>
            ${seg.fullAddress ? `<div style="font-size: 10px; color: #94a3b8;">${seg.fullAddress}</div>` : ''}
          </div>
        `,
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
        setActiveSegmentIndex(idx);
      });

      markersRef.current.push(marker);
    });

    // 3. 最新の現在地ピン（青いパルス円）
    if (lastTrack) {
      const currentPos = new google.maps.LatLng(lastTrack.latitude, lastTrack.longitude);
      bounds.extend(currentPos);

      const currentMarker = new google.maps.Marker({
        position: currentPos,
        map,
        title: '最新の現在地',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#2563EB',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
        },
      });
      markersRef.current.push(currentMarker);
    }

    // 全体が収まるようにズーム・パン
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
    }
  }, [isMapLoaded, timelineSegments, fullPath, lastTrack, isOpen]);

  // セグメントタップ時の地図フォーカス
  const handleFocusSegment = (seg: TimelineSegment, idx: number) => {
    setActiveSegmentIndex(idx);
    if (!mapInstanceRef.current || typeof window === 'undefined') return;
    const google = (window as any).google;
    if (!google?.maps) return;

    const map = mapInstanceRef.current;

    // 既存のアクティブハイライト線をクリア
    if (activePolylineRef.current) {
      activePolylineRef.current.setMap(null);
      activePolylineRef.current = null;
    }

    if (seg.type === 'stay') {
      const pos = new google.maps.LatLng(seg.latitude, seg.longitude);
      map.panTo(pos);
      map.setZoom(17);
    } else if (seg.type === 'move' && seg.path && seg.path.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      const coords = seg.path.map((p) => {
        const pt = new google.maps.LatLng(p.lat, p.lng);
        bounds.extend(pt);
        return pt;
      });

      activePolylineRef.current = new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: '#EA580C', // ハイライトはオレンジ
        strokeOpacity: 0.9,
        strokeWeight: 7,
        map,
      });

      map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
    }
  };

  // スケジュール横の代表地点タップからの連動フォーカス処理
  useEffect(() => {
    if (!isOpen || !isMapLoaded || !initialFocusPoint || !mapInstanceRef.current) return;
    const google = (window as any).google;
    if (!google?.maps) return;

    const map = mapInstanceRef.current;
    const targetHour = initialFocusPoint.hour;

    // 既存のフォーカスマーカー・インフォウィンドウをクリア
    if (focusMarkerRef.current) {
      focusMarkerRef.current.setMap(null);
      focusMarkerRef.current = null;
    }
    if (focusInfoWindowRef.current) {
      focusInfoWindowRef.current.close();
      focusInfoWindowRef.current = null;
    }

    // 1. timelineSegmentsの中から該当時間帯の滞在セグメントを検索
    let matchedSegIdx = -1;
    for (let i = 0; i < timelineSegments.length; i++) {
      const seg = timelineSegments[i];
      if (seg.type === 'stay') {
        const startH = new Date(seg.startTime).getHours();
        const endH = new Date(seg.endTime).getHours();
        if (targetHour >= startH && targetHour <= endH) {
          matchedSegIdx = i;
          break;
        }
      }
    }

    if (matchedSegIdx !== -1) {
      handleFocusSegment(timelineSegments[matchedSegIdx], matchedSegIdx);
    } else {
      // 滞在セグメント外（移動中や短い滞在等）、直接代表地点へズーム＆ピン表示
      const pos = new google.maps.LatLng(initialFocusPoint.latitude, initialFocusPoint.longitude);
      map.panTo(pos);
      map.setZoom(16);

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `${targetHour}:00〜${targetHour + 1}:00の代表地点`,
        animation: google.maps.Animation.DROP,
        icon: {
          path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#EF4444',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        },
      });

      const info = new google.maps.InfoWindow({
        content: `
          <div style="font-family: sans-serif; padding: 4px; max-width: 220px;">
            <div style="font-size: 11px; font-weight: bold; color: #ef4444; margin-bottom: 2px;">
              📍 ${targetHour}:00〜${targetHour + 1}:00 の代表地点
            </div>
            <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-bottom: 3px;">
              ${initialFocusPoint.label || initialFocusPoint.fullName || '代表地点'}
            </div>
            ${
              initialFocusPoint.durationMinutes && initialFocusPoint.durationMinutes > 0
                ? `<div style="font-size: 11px; color: #64748b;">推定滞在：約${initialFocusPoint.durationMinutes}分</div>`
                : ''
            }
          </div>
        `,
      });

      info.open(map, marker);
      focusMarkerRef.current = marker;
      focusInfoWindowRef.current = info;
    }
  }, [isOpen, isMapLoaded, initialFocusPoint, timelineSegments]);

  // 全体表示リセット
  const handleResetView = () => {
    setActiveSegmentIndex(null);
    if (!mapInstanceRef.current || typeof window === 'undefined') return;
    const google = (window as any).google;
    if (!google?.maps) return;

    if (activePolylineRef.current) {
      activePolylineRef.current.setMap(null);
      activePolylineRef.current = null;
    }

    const bounds = new google.maps.LatLngBounds();
    fullPath.forEach((p) => bounds.extend(new google.maps.LatLng(p.lat, p.lng)));
    if (!bounds.isEmpty()) {
      mapInstanceRef.current.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
    }
  };

  // スポット登録モーダルを開く
  const handleOpenSpotModal = (stay: TimelineStayItem) => {
    setSpotModalTarget({
      initialName: stay.placeName,
      initialAddress: stay.fullAddress || '',
      initialBuildingName: stay.buildingName,
      latitude: stay.latitude,
      longitude: stay.longitude,
    });
    setShowSpotModal(true);
  };

  // 日報・スケジュールへの転記
  const handleTransferToSchedule = (stay: TimelineStayItem) => {
    if (onAddScheduleFromStay) {
      const sStr = new Date(stay.startTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const eStr = new Date(stay.endTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      onAddScheduleFromStay({
        placeName: stay.placeName,
        startTime: stay.startTime,
        endTime: stay.endTime,
      });
      setTransferredStayIdx(stay.stayIndex);
      setTimeout(() => setTransferredStayIdx(null), 3000);
    }
  };

  // 前日・翌日ナビゲーション
  const changeDateByDays = (days: number) => {
    const current = new Date(`${selectedDate}T00:00:00`);
    current.setDate(current.getDate() + days);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const nextDate = `${y}-${m}-${d}`;
    setSelectedDate(nextDate);
    fetchTimeline(nextDate);
  };

  // 滞在箇所数
  const stayCount = useMemo(() => {
    return timelineSegments.filter((s) => s.type === 'stay').length;
  }, [timelineSegments]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl w-full max-w-5xl h-[92vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* ── 1. ヘッダー ── */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base tracking-wide flex items-center gap-1.5">
                  今日の足跡タイムライン
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/20">
                    Google Maps 仕様
                  </span>
                </h3>
              </div>
              <p className="text-[11px] text-slate-300">
                {lastRecordedAt
                  ? `最新受信: ${new Date(lastRecordedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                  : '滞在と移動をGoogleマップ形式で完全再現'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-1.5 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer flex items-center gap-1 text-xs"
                title="GPS設定・接続キー・ガソリン単価設定"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px]">設定・キー</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── 2. 日付ナビゲーション ＆ 1日サマリーバー ── */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          {/* 日付切り替え */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => changeDateByDays(-1)}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition"
              title="前日"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 font-bold text-slate-800 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  fetchTimeline(e.target.value);
                }}
                className="font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => changeDateByDays(1)}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition"
              title="翌日"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date().toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).replaceAll('/', '-');
                setSelectedDate(today);
                fetchTimeline(today);
              }}
              className="px-2 py-1 rounded-lg text-slate-600 hover:text-indigo-600 font-semibold text-[11px] hover:bg-slate-200 transition ml-1"
            >
              今日
            </button>
          </div>

          {/* 集計サマリーバッジ */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-100 text-blue-900 font-bold">
              <Car className="w-3.5 h-3.5 text-blue-600" />
              <span>移動: {totalDistanceKm} km</span>
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100 text-emerald-900 font-bold">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span>滞在: {stayCount} 箇所</span>
            </div>
            {totalDistanceKm > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-100 text-amber-900 font-bold">
                <Fuel className="w-3.5 h-3.5 text-amber-600" />
                <span>目安ガソリン代: 約 ¥{estimatedGasCost}</span>
              </div>
            )}
            <button
              onClick={() => fetchTimeline(selectedDate)}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition flex items-center gap-1"
              title="更新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── 3. メインエリア（上部/左側：Googleマップ、下部/右側：タイムラインリスト） ── */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
          {/* 地図コンテナ（PC: 左側50〜60% / スマホ: 上部40〜45%） */}
          <div
            className={`relative transition-all duration-200 bg-slate-100 ${
              isFullscreenMap
                ? 'absolute inset-0 z-20 w-full h-full'
                : 'w-full md:w-7/12 h-[38vh] md:h-full border-b md:border-b-0 md:border-r border-slate-200 shrink-0'
            }`}
          >
            {/* Google Map 実体コンテナ */}
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* 地図ロード中表示 */}
            {!isMapLoaded && (
              <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="text-xs font-bold">Googleマップを読み込み中...</span>
              </div>
            )}

            {/* 地図コントロールフローティングボタン */}
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              <button
                type="button"
                onClick={handleResetView}
                className="px-2.5 py-1.5 bg-white/95 backdrop-blur-xs hover:bg-white text-slate-700 text-xs font-bold rounded-xl shadow-md border border-slate-200 flex items-center gap-1 transition"
                title="全体ルートを表示"
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>全体表示</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreenMap(!isFullscreenMap)}
                className="p-1.5 bg-white/95 backdrop-blur-xs hover:bg-white text-slate-700 rounded-xl shadow-md border border-slate-200 transition"
                title={isFullscreenMap ? '縮小' : '地図を全画面表示'}
              >
                {isFullscreenMap ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>

            {/* 地図下部のミニステータス */}
            <div className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] px-2.5 py-1 rounded-lg pointer-events-none flex items-center gap-1.5 shadow">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span>全移動ルート: {totalDistanceKm}km ({fullPath.length}地点)</span>
            </div>
          </div>

          {/* タイムラインリスト（PC: 右側40〜50% / スマホ: 下部55〜60%） */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 bg-slate-50/60 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-blue-600" />
                タイムライン（滞在 ＆ 移動）
              </h4>
              <span className="text-[11px] text-slate-400 font-medium">
                項目タップで地図がフォーカス
              </span>
            </div>

            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
                <p className="text-xs font-bold">タイムラインを集計中...</p>
              </div>
            ) : timelineSegments.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">
                  {selectedDate} の足跡データはありません
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  OwnTracksアプリが起動し位置情報が送信されると、ここにGoogleマップ形式で自動記録されます。
                </p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-3">
                {/* タイムラインの縦ガイドライン */}
                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-blue-200 -z-0" />

                {timelineSegments.map((seg, idx) => {
                  const isActive = activeSegmentIndex === idx;

                  // ── A. 滞在カード（訪問地） ──
                  if (seg.type === 'stay') {
                    const startStr = new Date(seg.startTime).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const endStr = new Date(seg.endTime).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const hours = Math.floor(seg.durationMinutes / 60);
                    const mins = seg.durationMinutes % 60;
                    const durationStr = hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;

                    const isHome = seg.spotCategory === 'home' || seg.placeName.includes('自宅');

                    return (
                      <div
                        key={`stay-${idx}`}
                        className="relative z-10"
                        onClick={() => handleFocusSegment(seg, idx)}
                      >
                        {/* タイムラインの丸アイコン */}
                        <div
                          className={`absolute -left-6 top-3.5 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center font-black text-[11px] shadow-sm transition-transform ${
                            isActive
                              ? 'bg-blue-600 text-white scale-110 ring-2 ring-blue-400'
                              : isHome
                              ? 'bg-emerald-600 text-white'
                              : 'bg-indigo-600 text-white'
                          }`}
                        >
                          {seg.stayIndex}
                        </div>

                        {/* カード本体 */}
                        <div
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-2xs ${
                            isActive
                              ? 'bg-blue-50/80 border-blue-400 ring-2 ring-blue-300/50'
                              : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h5 className="font-bold text-sm text-slate-900 leading-tight break-words">
                                  {seg.placeName}
                                </h5>

                                {seg.isRegistered ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-200">
                                    {isHome ? <Home className="w-3 h-3 text-emerald-600" /> : <Building className="w-3 h-3" />}
                                    {isHome ? '自宅' : '登録現場'}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenSpotModal(seg);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200 transition"
                                    title="現場名を登録"
                                  >
                                    <Tag className="w-3 h-3 text-amber-600" />
                                    現場名を登録
                                  </button>
                                )}
                              </div>

                              {/* 住所 */}
                              {seg.fullAddress && seg.fullAddress !== seg.placeName && (
                                <p className="text-[11px] text-slate-500 mb-1.5 break-words">
                                  {seg.fullAddress}
                                </p>
                              )}

                              {/* 時間帯 ＆ 滞在時間 */}
                              <div className="flex items-center gap-2.5 text-xs text-slate-600 font-medium">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  {startStr} 〜 {endStr}
                                </span>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px]">
                                  滞在 {durationStr}
                                </span>
                              </div>
                            </div>

                            {/* アクションボタン */}
                            <div className="flex flex-col gap-1.5 shrink-0 self-start">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTransferToSchedule(seg);
                                }}
                                className={`px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition shadow-2xs ${
                                  transferredStayIdx === seg.stayIndex
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                                }`}
                                title="この滞在を本日のスケジュール（予定・日報）にワンタップで転記"
                              >
                                {transferredStayIdx === seg.stayIndex ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>転記済</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>日報へ転記</span>
                                  </>
                                )}
                              </button>

                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${seg.latitude},${seg.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 text-slate-400 hover:text-blue-600 transition flex items-center justify-center"
                                title="Googleマップアプリで開く"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── B. 移動カード（車移動区間） ──
                  if (seg.type === 'move') {
                    const startStr = new Date(seg.startTime).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const endStr = new Date(seg.endTime).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={`move-${idx}`}
                        className="relative z-10 my-1 cursor-pointer group"
                        onClick={() => handleFocusSegment(seg, idx)}
                      >
                        {/* タイムラインの車アイコン */}
                        <div
                          className={`absolute -left-5 top-2 w-4 h-4 rounded-full border border-white flex items-center justify-center transition-colors ${
                            isActive ? 'bg-orange-500 text-white ring-2 ring-orange-300' : 'bg-slate-300 text-slate-600 group-hover:bg-blue-400 group-hover:text-white'
                          }`}
                        >
                          <Car className="w-2.5 h-2.5" />
                        </div>

                        {/* 移動情報ピル */}
                        <div
                          className={`py-1.5 px-3 rounded-xl border inline-flex items-center gap-2.5 text-xs font-semibold transition ${
                            isActive
                              ? 'bg-orange-50 border-orange-300 text-orange-900 shadow-2xs'
                              : 'bg-white/80 border-slate-200 text-slate-600 hover:bg-blue-50/60 hover:border-blue-200'
                          }`}
                        >
                          <div className="flex items-center gap-1 font-bold text-slate-800">
                            <Car className={`w-3.5 h-3.5 ${isActive ? 'text-orange-600' : 'text-blue-500'}`} />
                            <span>車で移動</span>
                          </div>
                          <span className="text-slate-400">・</span>
                          <span className="font-bold text-slate-700">{seg.distanceKm} km</span>
                          <span className="text-slate-400">・</span>
                          <span className="text-slate-500">{seg.durationMinutes}分 ({startStr}〜{endStr})</span>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            )}
          </div>
        </div>

        {/* スポット登録モーダル */}
        {spotModalTarget && (
          <SpotRegistrationModal
            isOpen={showSpotModal}
            onClose={() => {
              setShowSpotModal(false);
              setSpotModalTarget(null);
              fetchTimeline(selectedDate);
            }}
            initialName={spotModalTarget.initialName}
            initialAddress={spotModalTarget.initialAddress}
            initialBuildingName={spotModalTarget.initialBuildingName}
            latitude={spotModalTarget.latitude}
            longitude={spotModalTarget.longitude}
            onRegistered={() => {
              fetchTimeline(selectedDate);
            }}
          />
        )}
      </div>
    </div>
  );
}

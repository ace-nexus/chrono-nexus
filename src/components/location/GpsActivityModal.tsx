'use client';

import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Clock,
  Car,
  Fuel,
  RefreshCw,
  Copy,
  Check,
  X,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Calendar,
  Sparkles,
  Loader2,
  CheckCircle2,
  Plus,
  Trash2,
  Building,
  Home,
  Briefcase,
  Users,
  Tag,
} from 'lucide-react';
import SpotRegistrationModal from './SpotRegistrationModal';

interface GpsActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  onSyncGoogleCalendar?: () => void;
  onDisconnectGoogleCalendar?: () => void;
  isSyncingCalendar?: boolean;
  googleConnected?: boolean;
  lastRecordedAt?: string | null;
  onAddActivityFromStay?: (stay: { placeName: string; startTime: string; endTime: string }) => void;
}

interface StayItem {
  placeName: string;
  buildingName?: string | null;
  fullAddress?: string;
  isRegistered?: boolean;
  spotCategory?: string | null;
  registeredSpotId?: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  latitude: number;
  longitude: number;
}

interface SpotItem {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  category: 'home' | 'site' | 'office' | 'client' | 'other';
  createdAt: string;
}

export default function GpsActivityModal({
  isOpen,
  onClose,
  currentDate,
  onSyncGoogleCalendar,
  onDisconnectGoogleCalendar,
  isSyncingCalendar,
  googleConnected,
  lastRecordedAt,
  onAddActivityFromStay,
}: GpsActivityModalProps) {
  const [activeSubTab, setActiveSubTab] = useState<'stays' | 'expenses' | 'spots' | 'settings'>('stays');
  const [summaryDate, setSummaryDate] = useState<string>(currentDate);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<{
    totalDistanceKm: number;
    estimatedGasCost: number;
    totalTracks: number;
    stays: StayItem[];
  }>({
    totalDistanceKm: 0,
    estimatedGasCost: 0,
    totalTracks: 0,
    stays: [],
  });

  const [spots, setSpots] = useState<SpotItem[]>([]);
  const [isLoadingSpots, setIsLoadingSpots] = useState<boolean>(false);

  // スポット登録モーダル状態
  const [showSpotModal, setShowSpotModal] = useState<boolean>(false);
  const [spotModalTarget, setSpotModalTarget] = useState<{
    initialName?: string;
    initialAddress?: string;
    initialBuildingName?: string | null;
    latitude: number;
    longitude: number;
  } | null>(null);

  const [secretKey, setSecretKey] = useState<string>('');
  const [hasCopiedSecret, setHasCopiedSecret] = useState<boolean>(false);
  const [hasCopiedUrl, setHasCopiedUrl] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setSummaryDate(currentDate);
      fetchSummary(currentDate);
      fetchSpots();
      fetchSecret();
    }
  }, [isOpen, currentDate]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchSummary = async (dateStr: string) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/location?mode=summary&date=${dateStr}`);
      if (res.ok) {
        const d = await res.json();
        setSummaryData({
          totalDistanceKm: d.totalDistanceKm || 0,
          estimatedGasCost: d.estimatedGasCost || 0,
          totalTracks: d.totalTracks || 0,
          stays: d.stays || [],
        });
      }
    } catch (e) {
      console.error('Fetch GPS summary error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSpots = async () => {
    try {
      setIsLoadingSpots(true);
      const res = await fetch('/api/location/spots');
      if (res.ok) {
        const d = await res.json();
        setSpots(d.spots || []);
      }
    } catch (e) {
      console.error('Fetch spots error:', e);
    } finally {
      setIsLoadingSpots(false);
    }
  };

  const fetchSecret = async () => {
    try {
      const res = await fetch('/api/location?mode=secret');
      if (res.ok) {
        const d = await res.json();
        if (d.secret) setSecretKey(d.secret);
      }
    } catch (e) {
      console.error('Fetch secret error:', e);
    }
  };

  const handleDeleteSpot = async (spotId: string, spotName: string) => {
    if (!confirm(`登録スポット「${spotName}」を削除してもよろしいですか？`)) return;
    try {
      const res = await fetch(`/api/location/spots?id=${spotId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`「${spotName}」を削除しました`);
        fetchSpots();
        fetchSummary(summaryDate);
      }
    } catch (e) {
      alert('削除に失敗しました');
    }
  };

  const handleOpenSpotModal = (stay: StayItem) => {
    setSpotModalTarget({
      initialName: stay.buildingName || '',
      initialAddress: stay.fullAddress || '',
      initialBuildingName: stay.buildingName || null,
      latitude: stay.latitude,
      longitude: stay.longitude,
    });
    setShowSpotModal(true);
  };

  const handleOpenManualSpotModal = () => {
    // 現在選択中の日付の最新トラックまたは東京基準
    const lat = summaryData.stays[0]?.latitude || 35.6812;
    const lon = summaryData.stays[0]?.longitude || 139.7671;
    setSpotModalTarget({
      initialName: '',
      initialAddress: '',
      initialBuildingName: null,
      latitude: lat,
      longitude: lon,
    });
    setShowSpotModal(true);
  };

  const handleSpotRegistered = (savedSpot: any) => {
    showToast(`「${savedSpot.name}」を登録しました。日報・過去ログに反映されます`);
    fetchSpots();
    fetchSummary(summaryDate);
  };

  const handleCopy = (text: string, type: 'url' | 'secret') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setHasCopiedUrl(true);
      setTimeout(() => setHasCopiedUrl(false), 2000);
    } else {
      setHasCopiedSecret(true);
      setTimeout(() => setHasCopiedSecret(false), 2000);
    }
    showToast('クリップボードにコピーしました');
  };

  if (!isOpen) return null;

  const serverUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/location` : '';

  const getCategoryIcon = (cat?: string | null) => {
    switch (cat) {
      case 'home':
        return <Home className="w-3.5 h-3.5 text-emerald-600" />;
      case 'office':
        return <Briefcase className="w-3.5 h-3.5 text-blue-600" />;
      case 'client':
        return <Users className="w-3.5 h-3.5 text-purple-600" />;
      default:
        return <Building className="w-3.5 h-3.5 text-amber-600" />;
    }
  };

  const getCategoryLabel = (cat?: string | null) => {
    switch (cat) {
      case 'home':
        return '自宅';
      case 'office':
        return '事務所';
      case 'client':
        return '取引先';
      default:
        return '現場';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base leading-tight">GPS活動ログ ＆ 現場日報</h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 text-[10px] font-semibold border border-emerald-400/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  自動把握稼働中
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                {lastRecordedAt
                  ? `最終受信: ${new Date(lastRecordedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                  : '15分以上の滞在を自動判定・現場名を登録可能'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* サブナビゲーション */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2 text-xs font-bold overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('stays')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 shrink-0 ${
              activeSubTab === 'stays'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-4 h-4" />
            現場滞在日報
            {summaryData.stays.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-700 text-[10px]">
                {summaryData.stays.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('expenses')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 shrink-0 ${
              activeSubTab === 'expenses'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Car className="w-4 h-4" />
            移動距離・ガソリン代
          </button>
          <button
            onClick={() => setActiveSubTab('spots')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 shrink-0 ${
              activeSubTab === 'spots'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Building className="w-4 h-4" />
            登録スポット一覧
            {spots.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 text-[10px]">
                {spots.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('settings')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 shrink-0 ${
              activeSubTab === 'settings'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            連携設定・キー
          </button>
        </div>

        {/* 日付セレクター（日報・距離タブ用） */}
        {(activeSubTab === 'stays' || activeSubTab === 'expenses') && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-slate-100 text-xs">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="font-semibold text-slate-700">対象日:</span>
              <input
                type="date"
                value={summaryDate}
                onChange={(e) => {
                  setSummaryDate(e.target.value);
                  fetchSummary(e.target.value);
                }}
                className="font-bold text-slate-800 border border-slate-300 rounded-lg px-2 py-1 bg-slate-50"
              />
            </div>
            <button
              onClick={() => fetchSummary(summaryDate)}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition flex items-center gap-1"
              title="再読込"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
              <span className="text-[11px]">更新</span>
            </button>
          </div>
        )}

        {/* メインコンテンツ */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-slate-800">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
              <p className="text-xs">GPSログを集計中...</p>
            </div>
          ) : (
            <>
              {/* ── 1. 現場滞在日報 ── */}
              {activeSubTab === 'stays' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500 font-medium">
                      15分以上同一地点に留まった滞在区間（建物名または現場住所で表示）
                    </p>
                    <span className="text-xs font-bold text-emerald-700">
                      滞在件数: {summaryData.stays.length} 件
                    </span>
                  </div>

                  {summaryData.stays.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-600">
                        {summaryDate} の滞在記録はまだありません
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        15分以上同じ場所に滞在すると、建物名または現場住所付きで自動リストアップされます。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {summaryData.stays.map((stay, idx) => {
                        const startStr = new Date(stay.startTime).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const endStr = new Date(stay.endTime).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const hours = Math.floor(stay.durationMinutes / 60);
                        const mins = stay.durationMinutes % 60;
                        const durationFormatted =
                          hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;

                        return (
                          <div
                            key={idx}
                            className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 transition shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </span>
                                <h4 className="font-bold text-sm text-slate-900 truncate">
                                  {stay.placeName}
                                </h4>

                                {stay.isRegistered ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                                    {getCategoryIcon(stay.spotCategory)}
                                    登録済: {getCategoryLabel(stay.spotCategory)}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenSpotModal(stay)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200 transition active:scale-95"
                                    title="この場所に現場名や自宅などを登録"
                                  >
                                    <Tag className="w-3 h-3 text-amber-600" />
                                    現場名・スポットを登録
                                  </button>
                                )}
                              </div>

                              {/* 住所または建物名の補足表示 */}
                              {stay.fullAddress && stay.placeName !== stay.fullAddress && (
                                <p className="text-[11px] text-slate-500 pl-8 truncate">
                                  住所: {stay.fullAddress}
                                </p>
                              )}

                              <div className="flex items-center gap-3 text-xs text-slate-500 pl-8">
                                <span className="flex items-center gap-1 font-medium">
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  {startStr} 〜 {endStr}
                                </span>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px]">
                                  滞在 {durationFormatted}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                              {onAddActivityFromStay && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onAddActivityFromStay(stay);
                                    showToast(`「${stay.placeName}」を手帳に反映しました`);
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                  手帳へ反映
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── 2. 移動距離＆ガソリン代・交通費 ── */}
              {activeSubTab === 'expenses' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-blue-50/40 border border-indigo-100">
                      <div className="flex items-center gap-2 text-indigo-700 text-xs font-bold mb-1">
                        <Car className="w-4 h-4" />
                        <span>本日の総走行距離</span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-extrabold text-indigo-950">
                        {summaryData.totalDistanceKm}{' ' }
                        <span className="text-sm font-bold text-indigo-600">km</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        測位ポイント数: {summaryData.totalTracks} 件
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50/40 border border-amber-100">
                      <div className="flex items-center gap-2 text-amber-700 text-xs font-bold mb-1">
                        <Fuel className="w-4 h-4" />
                        <span>推定ガソリン代</span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-extrabold text-amber-950">
                        約 {summaryData.estimatedGasCost.toLocaleString()}{' ' }
                        <span className="text-sm font-bold text-amber-600">円</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        基準: 10km/L・160円/L換算
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      交通費・ガソリン代の精算メモ
                    </h4>
                    <p>
                      現場移動の距離はバックグラウンドで自動積算されています。確定申告や顧客への交通費請求メモとしてそのままご活用いただけます。
                    </p>
                  </div>
                </div>
              )}

              {/* ── 3. 登録スポット一覧（新設） ── */}
              {activeSubTab === 'spots' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">
                        登録済み現場・スポット（{spots.length}件）
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        該当場所（半径内）に15分以上滞在すると、自動でこの登録名が表示されます。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenManualSpotModal}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" /> スポットを追加
                    </button>
                  </div>

                  {isLoadingSpots ? (
                    <div className="py-8 text-center text-slate-400">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-1 text-emerald-600" />
                      <span className="text-xs">スポット一覧を読み込み中...</span>
                    </div>
                  ) : spots.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <Building className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-600">
                        登録されたスポットはまだありません
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        現場滞在日報の「現場名・スポットを登録」ボタンから簡単に登録できます。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {spots.map((sp) => (
                        <div
                          key={sp.id}
                          className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-200 transition shadow-2xs flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                {getCategoryIcon(sp.category)}
                              </span>
                              <h5 className="font-bold text-sm text-slate-900 truncate">
                                {sp.name}
                              </h5>
                              <span className="px-2 py-0.2 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                {getCategoryLabel(sp.category)}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                半径: {sp.radiusMeters}m
                              </span>
                            </div>
                            {sp.address && (
                              <p className="text-xs text-slate-500 pl-9 truncate">
                                {sp.address}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteSpot(sp.id, sp.name)}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            title="スポットを削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── 4. 連携設定・キー管理 ── */}
              {activeSubTab === 'settings' && (
                <div className="space-y-4">
                  {/* Googleカレンダー連携＆安全解除 */}
                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      Googleカレンダー連携管理
                    </h4>
                    <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
                      <div>
                        <p className="text-xs font-bold text-slate-800">
                          {googleConnected ? '連携中（双方向同期可能）' : '未連携'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          予定をGoogleカレンダーと即時同期
                        </p>
                      </div>

                      {googleConnected ? (
                        <div className="flex items-center gap-2">
                          {onSyncGoogleCalendar && (
                            <button
                              onClick={onSyncGoogleCalendar}
                              disabled={isSyncingCalendar}
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
                              <span>{isSyncingCalendar ? '同期中...' : '今すぐ同期'}</span>
                            </button>
                          )}
                          {onDisconnectGoogleCalendar && (
                            <button
                              onClick={onDisconnectGoogleCalendar}
                              className="px-2.5 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition border border-rose-200"
                              title="誤操作防止のためここに格納されています"
                            >
                              連携を解除
                            </button>
                          )}
                        </div>
                      ) : (
                        <a
                          href="/api/auth/google"
                          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs"
                        >
                          Googleと連携する
                        </a>
                      )}
                    </div>
                  </div>

                  {/* GPS Logger for Android 設定情報 */}
                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      常時GPSロガー（スマホアプリ）接続設定
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      スマホのスリープ中も100%途切れない無料アプリ（GPS Logger for Android等）に、以下の2点を設定するだけで常時ロギングが有効化されます。通信は暗号化され、専用シークレットキーにより完全保護されます。
                    </p>

                    {/* 送信先URL */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        ① 送信先URL (URL)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={serverUrl}
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white font-mono text-xs text-slate-800 select-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopy(serverUrl, 'url')}
                          className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition flex items-center gap-1 shrink-0"
                        >
                          {hasCopiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{hasCopiedUrl ? 'コピー済' : 'URLコピー'}</span>
                        </button>
                      </div>
                    </div>

                    {/* シークレットキー */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        ② 認証キー (Header: x-location-secret)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={secretKey || '読み込み中...'}
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white font-mono text-xs text-slate-800 select-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopy(secretKey, 'secret')}
                          disabled={!secretKey}
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1 shrink-0 disabled:opacity-50"
                        >
                          {hasCopiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{hasCopiedSecret ? 'コピー済' : 'キーコピー'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* トースト通知 */}
        {toastMsg && (
          <div className="p-3 bg-emerald-600 text-white text-xs font-bold text-center flex items-center justify-center gap-2 animate-in slide-in-from-bottom duration-200">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* 現場名・スポット登録モーダル */}
        {spotModalTarget && (
          <SpotRegistrationModal
            isOpen={showSpotModal}
            onClose={() => setShowSpotModal(false)}
            initialName={spotModalTarget.initialName}
            initialAddress={spotModalTarget.initialAddress}
            initialBuildingName={spotModalTarget.initialBuildingName}
            latitude={spotModalTarget.latitude}
            longitude={spotModalTarget.longitude}
            onRegistered={handleSpotRegistered}
          />
        )}
      </div>
    </div>
  );
}

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
} from 'lucide-react';

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
  const [activeSubTab, setActiveSubTab] = useState<'stays' | 'expenses' | 'settings'>('stays');
  const [summaryDate, setSummaryDate] = useState<string>(currentDate);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<{
    totalDistanceKm: number;
    estimatedGasCost: number;
    totalTracks: number;
    stays: Array<{
      placeName: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      latitude: number;
      longitude: number;
    }>;
  }>({
    totalDistanceKm: 0,
    estimatedGasCost: 0,
    totalTracks: 0,
    stays: [],
  });

  const [secretKey, setSecretKey] = useState<string>('');
  const [hasCopiedSecret, setHasCopiedSecret] = useState<boolean>(false);
  const [hasCopiedUrl, setHasCopiedUrl] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setSummaryDate(currentDate);
      fetchSummary(currentDate);
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
                  : '位置情報を受信して滞在や距離を自動集計'}
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
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2 text-xs font-bold">
          <button
            onClick={() => setActiveSubTab('stays')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 ${
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
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeSubTab === 'expenses'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Car className="w-4 h-4" />
            移動距離・ガソリン代
          </button>
          <button
            onClick={() => setActiveSubTab('settings')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 ${
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
        {activeSubTab !== 'settings' && (
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
                      15分以上同一地点に留まった滞在区間（自動検出）
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
                        15分以上同じ場所に滞在すると、自動で現場日報としてリストアップされます。
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
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </span>
                                <h4 className="font-bold text-sm text-slate-900">
                                  {stay.placeName}
                                </h4>
                              </div>
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

                            {onAddActivityFromStay && (
                              <button
                                onClick={() => {
                                  onAddActivityFromStay(stay);
                                  showToast(`「${stay.placeName}」を行動ログに反映しました`);
                                }}
                                className="self-end sm:self-center px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                手帳へ反映
                              </button>
                            )}
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
                        {summaryData.totalDistanceKm}{' '}
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
                        ¥{summaryData.estimatedGasCost.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        目安計算（燃費10km/L・160円/L換算）
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2 text-slate-600">
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

              {/* ── 3. 連携設定・キー管理（安全エリアへ集約） ── */}
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
                          className="w-full bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs text-slate-800 font-mono"
                        />
                        <button
                          onClick={() => handleCopy(serverUrl, 'url')}
                          className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1 transition"
                        >
                          {hasCopiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          コピー
                        </button>
                      </div>
                    </div>

                    {/* シークレットキー */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        ② 専用シークレットキー (HTTPヘッダー: x-location-secret または URLパラメータ ?secret=...)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={secretKey || '読み込み中...'}
                          className="w-full bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs text-slate-800 font-mono"
                        />
                        <button
                          onClick={() => handleCopy(secretKey, 'secret')}
                          disabled={!secretKey}
                          className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1 transition disabled:opacity-50"
                        >
                          {hasCopiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          コピー
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* トースト表示 */}
        {toastMsg && (
          <div className="px-5 py-2.5 bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 animate-in slide-in-from-bottom">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* フッター */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

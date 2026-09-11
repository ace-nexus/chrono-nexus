'use client';

import React, { useState, useEffect } from 'react';
import {
  MapPin,
  X,
  Check,
  Building,
  Home,
  Briefcase,
  Users,
  Tag,
  Loader2,
  Sparkles,
  Search,
  AlertTriangle,
} from 'lucide-react';

interface SpotRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  initialAddress?: string;
  initialBuildingName?: string | null;
  latitude: number;
  longitude: number;
  onRegistered?: (spot: any) => void;
}

const CATEGORIES: Array<{
  id: 'site' | 'home' | 'office' | 'client' | 'other';
  label: string;
  icon: any;
}> = [
  { id: 'site', label: '現場', icon: Building },
  { id: 'home', label: '自宅', icon: Home },
  { id: 'office', label: '事務所', icon: Briefcase },
  { id: 'client', label: '取引先', icon: Users },
  { id: 'other', label: 'その他', icon: Tag },
];

export default function SpotRegistrationModal({
  isOpen,
  onClose,
  initialName = '',
  initialAddress = '',
  initialBuildingName = null,
  latitude,
  longitude,
  onRegistered,
}: SpotRegistrationModalProps) {
  const [name, setName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [category, setCategory] = useState<'site' | 'home' | 'office' | 'client' | 'other'>('site');
  const [radiusMeters, setRadiusMeters] = useState<number>(150);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 実際の登録座標（住所検索で更新可能）
  const [targetLat, setTargetLat] = useState<number>(latitude);
  const [targetLng, setTargetLng] = useState<number>(longitude);
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);
  const [geocodeSuccess, setGeocodeSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialName || initialBuildingName || '');
      setAddress(initialAddress || '');
      setCategory('site');
      setRadiusMeters(150);
      setErrorMsg('');
      setTargetLat(latitude);
      setTargetLng(longitude);
      setGeocodeSuccess(false);
    }
  }, [isOpen, initialName, initialAddress, initialBuildingName, latitude, longitude]);

  if (!isOpen) return null;

  const handleQuickName = (val: string, cat?: 'site' | 'home' | 'office' | 'client' | 'other') => {
    setName(val);
    if (cat) setCategory(cat);
  };

  // 住所から正確な座標を取得
  const handleGeocodeAddress = async (addrToSearch?: string) => {
    const query = (addrToSearch || address).trim();
    if (!query) return;

    try {
      setIsGeocoding(true);
      setErrorMsg('');
      const res = await fetch(`/api/location/geocode?address=${encodeURIComponent(query)}`);
      if (!res.ok) {
        throw new Error('住所の位置情報を特定できませんでした');
      }
      const data = await res.json();
      if (data.success && data.latitude && data.longitude) {
        setTargetLat(data.latitude);
        setTargetLng(data.longitude);
        if (data.formattedAddress) {
          // 日本国プレフィックス等を除いたすっきりした住所
          const cleanAddr = data.formattedAddress.replace(/^日本、\s*/, '').replace(/^〒\d{3}-\d{4}\s*/, '');
          setAddress(cleanAddr);
        }
        setGeocodeSuccess(true);
      }
    } catch (err: any) {
      setErrorMsg(err.message || '住所検索に失敗しました');
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMsg('登録名（現場名・スポット名）を入力してください');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMsg('');

      const res = await fetch('/api/location/spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          latitude: targetLat,
          longitude: targetLng,
          radiusMeters,
          category,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || '登録に失敗しました');
      }

      const data = await res.json();
      if (onRegistered) {
        onRegistered(data.spot);
      }
      onClose();
    } catch (err: any) {
      console.error('Save spot error:', err);
      setErrorMsg(err.message || '登録に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <MapPin className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-bold text-base">現場名・スポットの登録</h3>
              <p className="text-[11px] text-emerald-100">
                登録後は今後もこの登録名で自動表示されます
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/20 transition text-white/80 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* フォーム */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* クイック入力チップ */}
          <div>
            <span className="text-xs font-bold text-slate-500 block mb-1.5">
              クイック入力・候補
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleQuickName('自宅', 'home')}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
              >
                🏠 自宅
              </button>
              <button
                type="button"
                onClick={() => handleQuickName('事務所', 'office')}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
              >
                🏢 事務所
              </button>
              <button
                type="button"
                onClick={() => handleQuickName('自社倉庫', 'site')}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
              >
                📦 倉庫
              </button>
              <button
                type="button"
                onClick={() => handleQuickName('現場: ', 'site')}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-medium transition"
              >
                🏗️ 現場:
              </button>
              {initialBuildingName && (
                <button
                  type="button"
                  onClick={() => handleQuickName(initialBuildingName, 'site')}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-medium transition truncate max-w-[200px]"
                  title={initialBuildingName}
                >
                  📍 {initialBuildingName}
                </button>
              )}
            </div>
          </div>

          {/* 登録名（現場名など） */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              登録名（現場名・スポット名） <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 田中様邸新築現場、自宅、ABCセンター など"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-slate-900 bg-white"
              autoFocus
            />
          </div>

          {/* カテゴリ選択 */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              カテゴリ
            </label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-xs font-bold transition ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`} />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 現場住所 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-600">
                現場住所（番地まで確認・検索可能）
              </label>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${targetLat},${targetLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                title="Googleマップで現地の正確な番地を確認"
              >
                🗺️ 地図で確認
              </a>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setGeocodeSuccess(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleGeocodeAddress();
                  }
                }}
                placeholder="例: 神奈川県横浜市旭区西川島町30-1"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-bold text-slate-800 bg-white"
              />
              <button
                type="button"
                onClick={() => handleGeocodeAddress()}
                disabled={isGeocoding || !address.trim()}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition flex items-center gap-1 shrink-0 disabled:opacity-40 cursor-pointer"
                title="入力した住所から正確なピン位置（緯度経度）を取得"
              >
                {isGeocoding ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>住所から検索</span>
              </button>
            </div>

            {/* 座標とステータス表示 */}
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 font-mono">
                登録座標: {targetLat.toFixed(5)}, {targetLng.toFixed(5)}
              </span>
              {geocodeSuccess && (
                <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> 住所の位置を設定済
                </span>
              )}
            </div>

            {/* 自宅近傍警告（夜間に自宅で現場や置場を登録する際の誤登録ガード） */}
            {category !== 'home' &&
              Math.abs(targetLat - 35.4894) < 0.0006 &&
              Math.abs(targetLng - 139.5763) < 0.0006 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">自宅のすぐ近くの座標になっています</span>
                    <span className="text-[11px] text-amber-700">
                      現場の住所を入力して「住所から検索」を押すと、現場の正確な位置にピンが移動します。
                    </span>
                  </div>
                </div>
              )}
          </div>

          {/* 判定半径 */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              判定範囲（半径）
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 100, label: '100m', desc: '戸建・狭小現場' },
                { val: 150, label: '150m (推奨)', desc: '標準的な現場・自宅' },
                { val: 250, label: '250m', desc: '大型施設・大規模現場' },
              ].map((r) => (
                <button
                  key={r.val}
                  type="button"
                  onClick={() => setRadiusMeters(r.val)}
                  className={`p-2 rounded-xl border text-center transition ${
                    radiusMeters === r.val
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 font-bold shadow-2xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 text-xs'
                  }`}
                >
                  <div className="text-xs font-bold">{r.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-100 flex items-start gap-2 text-[11px] text-emerald-800">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              登録すると、過去ログおよび今後の滞在において自動的にこの「登録名」で表示されます。
            </p>
          </div>
        </div>

        {/* フッター */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                登録中...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                この場所を登録
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

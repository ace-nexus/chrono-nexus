'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  Mic,
  MicOff,
  Sparkles,
  RotateCcw,
  Loader2,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useContinuousSpeechRecognition } from '@/lib/useContinuousSpeechRecognition';

interface ActivityRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (targetDate: string) => void;
  defaultDate?: string;
}

type TimeMode = 'nodate' | 'morning' | 'afternoon' | 'evening' | 'custom';

// 日付ヘルパー（ローカル加減算）
function getRelativeDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ActivityRecordModal({
  isOpen,
  onClose,
  onSuccess,
  defaultDate,
}: ActivityRecordModalProps) {
  const todayStr = getRelativeDateStr(0);
  const yesterdayStr = getRelativeDateStr(-1);
  const dayBeforeYesterdayStr = getRelativeDateStr(-2);

  const [targetDate, setTargetDate] = useState<string>(defaultDate || todayStr);
  const [timeMode, setTimeMode] = useState<TimeMode>('nodate');
  const [customTime, setCustomTime] = useState<string>(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });

  const [title, setTitle] = useState<string>('');
  const [backupTitle, setBackupTitle] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isAiFormatting, setIsAiFormatting] = useState<boolean>(false);
  const [registeredSpots, setRegisteredSpots] = useState<any[]>([]);
  const [showSpotSuggestions, setShowSpotSuggestions] = useState<boolean>(false);

  // 音声入力フック
  const voice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setTitle(text),
  });

  // モーダルが開かれた時に初期化
  useEffect(() => {
    if (isOpen) {
      setTargetDate(defaultDate || todayStr);
      setTimeMode('nodate');
      setTitle('');
      setBackupTitle(null);
      setLocationName('');
      voice.reset();

      // 登録スポット候補の取得
      fetch('/api/location/spots')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.spots && Array.isArray(data.spots)) {
            setRegisteredSpots(data.spots);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, defaultDate, todayStr]);

  if (!isOpen) return null;

  // AI補正実行
  const handleFormatWithAi = async () => {
    if (!title.trim() || isAiFormatting) return;
    setIsAiFormatting(true);
    try {
      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: title.trim(),
          mode: 'activity',
          currentDate: targetDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.formattedText) {
          setBackupTitle(title);
          setTitle(data.formattedText);
          voice.reset();
        }
      }
    } catch (err) {
      console.error('AI format error:', err);
    } finally {
      setIsAiFormatting(false);
    }
  };

  // AI補正の取り消し
  const handleRestoreBackup = () => {
    if (backupTitle !== null) {
      setTitle(backupTitle);
      setBackupTitle(null);
    }
  };

  // 保存実行
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    voice.stop();

    try {
      const [sy, sm, sd] = targetDate.split('-').map((v) => parseInt(v, 10));
      let startIso: string | null = null;

      if (timeMode === 'morning') {
        const localDate = new Date(sy, sm - 1, sd, 9, 0, 0, 0);
        startIso = localDate.toISOString();
      } else if (timeMode === 'afternoon') {
        const localDate = new Date(sy, sm - 1, sd, 13, 0, 0, 0);
        startIso = localDate.toISOString();
      } else if (timeMode === 'evening') {
        const localDate = new Date(sy, sm - 1, sd, 17, 0, 0, 0);
        startIso = localDate.toISOString();
      } else if (timeMode === 'custom' && customTime.includes(':')) {
        const [ch, cmin] = customTime.split(':').map((v) => parseInt(v, 10));
        const localDate = new Date(sy, sm - 1, sd, ch, cmin, 0, 0);
        startIso = localDate.toISOString();
      }

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_activity',
          date: targetDate,
          data: {
            title: title.trim(),
            startTime: startIso,
            locationName: locationName.trim() || undefined,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || '実績の保存に失敗しました');
      }

      if (onSuccess) {
        onSuccess(targetDate);
      }
      onClose();
    } catch (err: any) {
      alert(err.message || '保存処理中にエラーが発生しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // スポット候補のフィルタリング
  const matchingSpots = registeredSpots.filter((s) =>
    locationName.trim() ? s.name?.toLowerCase().includes(locationName.toLowerCase().trim()) : true
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg leading-tight">実績を記録する</h3>
              <p className="text-[11px] text-emerald-100">
                予定外に実際に行ったこと・活動内容を手帳に記録
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/20 text-emerald-100 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* フォーム本文 */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* 1. 日付選択エリア */}
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              <span>いつやりましたか？（日付）</span>
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setTargetDate(todayStr)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  targetDate === todayStr
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                今日
              </button>
              <button
                type="button"
                onClick={() => setTargetDate(yesterdayStr)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  targetDate === yesterdayStr
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                昨日
              </button>
              <button
                type="button"
                onClick={() => setTargetDate(dayBeforeYesterdayStr)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  targetDate === dayBeforeYesterdayStr
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                一昨日
              </button>
              <div className="flex items-center gap-1 ml-auto bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200">
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* 2. 時間指定（案A: ハイブリッド方式） */}
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>時間帯（思い出せない時は指定なしでOK）</span>
              </span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setTimeMode('nodate')}
                className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  timeMode === 'nodate'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-200'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                指定なし (終日)
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('morning')}
                className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  timeMode === 'morning'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-200'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                午前 (9:00〜)
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('afternoon')}
                className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  timeMode === 'afternoon'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-200'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                午後 (13:00〜)
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('evening')}
                className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  timeMode === 'evening'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-200'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                夕方・夜 (17:00〜)
              </button>
            </div>

            {/* カスタム時刻のトグル */}
            <div className="mt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setTimeMode(timeMode === 'custom' ? 'nodate' : 'custom')}
                className="text-emerald-700 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <span>{timeMode === 'custom' ? '▲ 時刻指定を閉じる' : '▼ 具体的な時刻を指定する'}</span>
              </button>
              {timeMode === 'custom' && (
                <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl px-2 py-1">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 3. やったこと（タイトル） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>実績・やったことの内容 <span className="text-rose-500">*</span></span>
              </label>
              {backupTitle !== null && (
                <button
                  type="button"
                  onClick={handleRestoreBackup}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                  title="AI補正前の文章に戻す"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>元に戻す</span>
                </button>
              )}
            </div>
            <div className="relative">
              <textarea
                rows={3}
                placeholder="何をしましたか？（例：小山さん宅に電話してトイレ部品交換の了承をもらった）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-3.5 pr-12 text-sm bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-emerald-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 resize-none shadow-2xs leading-relaxed"
              />
              <button
                type="button"
                onClick={() => voice.toggle(title)}
                className={`absolute right-3 top-3 p-2 rounded-xl transition cursor-pointer ${
                  voice.isListening
                    ? 'bg-rose-500 text-white animate-pulse shadow-md'
                    : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                }`}
                title="マイクで話して入力"
              >
                {voice.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>

            {/* AI補正ボタン */}
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={handleFormatWithAi}
                disabled={isAiFormatting || !title.trim()}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer shadow-2xs"
                title="話し言葉を簡潔明瞭な手帳タイトルに自動清書"
              >
                {isAiFormatting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span>✨ AI補正で清書</span>
              </button>
            </div>
          </div>

          {/* 4. 場所・現場名（任意） */}
          <div className="relative">
            <label className="text-xs font-bold text-slate-600 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <span>場所・現場名（任意）</span>
              </span>
              {registeredSpots.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSpotSuggestions((prev) => !prev)}
                  className="text-[11px] text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <span>登録スポットから選ぶ</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </label>
            <input
              type="text"
              placeholder="例：事務所、小山邸、現場A..."
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 shadow-2xs"
            />

            {/* スポット候補ドロップダウン */}
            {showSpotSuggestions && registeredSpots.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-44 overflow-y-auto p-1.5 space-y-1">
                {matchingSpots.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2 text-center">一致するスポットがありません</p>
                ) : (
                  matchingSpots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setLocationName(s.name);
                        setShowSpotSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-emerald-50 hover:text-emerald-800 transition flex items-center justify-between cursor-pointer"
                    >
                      <span className="font-semibold text-slate-800">{s.name}</span>
                      {s.address && <span className="text-[10px] text-slate-400 truncate max-w-[50%]">{s.address}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* フッターアクションボタン */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs sm:text-sm font-bold transition cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs sm:text-sm font-bold transition flex items-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>記録中...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>実績を記録する</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  Edit2,
  X,
  MapPin,
  Mic,
  MicOff,
  Check,
  CalendarDays,
} from 'lucide-react';
import { GOOGLE_CALENDAR_COLORS, getGoogleColor, GoogleColorItem } from './GoogleColors';
import GoogleTimePicker from './GoogleTimePicker';

export interface ScheduleItem {
  id: string;
  title: string;
  start_time: string; // ISO string
  end_time?: string | null;
  location?: string | null;
  raw_payload?: {
    color?: string;
    isAllDay?: boolean;
    [key: string]: any;
  } | null;
}

export interface LocationTrackItem {
  id?: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  place_name?: string | null;
}

interface DailyTimelineViewProps {
  date: string; // "YYYY-MM-DD"
  schedules: ScheduleItem[];
  locationTracks?: LocationTrackItem[];
  onAddSchedule: (data: {
    title: string;
    startTime: string;
    endTime?: string | null;
    color?: string;
    isAllDay?: boolean;
  }) => Promise<void>;
  onUpdateSchedule: (data: {
    id: string;
    title: string;
    startTime: string;
    endTime?: string | null;
    color?: string;
    isAllDay?: boolean;
  }) => Promise<void>;
  onDeleteSchedule: (id: string) => Promise<void>;
  onToggleComplete?: (id: string, isCompleted: boolean) => Promise<void>;
  onClose?: () => void; // ポップアップモーダル時の閉じる用
  isModal?: boolean;
}

export default function DailyTimelineView({
  date,
  schedules,
  locationTracks = [],
  onAddSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onToggleComplete,
  onClose,
  isModal = false,
}: DailyTimelineViewProps) {
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState<boolean>(false);

  // 編集/新規モーダル用状態
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isEditingExisting, setIsEditingExisting] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputTitle, setInputTitle] = useState<string>('');
  const [inputStartDate, setInputStartDate] = useState<string>(date);
  const [inputEndDate, setInputEndDate] = useState<string>(date);
  const [inputStartTime, setInputStartTime] = useState<string>('09:00');
  const [inputEndTime, setInputEndTime] = useState<string>('');
  const [inputColor, setInputColor] = useState<string>('peacock');
  const [inputIsAllDay, setInputIsAllDay] = useState<boolean>(false);

  // タイムピッカー状態
  const [activePickerTarget, setActivePickerTarget] = useState<'start' | 'end' | null>(null);

  // 音声入力用状態
  const [isVoiceListening, setIsVoiceListening] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // スクロール用コンテナ
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 初回表示時に朝7時付近に自動スクロール
  useEffect(() => {
    if (scrollContainerRef.current) {
      const targetY = 7 * 56; // 7:00
      scrollContainerRef.current.scrollTop = targetY;
    }
  }, [date]);

  // 音声入力のトグル
  const toggleVoice = () => {
    if (isVoiceListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsVoiceListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('お使いのブラウザは音声認識に対応していません。');
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.continuous = false;

    recog.onstart = () => setIsVoiceListening(true);
    recog.onend = () => setIsVoiceListening(false);
    recog.onerror = () => setIsVoiceListening(false);
    recog.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInputTitle((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };

    recognitionRef.current = recog;
    recog.start();
  };

  // 新規予定モーダルを開く（時間枠タップ時など）
  const openNewModal = (defaultHour?: number) => {
    const h = defaultHour !== undefined ? defaultHour : 9;
    const hStr = h.toString().padStart(2, '0');
    const nextHStr = ((h + 1) % 24).toString().padStart(2, '0');

    setIsEditingExisting(false);
    setEditingId(null);
    setInputTitle('');
    setInputStartDate(date);
    setInputEndDate(date);
    setInputStartTime(`${hStr}:00`);
    setInputEndTime(`${nextHStr}:00`);
    setInputColor('peacock');
    setInputIsAllDay(false);
    setIsEditModalOpen(true);
    setShowActionSheet(false);
  };

  // 既存予定の編集モーダルを開く
  const openEditModal = (sch: ScheduleItem) => {
    setIsEditingExisting(true);
    setEditingId(sch.id);
    setInputTitle(sch.title);

    const sDate = new Date(sch.start_time);
    const sY = sDate.getFullYear();
    const sM = (sDate.getMonth() + 1).toString().padStart(2, '0');
    const sD = sDate.getDate().toString().padStart(2, '0');
    setInputStartDate(`${sY}-${sM}-${sD}`);

    const sH = sDate.getHours().toString().padStart(2, '0');
    const sMin = sDate.getMinutes().toString().padStart(2, '0');
    setInputStartTime(`${sH}:${sMin}`);

    if (sch.end_time) {
      const eDate = new Date(sch.end_time);
      const eY = eDate.getFullYear();
      const eM = (eDate.getMonth() + 1).toString().padStart(2, '0');
      const eD = eDate.getDate().toString().padStart(2, '0');
      setInputEndDate(`${eY}-${eM}-${eD}`);

      const eH = eDate.getHours().toString().padStart(2, '0');
      const eMin = eDate.getMinutes().toString().padStart(2, '0');
      setInputEndTime(`${eH}:${eMin}`);
    } else {
      setInputEndDate(`${sY}-${sM}-${sD}`);
      setInputEndTime('');
    }

    setInputColor(sch.raw_payload?.color || 'peacock');
    setInputIsAllDay(!!sch.raw_payload?.isAllDay);
    setIsEditModalOpen(true);
    setShowActionSheet(false);
  };

  // 予定保存ハンドラー
  const handleSaveSchedule = async () => {
    if (!inputTitle.trim()) {
      alert('予定のタイトルを入力してください');
      return;
    }

    // 開始日時の生成（日本時間基準）
    const [sy, sm, sd] = inputStartDate.split('-').map((v) => parseInt(v, 10));
    const [sh, smin] = inputStartTime.split(':').map((v) => parseInt(v, 10));
    const startLocalDate = inputIsAllDay
      ? new Date(sy, sm - 1, sd, 0, 0, 0, 0)
      : new Date(sy, sm - 1, sd, sh, smin, 0, 0);
    const startIso = startLocalDate.toISOString();

    // 終了日時の生成（日本時間基準）
    const [ey, em, ed] = inputEndDate.split('-').map((v) => parseInt(v, 10));
    let endIso: string | null = null;
    if (inputIsAllDay) {
      const endLocalDate = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      endIso = endLocalDate.toISOString();
    } else if (inputEndTime && inputEndTime.trim()) {
      const [eh, emin] = inputEndTime.split(':').map((v) => parseInt(v, 10));
      const endLocalDate = new Date(ey, em - 1, ed, eh, emin, 0, 0);
      endIso = endLocalDate.toISOString();
    } else {
      // 終了時刻空欄時：同日なら+1時間、複数日ならその日の終わり
      if (inputStartDate !== inputEndDate) {
        const endLocalDate = new Date(ey, em - 1, ed, 23, 59, 59, 999);
        endIso = endLocalDate.toISOString();
      } else {
        const endLocalDate = new Date(sy, sm - 1, sd, sh + 1, smin, 0, 0);
        endIso = endLocalDate.toISOString();
      }
    }

    try {
      if (isEditingExisting && editingId) {
        await onUpdateSchedule({
          id: editingId,
          title: inputTitle.trim(),
          startTime: startIso,
          endTime: endIso,
          color: inputColor,
          isAllDay: inputIsAllDay,
        });
      } else {
        await onAddSchedule({
          title: inputTitle.trim(),
          startTime: startIso,
          endTime: endIso,
          color: inputColor,
          isAllDay: inputIsAllDay,
        });
      }
      setIsEditModalOpen(false);
    } catch (err) {
      console.error('Save schedule error:', err);
      alert('予定の保存に失敗しました');
    }
  };

  // 予定削除ハンドラー
  const handleDelete = async (id: string) => {
    if (!confirm('この予定を削除してもよろしいですか？')) return;
    try {
      await onDeleteSchedule(id);
      setIsEditModalOpen(false);
      setShowActionSheet(false);
    } catch (err) {
      console.error('Delete schedule error:', err);
      alert('削除に失敗しました');
    }
  };

  // 終日予定と時間指定予定の分離
  const allDaySchedules = schedules.filter((s) => s.raw_payload?.isAllDay);
  const timedSchedules = schedules.filter((s) => !s.raw_payload?.isAllDay);

  // 時間ごとの位置情報マップ（hour -> placeName）
  const safeTracks = Array.isArray(locationTracks) ? locationTracks : [];
  const locationByHour: { [hour: number]: string } = {};
  safeTracks.forEach((track) => {
    if (track && track.place_name) {
      const h = new Date(track.recorded_at).getHours();
      if (!locationByHour[h]) {
        locationByHour[h] = track.place_name;
      }
    }
  });

  // 日付の表示情報
  const [y, m, d] = date.split('-');
  const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeekStr = weekDays[dateObj.getDay()];
  const isToday = date === new Date().toISOString().split('T')[0];

  return (
    <div className={`bg-white flex flex-col ${isModal ? 'h-[85vh] max-h-[780px] rounded-3xl' : 'rounded-2xl border border-slate-200'} shadow-sm relative overflow-hidden`}>
      {/* ── ヘッダー ── */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-slate-900">
                {parseInt(m, 10)}月{parseInt(d, 10)}日 ({dayOfWeekStr})
              </h3>
              {isToday && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white">
                  今日
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {schedules.length > 0 ? `${schedules.length}件の予定` : '予定なし'}
              {locationTracks.length > 0 ? ` ・ 足跡${locationTracks.length}件` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openNewModal()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" /> 予定を追加
          </button>
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-200 text-slate-500 transition cursor-pointer"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* ── 終日エリア（All-Day） ── */}
      {allDaySchedules.length > 0 && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0 flex items-start gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase shrink-0 pt-1 w-12 text-right">
            終日
          </span>
          <div className="flex-1 flex flex-wrap gap-1.5">
            {allDaySchedules.map((sch) => {
              const colorInfo = getGoogleColor(sch.raw_payload?.color);
              const isCompleted = !!sch.raw_payload?.isCompleted;
              return (
                <div
                  key={sch.id}
                  onClick={() => {
                    setSelectedSchedule(sch);
                    setShowActionSheet(true);
                  }}
                  style={{ backgroundColor: colorInfo.hex, color: colorInfo.textHex }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold truncate max-w-[260px] shadow-2xs hover:opacity-90 transition text-left cursor-pointer flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleComplete) onToggleComplete(sch.id, !isCompleted);
                    }}
                    className={`w-4 h-4 rounded shrink-0 flex items-center justify-center transition cursor-pointer ${
                      isCompleted
                        ? 'bg-emerald-400 text-slate-950 font-black ring-1 ring-emerald-300'
                        : 'bg-white/30 border border-white/80'
                    }`}
                    title={isCompleted ? '完了済み（クリックで未完了に戻す）' : '未完了（クリックで完了にする）'}
                  >
                    {isCompleted && <Check className="w-3 h-3 stroke-[3]" />}
                  </button>
                  <span className="truncate">{sch.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 縦スクロール時間軸タイムライン（0:00〜23:00） ── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative select-none">
        <div className="relative min-h-[1344px] pb-12">
          {/* 24時間のグリッド行 (1時間 = 56px) */}
          {Array.from({ length: 24 }).map((_, hour) => {
            const locName = locationByHour[hour];
            return (
              <div
                key={hour}
                onClick={() => openNewModal(hour)}
                className="h-14 border-b border-slate-100 flex items-start group hover:bg-indigo-50/20 transition cursor-pointer relative"
              >
                {/* 左側：時間ラベル */}
                <div className="w-14 shrink-0 text-right pr-2 text-xs font-mono font-semibold text-slate-400 -mt-2.5">
                  {hour.toString().padStart(2, '0')}:00
                </div>

                {/* タイムライングリッドの線 */}
                <div className="flex-1 h-full relative border-l border-slate-200">
                  {/* 位置情報（市区町村名）の控えめ表示 */}
                  {locName && (
                    <div className="absolute right-3 top-1 flex items-center gap-1 text-[11px] text-slate-400/90 font-medium z-10 pointer-events-none">
                      <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>{locName}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 予定ブロックの配置 */}
          {timedSchedules.map((sch) => {
            const sDate = new Date(sch.start_time);
            const sHour = sDate.getHours() + sDate.getMinutes() / 60;

            let durationHours = 1.0;
            if (sch.end_time) {
              const eDate = new Date(sch.end_time);
              const diffHours = (eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60);
              durationHours = Math.max(0.5, diffHours);
            }

            const top = sHour * 56;
            const height = Math.max(28, durationHours * 56 - 3);
            const colorInfo = getGoogleColor(sch.raw_payload?.color);

            const isCompleted = !!sch.raw_payload?.isCompleted;

            return (
              <div
                key={sch.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSchedule(sch);
                  setShowActionSheet(true);
                }}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  backgroundColor: colorInfo.hex,
                  color: colorInfo.textHex,
                }}
                className="absolute left-16 right-4 rounded-xl p-2 shadow-sm border border-black/10 overflow-hidden cursor-pointer hover:brightness-95 transition z-20 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleComplete) onToggleComplete(sch.id, !isCompleted);
                      }}
                      className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center transition cursor-pointer shadow-xs ${
                        isCompleted
                          ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-300 font-black scale-105'
                          : 'bg-white/30 border border-white/80 hover:bg-white/50 text-transparent'
                      }`}
                      title={isCompleted ? '完了済み（クリックで未完了に戻す）' : '未完了（クリックで完了にする）'}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </button>
                    <span className="text-xs sm:text-sm font-bold truncate">{sch.title}</span>
                  </div>
                  <span className="text-[10px] font-mono opacity-90 shrink-0 font-semibold ml-1">
                    {sDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                    {sch.end_time && ` - ${new Date(sch.end_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 既存予定タップ時のアクションシート ── */}
      {showActionSheet && selectedSchedule && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in"
          onClick={() => setShowActionSheet(false)}
        >
          <div
            className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl border border-slate-100 space-y-3 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ backgroundColor: getGoogleColor(selectedSchedule.raw_payload?.color).hex }}
                />
                <h4 className="font-bold text-slate-900 truncate">{selectedSchedule.title}</h4>
              </div>
              <button
                onClick={() => setShowActionSheet(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => openEditModal(selectedSchedule)}
                className="w-full py-3 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                <Edit2 className="w-4 h-4" /> 予定を変更する
              </button>

              <button
                onClick={() => {
                  const h = new Date(selectedSchedule.start_time).getHours();
                  openNewModal(h);
                }}
                className="w-full py-3 px-4 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                <Plus className="w-4 h-4" /> この時間に別の予定を追加
              </button>

              <button
                onClick={() => handleDelete(selectedSchedule.id)}
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                <Trash2 className="w-4 h-4" /> この予定を削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 予定の作成・変更モーダル（Googleスタイル） ── */}
      {isEditModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-5 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-900 text-lg">
                {isEditingExisting ? '予定を変更' : '新しい予定を追加'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* タイトル入力（音声マイク内蔵） */}
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="予定のタイトルを入力..."
                value={inputTitle}
                onChange={(e) => setInputTitle(e.target.value)}
                className="w-full pl-4 pr-12 py-3.5 text-base bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-600 focus:bg-white text-slate-900 font-semibold"
              />
              <button
                type="button"
                onClick={toggleVoice}
                className={`absolute right-2.5 p-2 rounded-xl transition ${
                  isVoiceListening
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                }`}
                title="音声でタイトルを入力"
              >
                {isVoiceListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>

            {/* 日付・期間選択（複数日にまたがる予定対応） */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">開始日</label>
                <input
                  type="date"
                  value={inputStartDate}
                  onChange={(e) => {
                    setInputStartDate(e.target.value);
                    if (e.target.value > inputEndDate) {
                      setInputEndDate(e.target.value);
                    }
                  }}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-2xs"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">終了日</label>
                <input
                  type="date"
                  value={inputEndDate}
                  min={inputStartDate}
                  onChange={(e) => setInputEndDate(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-2xs"
                />
              </div>
            </div>

            {/* 終日チェックボックス */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-bold text-slate-700">終日の予定</span>
              <input
                type="checkbox"
                checked={inputIsAllDay}
                onChange={(e) => setInputIsAllDay(e.target.checked)}
                className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
              />
            </div>

            {/* 時間選択ボタン（Googleタイムピッカー起動） */}
            {!inputIsAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">開始時刻</label>
                  <button
                    type="button"
                    onClick={() => setActivePickerTarget('start')}
                    className="w-full p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left font-mono font-bold text-slate-800 flex items-center justify-between"
                  >
                    <span>{inputStartTime}</span>
                    <Clock className="w-4 h-4 text-indigo-600" />
                  </button>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">終了時刻 (任意)</label>
                  <button
                    type="button"
                    onClick={() => setActivePickerTarget('end')}
                    className="w-full p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left font-mono font-bold text-slate-800 flex items-center justify-between"
                  >
                    <span className={inputEndTime ? 'text-slate-800' : 'text-slate-400'}>
                      {inputEndTime || '+1時間'}
                    </span>
                    <Clock className="w-4 h-4 text-indigo-600" />
                  </button>
                </div>
              </div>
            )}

            {/* Googleカレンダー公式11色カラーピッカー */}
            <div>
              <label className="text-xs font-bold text-slate-500 mb-2 block">予定のカラー</label>
              <div className="flex items-center gap-2 overflow-x-auto py-1 px-0.5">
                {GOOGLE_CALENDAR_COLORS.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => setInputColor(col.id)}
                    style={{ backgroundColor: col.hex }}
                    className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center transition ${
                      inputColor === col.id ? 'ring-2 ring-offset-2 ring-indigo-600 scale-110' : 'hover:opacity-80'
                    }`}
                    title={col.name}
                  >
                    {inputColor === col.id && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* アクションボタン */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveSchedule}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition shadow-xs"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Googleタイムピッカー（開始または終了） ── */}
      {activePickerTarget && (
        <GoogleTimePicker
          initialTime={activePickerTarget === 'start' ? inputStartTime : inputEndTime || inputStartTime}
          onConfirm={(selected) => {
            if (activePickerTarget === 'start') {
              setInputStartTime(selected);
            } else {
              setInputEndTime(selected);
            }
          }}
          onClose={() => setActivePickerTarget(null)}
        />
      )}
    </div>
  );
}

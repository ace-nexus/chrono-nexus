'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  CheckSquare,
  Square,
  CalendarDays,
  FileText,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { GOOGLE_CALENDAR_COLORS, getGoogleColor, GoogleColorItem } from './GoogleColors';
import GoogleTimePicker from './GoogleTimePicker';
import ScheduleMemoModal from './ScheduleMemoModal';

export interface ScheduleItem {
  id: string;
  title: string;
  start_time: string; // ISO string
  end_time?: string | null;
  location?: string | null;
  description?: string | null;
  source?: string | null;
  raw_payload?: {
    color?: string;
    isAllDay?: boolean;
    memo?: string | null;
    [key: string]: any;
  } | null;
}

export interface LocationTrackItem {
  id?: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  place_name?: string | null;
  is_registered_spot?: boolean;
  registered_spot_name?: string | null;
  registered_address?: string | null;
}

export interface HourlyRepresentativeLocation {
  hour: number;
  label: string;
  fullName: string;
  isRegistered: boolean;
  latitude: number;
  longitude: number;
  durationMinutes: number;
  trackCount: number;
  recordedAt: string;
}

interface DailyTimelineViewProps {
  date: string; // "YYYY-MM-DD"
  schedules: ScheduleItem[];
  locationTracks?: LocationTrackItem[];
  latestLocationRecordedAt?: string | null;
  onSelectLocationHour?: (hour: number, location: HourlyRepresentativeLocation) => void;
  onAddSchedule: (
    data: {
      title: string;
      startTime: string;
      endTime?: string | null;
      color?: string;
      isAllDay?: boolean;
    },
    targetDate?: string
  ) => Promise<void>;
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
  onUpdateScheduleMemo?: (scheduleId: string, memo: string) => Promise<void>;
  onDeleteScheduleMemo?: (scheduleId: string) => Promise<void>;
  onClose?: () => void; // ポップアップモーダル時の閉じる用
  isModal?: boolean;
}

export default function DailyTimelineView({
  date,
  schedules,
  locationTracks = [],
  latestLocationRecordedAt = null,
  onSelectLocationHour,
  onAddSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onToggleComplete,
  onUpdateScheduleMemo,
  onDeleteScheduleMemo,
  onClose,
  isModal = false,
}: DailyTimelineViewProps) {
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState<boolean>(false);
  const [memoTargetSchedule, setMemoTargetSchedule] = useState<ScheduleItem | null>(null);

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

  // 現在時刻状態（Googleカレンダー風 現在時刻インジケーター用）
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 15000); // 15秒ごとに更新
    return () => clearInterval(timer);
  }, []);

  // 表示中日付が日本時間ローカルの「今日」か判定
  const isToday = (() => {
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}` === date;
  })();

  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const currentTimeTop = (currentMinutes / 60) * 56; // 1時間 = 56px (h-14)

  // 初回表示時に自動スクロール（今日なら現在時刻の少し前、別日なら朝7時付近）
  useEffect(() => {
    if (scrollContainerRef.current) {
      if (isToday) {
        // 現在時刻の約1.5時間前が見える位置にスクロール
        const targetY = Math.max(0, currentTimeTop - 90);
        scrollContainerRef.current.scrollTop = targetY;
      } else {
        const targetY = 7 * 56; // 7:00
        scrollContainerRef.current.scrollTop = targetY;
      }
    }
  }, [date, isToday]);

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

  // 期日なしタスク除外 ＆ 同名・同時刻の重複排除（Googleカレンダー側優先）
  const visibleSchedules = useMemo(() => {
    const filtered = schedules.filter((s) => {
      const payload = s.raw_payload || {};
      const isTask = s.source === 'chrono_task' || payload.is_task;
      if (isTask && (payload.is_nodate || !payload.due_date)) {
        return false;
      }
      return true;
    });

    const deduped: ScheduleItem[] = [];
    const seenMap = new Map<string, ScheduleItem>();

    for (const item of filtered) {
      const normTitle = (item.title || '').trim().replace(/\s+/g, '');
      const sKey = `${normTitle}:::${item.start_time}`;
      const existing = seenMap.get(sKey);
      if (!existing) {
        seenMap.set(sKey, item);
        deduped.push(item);
      } else {
        const isCurrentGoogle = item.source === 'google_calendar' || !!(item as any).external_id;
        const isExistingGoogle = existing.source === 'google_calendar' || !!(existing as any).external_id;
        if (isCurrentGoogle && !isExistingGoogle) {
          const idx = deduped.indexOf(existing);
          if (idx !== -1) deduped[idx] = item;
          seenMap.set(sKey, item);
        }
      }
    }

    return deduped;
  }, [schedules]);

  // 終日予定と時間指定予定の分離（isAllDay / is_all_day の両方をサポート）
  const allDaySchedules = visibleSchedules.filter((s) => s.raw_payload?.isAllDay || s.raw_payload?.is_all_day);
  const timedSchedules = visibleSchedules.filter((s) => !s.raw_payload?.isAllDay && !s.raw_payload?.is_all_day);

  // 時間指定予定の重なり防止（Googleカレンダー風 カラム分割計算）
  const timedSchedulesWithLayout = useMemo(() => {
    if (!timedSchedules || timedSchedules.length === 0) return [];

    const items = timedSchedules.map((e) => {
      const sDate = new Date(e.start_time);
      const sMinutes = sDate.getHours() * 60 + sDate.getMinutes();
      let durationMinutes = 60;
      if (e.end_time) {
        const eDate = new Date(e.end_time);
        const diff = (eDate.getTime() - sDate.getTime()) / (1000 * 60);
        durationMinutes = Math.max(30, diff);
      }
      const eMinutes = sMinutes + durationMinutes;
      return {
        ...e,
        startMinutes: sMinutes,
        endMinutes: eMinutes,
        durationMinutes,
        top: (sMinutes / 60) * 56,
        height: Math.max(28, (durationMinutes / 60) * 56 - 3),
        colIndex: 0,
        totalCols: 1,
      };
    });

    items.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      return b.durationMinutes - a.durationMinutes;
    });

    const clusters: (typeof items)[] = [];
    let currentCluster: typeof items = [];
    let clusterEnd = -1;

    for (const item of items) {
      if (currentCluster.length === 0) {
        currentCluster.push(item);
        clusterEnd = item.endMinutes;
      } else {
        if (item.startMinutes < clusterEnd) {
          currentCluster.push(item);
          clusterEnd = Math.max(clusterEnd, item.endMinutes);
        } else {
          clusters.push(currentCluster);
          currentCluster = [item];
          clusterEnd = item.endMinutes;
        }
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    const result: typeof items = [];
    for (const cluster of clusters) {
      const columnEnds: number[] = [];
      for (const item of cluster) {
        let placedCol = -1;
        for (let i = 0; i < columnEnds.length; i++) {
          if (columnEnds[i] <= item.startMinutes) {
            placedCol = i;
            break;
          }
        }
        if (placedCol === -1) {
          placedCol = columnEnds.length;
          columnEnds.push(item.endMinutes);
        } else {
          columnEnds[placedCol] = item.endMinutes;
        }
        item.colIndex = placedCol;
      }

      const totalCols = columnEnds.length;
      for (const item of cluster) {
        item.totalCols = totalCols;
        result.push(item);
      }
    }

    return result;
  }, [timedSchedules]);

  // 1時間ごとの代表地点マップ（hour -> HourlyRepresentativeLocation）
  // 要求仕様：その時間帯で一番長くいた代表地点（登録スポット優先、または市区町村・町名）
  const safeTracks = Array.isArray(locationTracks) ? locationTracks : [];

  const hourlyLocations = useMemo(() => {
    const byHour: { [hour: number]: HourlyRepresentativeLocation } = {};
    if (safeTracks.length === 0) return byHour;

    // 1. 各時間（0〜23）ごとにトラックを分類
    const tracksByHour: { [hour: number]: LocationTrackItem[] } = {};
    safeTracks.forEach((track) => {
      if (!track || !track.recorded_at) return;
      const h = new Date(track.recorded_at).getHours();
      if (!tracksByHour[h]) tracksByHour[h] = [];
      tracksByHour[h].push(track);
    });

    // 2. 各時間ごとに滞在時間・最長滞在地点を集計
    Object.keys(tracksByHour).forEach((hStr) => {
      const h = parseInt(hStr, 10);
      const tracks = tracksByHour[h];
      if (tracks.length === 0) return;

      const spotStats: {
        [key: string]: {
          label: string;
          fullName: string;
          isRegistered: boolean;
          latitude: number;
          longitude: number;
          durationMinutes: number;
          trackCount: number;
          recordedAt: string;
        };
      } = {};

      tracks.forEach((t, idx) => {
        const rawName = t.place_name || '';
        const isReg = Boolean(t.is_registered_spot);
        let shortLabel = rawName;
        if (!isReg) {
          const kuMatch = rawName.match(/([^都道府県市区町村\s]+区)/);
          const cityMatch = rawName.match(/([^都道府県\s]+?[市町村])/);
          shortLabel = kuMatch ? kuMatch[1] : (cityMatch ? cityMatch[1] : rawName || '移動中');
        }

        const key = isReg ? `reg_${rawName}` : shortLabel;

        if (!spotStats[key]) {
          spotStats[key] = {
            label: shortLabel,
            fullName: rawName || shortLabel,
            isRegistered: isReg,
            latitude: t.latitude,
            longitude: t.longitude,
            durationMinutes: 0,
            trackCount: 0,
            recordedAt: t.recorded_at,
          };
        }

        spotStats[key].trackCount += 1;

        if (idx < tracks.length - 1) {
          const nextT = tracks[idx + 1];
          const diffMin = Math.round(
            (new Date(nextT.recorded_at).getTime() - new Date(t.recorded_at).getTime()) / 60000
          );
          if (diffMin > 0 && diffMin <= 20) {
            spotStats[key].durationMinutes += diffMin;
          }
        }
      });

      let bestKey: string | null = null;
      let maxScore = -1;

      Object.entries(spotStats).forEach(([key, stats]) => {
        // スコア算出：滞在時間 + 登録スポットボーナス(25点) + ログ件数*2
        const score = stats.durationMinutes + (stats.isRegistered ? 25 : 0) + stats.trackCount * 2;
        if (score > maxScore) {
          maxScore = score;
          bestKey = key;
        }
      });

      if (bestKey && spotStats[bestKey]) {
        const best = spotStats[bestKey];
        byHour[h] = {
          hour: h,
          label: best.label,
          fullName: best.fullName,
          isRegistered: best.isRegistered,
          latitude: best.latitude,
          longitude: best.longitude,
          durationMinutes: Math.max(best.durationMinutes, best.trackCount >= 2 ? 10 : 0),
          trackCount: best.trackCount,
          recordedAt: best.recordedAt,
        };
      }
    });

    // 3. 空き時間の自動補間（滞在中の時間帯や就寝中など、前後の地点から途切れなく補間）
    for (let h = 0; h < 24; h++) {
      if (!byHour[h]) {
        let prevHour: number | null = null;
        for (let p = h - 1; p >= 0; p--) {
          if (byHour[p]) {
            prevHour = p;
            break;
          }
        }
        let nextHour: number | null = null;
        for (let n = h + 1; n < 24; n++) {
          if (byHour[n]) {
            nextHour = n;
            break;
          }
        }

        // 前後が同じ場所なら中間の時間帯もその場所に滞在していたと補間
        if (
          prevHour !== null &&
          nextHour !== null &&
          byHour[prevHour].label === byHour[nextHour].label
        ) {
          const base = byHour[prevHour];
          byHour[h] = {
            ...base,
            hour: h,
            durationMinutes: 60,
            trackCount: 0,
          };
        } else if (prevHour === null && nextHour !== null && byHour[nextHour].isRegistered) {
          // 0時など最初の記録前で、最初の記録が自宅などの登録スポットの場合
          const base = byHour[nextHour];
          byHour[h] = {
            ...base,
            hour: h,
            durationMinutes: 60,
            trackCount: 0,
          };
        }
      }
    }

    return byHour;
  }, [safeTracks]);

  // 通信途絶え判定（今日表示時、日中8:00〜22:00に直近60分以上更新がない場合）
  const { isLocationDisconnected, disconnectedMinutes } = useMemo(() => {
    if (!isToday) return { isLocationDisconnected: false, disconnectedMinutes: 0 };
    const currentHour = now.getHours();
    if (currentHour < 8 || currentHour >= 22) {
      return { isLocationDisconnected: false, disconnectedMinutes: 0 };
    }

    const latestIso =
      latestLocationRecordedAt ||
      (safeTracks.length > 0 ? safeTracks[safeTracks.length - 1].recorded_at : null);

    if (!latestIso) return { isLocationDisconnected: false, disconnectedMinutes: 0 };

    const lastTime = new Date(latestIso).getTime();
    const diffMs = now.getTime() - lastTime;
    const diffMins = Math.floor(diffMs / (60 * 1000));

    return {
      isLocationDisconnected: diffMins >= 60,
      disconnectedMinutes: diffMins,
    };
  }, [isToday, now, latestLocationRecordedAt, safeTracks]);

  // 日付の表示情報
  const [y, m, d] = date.split('-');
  const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeekStr = weekDays[dateObj.getDay()];

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

      {/* ── OwnTracks通信途絶え警告バー（日中活動時間帯に60分以上停止している場合） ── */}
      {isLocationDisconnected && (
        <div className="mx-4 mt-2.5 mb-1 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between text-xs text-amber-800 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>OwnTracksの記録が{disconnectedMinutes}分途絶えています。</strong>
              <span className="text-amber-700 text-[11px] hidden sm:inline ml-1">
                スマホのOwnTracksアプリがバックグラウンド停止しているか、通信がオフになっている可能性があります。
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ── 終日エリア（All-Day） ── */}
      {allDaySchedules.length > 0 && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0 flex items-start gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase shrink-0 pt-1 w-12 text-right">
            終日
          </span>
          <div className="flex-1 flex flex-wrap gap-1.5">
            {allDaySchedules.map((sch) => {
              const colorInfo = getGoogleColor(sch.raw_payload?.color);
              const memoText = sch.raw_payload?.memo ?? sch.description ?? '';
              const hasMemo = Boolean(memoText && memoText.trim().length > 0);
              const isTask = Boolean(sch.raw_payload?.is_task || (sch as any).source === 'chrono_task');
              const isCompleted = Boolean(sch.raw_payload?.isCompleted || sch.raw_payload?.is_completed);

              return (
                <div
                  key={sch.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSchedule(sch);
                    setShowActionSheet(true);
                  }}
                  style={
                    isCompleted
                      ? { backgroundColor: '#f1f5f9', color: '#64748b' }
                      : { backgroundColor: colorInfo.hex, color: colorInfo.textHex }
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 cursor-pointer shadow-2xs hover:opacity-90 transition ${
                    isCompleted ? 'border-slate-300 shadow-none' : 'border-transparent'
                  }`}
                  title={`${sch.title}${isCompleted ? ' (完了済み)' : ''}`}
                >
                  {isTask && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleComplete?.(sch.id, !isCompleted);
                      }}
                      className="p-0.5 rounded hover:bg-black/10 transition cursor-pointer"
                    >
                      {isCompleted ? (
                        <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Square className="w-3.5 h-3.5 opacity-60" />
                      )}
                    </button>
                  )}
                  <span className={`truncate max-w-[200px] ${isCompleted ? 'line-through opacity-60' : ''}`}>
                    {sch.title}
                  </span>
                  {hasMemo && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMemoTargetSchedule(sch);
                      }}
                      className="p-0.5 rounded hover:bg-black/10 transition cursor-pointer ml-0.5"
                      title="メモを確認・編集"
                    >
                      <FileText className="w-3 h-3 text-amber-500" />
                    </button>
                  )}
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
            const locInfo = hourlyLocations[hour];
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
                  {/* 位置情報（1時間ごとの代表地点バッジ：タップでタイムライン連動） */}
                  {locInfo && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectLocationHour?.(hour, locInfo);
                      }}
                      className={`absolute right-2 top-1.5 flex items-center gap-1 text-[11px] font-medium z-20 px-2 py-0.5 rounded-lg border transition shadow-2xs cursor-pointer hover:scale-105 active:scale-95 ${
                        locInfo.isRegistered
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
                      }`}
                      title={`タップでGoogleマップ足跡タイムラインを開く（${hour}:00〜${hour + 1}:00：${locInfo.fullName}）`}
                    >
                      <MapPin
                        className={`w-3 h-3 shrink-0 ${
                          locInfo.isRegistered ? 'text-emerald-600' : 'text-slate-400 group-hover:text-indigo-600'
                        }`}
                      />
                      <span className="font-bold truncate max-w-[120px] sm:max-w-[170px]">
                        {locInfo.label}
                      </span>
                      {locInfo.durationMinutes > 0 && (
                        <span className="text-[9px] text-slate-400 font-normal">
                          {locInfo.durationMinutes}分
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Googleカレンダー風 現在時刻ライン（赤い水平線＋丸ポインタ＋現在時刻バッジ） ── */}
          {isToday && (
            <div
              className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
              style={{ top: `${currentTimeTop}px` }}
            >
              {/* 左側：現在時刻バッジと赤い丸 */}
              <div className="w-14 shrink-0 flex items-center justify-end pr-1.5 relative">
                <span className="text-[10px] font-mono font-bold text-rose-600 bg-white/95 px-1 py-0.5 rounded border border-rose-200 shadow-2xs leading-tight">
                  {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {/* タイムライン縦境界線（left-14 / border-l）上の赤い円ポインタ */}
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500 absolute -right-[5px] top-1/2 -translate-y-1/2 ring-2 ring-white z-40 shrink-0 shadow-xs" />
              </div>

              {/* タイムラインを横断する赤い横線 */}
              <div className="flex-1 h-[2px] bg-rose-500 shadow-2xs" />
            </div>
          )}

          {/* 予定ブロックの配置（Googleカレンダー風：時間軸と完全に分離したカラム分割配置） */}
          <div className="absolute left-[62px] right-2 top-0 bottom-0 pointer-events-none">
            {timedSchedulesWithLayout.map((sch) => {
              const colorInfo = getGoogleColor(sch.raw_payload?.color);
              const widthPercent = 100 / sch.totalCols;
              const leftPercent = sch.colIndex * widthPercent;
              const sDate = new Date(sch.start_time);
              const startTimeStr = sDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
              const endTimeStr = sch.end_time
                ? new Date(sch.end_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                : '';

              const memoText = sch.raw_payload?.memo ?? sch.description ?? '';
              const hasMemo = Boolean(memoText && memoText.trim().length > 0);
              const isTask = Boolean(sch.raw_payload?.is_task || (sch as any).source === 'chrono_task');
              const isCompleted = Boolean(sch.raw_payload?.isCompleted || sch.raw_payload?.is_completed);

              return (
                <div
                  key={sch.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSchedule(sch);
                    setShowActionSheet(true);
                  }}
                  style={{
                    top: `${sch.top}px`,
                    height: `${sch.height}px`,
                    left: `${leftPercent}%`,
                    width: `calc(${widthPercent}% - 3px)`,
                    backgroundColor: isCompleted ? '#f1f5f9' : colorInfo.hex,
                    color: isCompleted ? '#64748b' : colorInfo.textHex,
                    borderColor: isCompleted ? '#cbd5e1' : undefined,
                  }}
                  className={`absolute rounded-lg sm:rounded-xl p-1.5 sm:p-2 shadow-2xs border overflow-hidden cursor-pointer hover:brightness-95 transition z-20 flex flex-col justify-start select-none pointer-events-auto ${
                    isCompleted ? 'border-slate-300 opacity-85' : 'border-black/10'
                  }`}
                  title={`${sch.title}${isCompleted ? ' (完了済み)' : ''} (${startTimeStr}${endTimeStr ? ` - ${endTimeStr}` : ''})`}
                >
                  {/* Googleカレンダー仕様：タイトルと時刻の2段表示 ＆ メモあり時アイコンボタン */}
                  <div className="flex items-center justify-between gap-1 w-full">
                    <div className="text-xs sm:text-sm font-bold truncate leading-tight flex-1 flex items-center gap-1 min-w-0">
                      {(isTask || isCompleted) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleComplete?.(sch.id, !isCompleted);
                          }}
                          className="p-0.5 -ml-0.5 rounded hover:bg-black/10 active:scale-95 transition cursor-pointer shrink-0 flex items-center justify-center"
                          title={isCompleted ? '未完了に戻す' : '完了にする'}
                        >
                          {isCompleted ? (
                            <CheckSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <Square className="w-3.5 h-3.5 opacity-70 hover:opacity-100 shrink-0" />
                          )}
                        </button>
                      )}
                      <span className={`truncate ${isCompleted ? 'line-through opacity-75' : ''}`}>
                        {sch.title}
                      </span>
                    </div>
                    {hasMemo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMemoTargetSchedule(sch);
                        }}
                        className="p-0.5 rounded bg-black/20 hover:bg-black/30 text-white shrink-0 shadow-2xs transition"
                        title="予定メモを見る・変更する"
                      >
                        <FileText className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {sch.height >= 36 && (
                    <span className={`text-[10px] font-mono truncate mt-0.5 leading-tight ${isCompleted ? 'opacity-65' : 'opacity-85'}`}>
                      {startTimeStr}
                      {endTimeStr && ` - ${endTimeStr}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 既存予定タップ時のアクションシート ── */}
      {showActionSheet && selectedSchedule && (() => {
        const isCompleted = Boolean(
          selectedSchedule.raw_payload?.isCompleted || selectedSchedule.raw_payload?.is_completed
        );
        const isTask = Boolean(
          selectedSchedule.raw_payload?.is_task || (selectedSchedule as any).source === 'chrono_task'
        );

        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in"
            onClick={() => setShowActionSheet(false)}
          >
            <div
              className="bg-white w-full max-w-sm rounded-2xl p-4 shadow-xl border border-slate-100 space-y-3 animate-in slide-in-from-bottom-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-slate-100 pb-2.5 gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className="w-4 h-4 rounded-full shrink-0 mt-1"
                    style={{
                      backgroundColor: isCompleted
                        ? '#94a3b8'
                        : getGoogleColor(selectedSchedule.raw_payload?.color).hex,
                    }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4
                        className={`font-bold text-base leading-snug break-words ${
                          isCompleted ? 'line-through text-slate-500' : 'text-slate-900'
                        }`}
                      >
                        {selectedSchedule.title}
                      </h4>
                      {isCompleted && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                          完了済み
                        </span>
                      )}
                    </div>
                    {selectedSchedule.source && (
                      <span className="text-[10px] text-slate-400 font-medium">
                        {selectedSchedule.source === 'google' || selectedSchedule.source === 'google_calendar'
                          ? 'Googleカレンダー'
                          : 'Chronoタスク'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowActionSheet(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* ── 予定詳細カード（時間・場所・メモの全文表示） ── */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs">
                {/* 時間帯 */}
                <div className="flex items-center gap-2 text-slate-700">
                  <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="font-bold text-sm">
                    {selectedSchedule.raw_payload?.isAllDay
                      ? '終日'
                      : (() => {
                          const s = new Date(selectedSchedule.start_time);
                          const sStr = s.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                          if (!selectedSchedule.end_time) return sStr;
                          const e = new Date(selectedSchedule.end_time);
                          const eStr = e.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                          const diffMin = Math.round((e.getTime() - s.getTime()) / 60000);
                          const diffStr = diffMin > 0
                            ? ` (${Math.floor(diffMin / 60) > 0 ? `${Math.floor(diffMin / 60)}時間` : ''}${diffMin % 60 > 0 ? `${diffMin % 60}分` : ''})`
                            : '';
                          return `${sStr} 〜 ${eStr}${diffStr}`;
                        })()}
                  </span>
                </div>

                {/* 場所 */}
                {(selectedSchedule.location || selectedSchedule.raw_payload?.location) && (
                  <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-200/60">
                    <div className="flex items-start gap-1.5 min-w-0 text-slate-700">
                      <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <span className="font-semibold break-words">
                        {selectedSchedule.location || selectedSchedule.raw_payload?.location}
                      </span>
                    </div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        selectedSchedule.location || selectedSchedule.raw_payload?.location || ''
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200/60 transition"
                      title="Googleマップで開く"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {/* メモ / 説明文（全文スクロール表示） */}
                {(() => {
                  const memoContent = selectedSchedule.raw_payload?.memo || selectedSchedule.description;
                  if (!memoContent || !memoContent.trim()) return null;
                  return (
                    <div className="pt-1 border-t border-slate-200/60">
                      <div className="flex items-center gap-1.5 text-amber-800 font-bold mb-1">
                        <FileText className="w-3.5 h-3.5 text-amber-600" />
                        <span>メモ・詳細</span>
                      </div>
                      <div className="p-2 bg-amber-50/70 border border-amber-200/70 rounded-lg text-slate-800 text-xs leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                        {memoContent}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-2 pt-1">
                {/* 完了 / 未完了切り替えボタン */}
                {onToggleComplete && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleComplete(selectedSchedule.id, !isCompleted);
                      setShowActionSheet(false);
                    }}
                    className={`w-full py-3 px-4 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer shadow-xs ${
                      isCompleted
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                        : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-emerald-200'
                    }`}
                  >
                    {isCompleted ? (
                      <>
                        <Square className="w-4 h-4 text-slate-500" />
                        <span>完了を取り消す（未完了に戻す）</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-4 h-4 text-white" />
                        <span>この{isTask ? 'タスク' : '予定'}を完了にする</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={() => openEditModal(selectedSchedule)}
                  className="w-full py-3 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Edit2 className="w-4 h-4" /> 予定を変更する
                </button>

              {/* 「予定を変更する」の直下に「この予定にメモを書く / 見る」ボタン */}
              {(() => {
                const memoText = selectedSchedule.raw_payload?.memo ?? selectedSchedule.description ?? '';
                const hasMemo = Boolean(memoText && memoText.trim().length > 0);
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedSchedule;
                      setShowActionSheet(false);
                      setMemoTargetSchedule(target);
                    }}
                    className={`w-full py-3 px-4 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                      hasMemo
                        ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 shadow-2xs'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-amber-700" />
                    <span>{hasMemo ? 'この予定のメモを編集する' : 'この予定にメモを書く'}</span>
                  </button>
                );
              })()}

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
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> この予定を削除する
              </button>
            </div>
          </div>
        </div>
        );
      })()}

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

      {/* ── 予定ごとのメモ閲覧・編集・音声入力モーダル ── */}
      <ScheduleMemoModal
        isOpen={Boolean(memoTargetSchedule)}
        schedule={memoTargetSchedule}
        onClose={() => setMemoTargetSchedule(null)}
        onSave={async (id, memo) => {
          if (onUpdateScheduleMemo) {
            await onUpdateScheduleMemo(id, memo);
          }
          setMemoTargetSchedule((prev) =>
            prev ? { ...prev, raw_payload: { ...(prev.raw_payload || {}), memo } } : null
          );
        }}
        onDelete={async (id) => {
          if (onDeleteScheduleMemo) {
            await onDeleteScheduleMemo(id);
          }
          setMemoTargetSchedule((prev) =>
            prev ? { ...prev, raw_payload: { ...(prev.raw_payload || {}), memo: null }, description: null } : null
          );
        }}
        onAddSchedule={onAddSchedule}
      />
    </div>
  );
}

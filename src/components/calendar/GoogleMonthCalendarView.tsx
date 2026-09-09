'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Clock,
  FileText,
  X,
  ArrowRight,
} from 'lucide-react';
import { getGoogleColor } from './GoogleColors';

export interface CalendarScheduleItem {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  raw_payload?: {
    color?: string;
    isAllDay?: boolean;
    [key: string]: any;
  } | null;
}

export interface CalendarNoteItem {
  date: string; // "YYYY-MM-DD"
  [key: string]: any;
}

interface GoogleMonthCalendarViewProps {
  year: number;
  month: number;
  schedules: CalendarScheduleItem[];
  notes: CalendarNoteItem[];
  selectedDate: string; // "YYYY-MM-DD"
  onSelectDate: (dateStr: string) => void;
  onOpenDay?: (dateStr: string) => void;
  onChangeMonth: (delta: number) => void;
  onSetYearMonth: (year: number, month: number) => void;
  onSyncCalendar?: () => void;
  isSyncingCalendar?: boolean;
  googleConnected?: boolean;
}

interface DayItem {
  year: number;
  month: number;
  day: number;
  dateStr: string;
  isCurrentMonth: boolean;
  dayOfWeek: number; // 0=Sun, 6=Sat
}

interface WeekItem {
  weekIndex: number;
  days: DayItem[];
}

interface AllocatedEvent extends CalendarScheduleItem {
  startDateStr: string;
  endDateStr: string;
  startCol: number;
  endCol: number;
  isStart: boolean;
  isEnd: boolean;
  isMultiDay: boolean;
  span: number;
  slot: number;
}

// 日本時間（ローカル）での "YYYY-MM-DD" 変換ヘルパー
function toLocalDateStr(isoString: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLocalDate(y: number, m: number, d: number): string {
  return `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export default function GoogleMonthCalendarView({
  year,
  month,
  schedules,
  notes,
  selectedDate,
  onSelectDate,
  onOpenDay,
  onChangeMonth,
  onSetYearMonth,
  onSyncCalendar,
  isSyncingCalendar = false,
  googleConnected = false,
}: GoogleMonthCalendarViewProps) {
  // 1日拡大プレビュー用状態
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const lastTapRef = useRef<{ date: string; time: number } | null>(null);

  // 今日のローカル日付
  const todayDateStr = useMemo(() => {
    const now = new Date();
    return toLocalDateStr(now.toISOString());
  }, []);

  // 日付タップハンドラー（1回タップで拡大プレビュー、2連続タップまたはプレビュー中再タップで1日手帳へ進む）
  const handleDayTap = useCallback(
    (dateStr: string) => {
      const now = Date.now();
      const isDoubleTap =
        lastTapRef.current &&
        lastTapRef.current.date === dateStr &&
        (now - lastTapRef.current.time < 500 || previewDate === dateStr);

      if (isDoubleTap) {
        lastTapRef.current = null;
        setPreviewDate(null);
        if (onOpenDay) {
          onOpenDay(dateStr);
        } else {
          onSelectDate(dateStr);
        }
      } else {
        lastTapRef.current = { date: dateStr, time: now };
        setPreviewDate(dateStr);
        onSelectDate(dateStr);
      }
    },
    [previewDate, onOpenDay, onSelectDate]
  );

  // 1. カレンダーの週構造を生成（日曜日〜土曜日）
  const weeks = useMemo<WeekItem[]>(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=Sun

    const result: WeekItem[] = [];
    let currentDays: DayItem[] = [];

    // 前月の日付埋め
    const prevMonthDays = new Date(year, month - 1, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      currentDays.push({
        year: prevY,
        month: prevM,
        day,
        dateStr: formatLocalDate(prevY, prevM, day),
        isCurrentMonth: false,
        dayOfWeek: currentDays.length,
      });
    }

    // 当月の日付
    for (let d = 1; d <= daysInMonth; d++) {
      currentDays.push({
        year,
        month,
        day: d,
        dateStr: formatLocalDate(year, month, d),
        isCurrentMonth: true,
        dayOfWeek: currentDays.length,
      });

      if (currentDays.length === 7) {
        result.push({
          weekIndex: result.length,
          days: currentDays,
        });
        currentDays = [];
      }
    }

    // 翌月の日付埋め
    if (currentDays.length > 0) {
      let nextD = 1;
      const nextM = month === 12 ? 1 : month + 1;
      const nextY = month === 12 ? year + 1 : year;
      while (currentDays.length < 7) {
        currentDays.push({
          year: nextY,
          month: nextM,
          day: nextD,
          dateStr: formatLocalDate(nextY, nextM, nextD),
          isCurrentMonth: false,
          dayOfWeek: currentDays.length,
        });
        nextD++;
      }
      result.push({
        weekIndex: result.length,
        days: currentDays,
      });
    }

    return result;
  }, [year, month]);

  // 2. 週ごとのスロット配置計算（Googleカレンダー風：複数日連結バー）
  const weekDataList = useMemo(() => {
    const MAX_VISIBLE_SLOTS = 3; // 各日に表示する最大行数

    return weeks.map((week) => {
      const weekStartStr = week.days[0].dateStr;
      const weekEndStr = week.days[6].dateStr;

      // この週に含まれる予定を抽出
      const weekEvents: any[] = [];
      for (const sch of schedules) {
        if (!sch.start_time) continue;
        const startDateStr = toLocalDateStr(sch.start_time);
        let endDateStr = sch.end_time ? toLocalDateStr(sch.end_time) : startDateStr;
        if (endDateStr < startDateStr) endDateStr = startDateStr;

        // 重なり判定
        if (startDateStr <= weekEndStr && endDateStr >= weekStartStr) {
          const isMultiDay = startDateStr !== endDateStr;

          // 週内での開始列・終了列
          let startCol = 0;
          let endCol = 6;
          let isStart = false;
          let isEnd = false;

          for (let c = 0; c < 7; c++) {
            if (week.days[c].dateStr === startDateStr) {
              startCol = c;
              isStart = true;
            }
            if (week.days[c].dateStr === endDateStr) {
              endCol = c;
              isEnd = true;
            }
          }

          if (startDateStr < weekStartStr) {
            startCol = 0;
            isStart = false;
          }
          if (endDateStr > weekEndStr) {
            endCol = 6;
            isEnd = false;
          }

          weekEvents.push({
            ...sch,
            startDateStr,
            endDateStr,
            startCol,
            endCol,
            isStart,
            isEnd,
            isMultiDay,
            span: endCol - startCol + 1,
          });
        }
      }

      // ソート: 1. 複数日優先（スパンが長い順）、2. 開始列順、3. タイトル順
      weekEvents.sort((a, b) => {
        if (a.isMultiDay && !b.isMultiDay) return -1;
        if (!a.isMultiDay && b.isMultiDay) return 1;
        if (b.span !== a.span) return b.span - a.span;
        if (a.startCol !== b.startCol) return a.startCol - b.startCol;
        return a.title.localeCompare(b.title);
      });

      // スロット割り当て
      const slots: boolean[][] = [];
      const allocatedEvents: AllocatedEvent[] = [];
      const overflowCount: number[] = new Array(7).fill(0);

      for (const ev of weekEvents) {
        let assignedSlot = -1;
        for (let sIdx = 0; sIdx < slots.length; sIdx++) {
          let canFit = true;
          for (let col = ev.startCol; col <= ev.endCol; col++) {
            if (slots[sIdx][col]) {
              canFit = false;
              break;
            }
          }
          if (canFit) {
            assignedSlot = sIdx;
            break;
          }
        }

        if (assignedSlot === -1) {
          assignedSlot = slots.length;
          slots.push(new Array(7).fill(false));
        }

        for (let col = ev.startCol; col <= ev.endCol; col++) {
          slots[assignedSlot][col] = true;
        }

        if (assignedSlot < MAX_VISIBLE_SLOTS) {
          allocatedEvents.push({
            ...ev,
            slot: assignedSlot,
          });
        } else {
          // 表示制限を超えたイベント
          for (let col = ev.startCol; col <= ev.endCol; col++) {
            overflowCount[col]++;
          }
        }
      }

      // スロットごと（0, 1, 2）のイベントリストに整理
      const slotRows: AllocatedEvent[][] = [];
      for (let s = 0; s < Math.min(slots.length, MAX_VISIBLE_SLOTS); s++) {
        slotRows.push(allocatedEvents.filter((e) => e.slot === s));
      }

      return {
        week,
        slotRows,
        overflowCount,
      };
    });
  }, [weeks, schedules]);

  // 拡大プレビュー対象日の予定一覧
  const previewEvents = useMemo(() => {
    if (!previewDate) return [];
    return schedules
      .filter((sch) => {
        if (!sch.start_time) return false;
        const s = toLocalDateStr(sch.start_time);
        const e = sch.end_time ? toLocalDateStr(sch.end_time) : s;
        const endSafe = e < s ? s : e;
        return s <= previewDate && previewDate <= endSafe;
      })
      .sort((a, b) => {
        const aAllDay = a.raw_payload?.isAllDay ? 1 : 0;
        const bAllDay = b.raw_payload?.isAllDay ? 1 : 0;
        if (aAllDay !== bAllDay) return bAllDay - aAllDay;
        return (a.start_time || '').localeCompare(b.start_time || '');
      });
  }, [previewDate, schedules]);

  // 拡大プレビュー対象日のノート
  const previewNote = useMemo(() => {
    if (!previewDate) return null;
    return notes.find((n) => n.date === previewDate) || null;
  }, [previewDate, notes]);

  // 拡大プレビュー対象日の日付情報
  const previewDateObj = useMemo(() => {
    if (!previewDate) return null;
    const parts = previewDate.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    const dateInst = new Date(y, m - 1, d);
    const dayOfWeekNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = dateInst.getDay();
    const isToday = previewDate === todayDateStr;
    return {
      year: y,
      month: m,
      day: d,
      dayOfWeek,
      dayOfWeekName: dayOfWeekNames[dayOfWeek],
      isToday,
    };
  }, [previewDate, todayDateStr]);

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl p-1.5 sm:p-6 border border-slate-200 shadow-xs space-y-3 sm:space-y-4">
      {/* ── 月間カレンダーヘッダー ── */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shadow-2xs">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl border border-slate-200">
              <select
                value={year}
                onChange={(e) => onSetYearMonth(parseInt(e.target.value, 10), month)}
                className="bg-white text-slate-900 font-black text-base sm:text-lg px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
              <select
                value={month}
                onChange={(e) => onSetYearMonth(year, parseInt(e.target.value, 10))}
                className="bg-white text-indigo-700 font-black text-base sm:text-lg px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 hidden md:block">
              タップでプレビュー、2回タップで1日手帳へ進みます
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {googleConnected && onSyncCalendar && (
            <button
              onClick={onSyncCalendar}
              disabled={isSyncingCalendar}
              className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs sm:text-sm transition flex items-center gap-1 shadow-xs disabled:opacity-50"
              title="Googleカレンダーと同期"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCalendar ? 'animate-spin text-indigo-600' : 'text-indigo-600'}`} />
              <span className="hidden sm:inline">{isSyncingCalendar ? '同期中...' : 'Google同期'}</span>
            </button>
          )}
          <button
            onClick={() => {
              setPreviewDate(null);
              onChangeMonth(-1);
            }}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition flex items-center gap-1"
            title="前月"
          >
            <ChevronLeft className="w-4 h-4" /> 前月
          </button>
          <button
            onClick={() => {
              setPreviewDate(null);
              const now = new Date();
              onSetYearMonth(now.getFullYear(), now.getMonth() + 1);
              onSelectDate(toLocalDateStr(now.toISOString()));
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-xs"
          >
            今月
          </button>
          <button
            onClick={() => {
              setPreviewDate(null);
              onChangeMonth(1);
            }}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition flex items-center gap-1"
            title="翌月"
          >
            翌月 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── 曜日ヘッダー ── */}
      <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs sm:text-sm py-2 border-b border-slate-200/80">
        <span className="text-rose-600 bg-rose-50/60 py-1.5 rounded-lg">日</span>
        <span className="text-slate-700 py-1.5">月</span>
        <span className="text-slate-700 py-1.5">火</span>
        <span className="text-slate-700 py-1.5">水</span>
        <span className="text-slate-700 py-1.5">木</span>
        <span className="text-slate-700 py-1.5">金</span>
        <span className="text-sky-600 bg-sky-50/60 py-1.5 rounded-lg">土</span>
      </div>

      {/* ── 週単位のカレンダー本体（Googleカレンダー風 複数日連結バー描画） ── */}
      <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden divide-y divide-slate-200">
        {weekDataList.map(({ week, slotRows, overflowCount }) => (
          <div key={week.weekIndex} className="relative min-h-[105px] sm:min-h-[125px]">
            {/* 1. 背景グリッド＆日付セル（7列） */}
            <div className="absolute inset-0 grid grid-cols-7 divide-x divide-slate-100 pointer-events-none">
              {week.days.map((dayObj) => {
                const isToday = dayObj.dateStr === todayDateStr;
                const isPreviewing = dayObj.dateStr === previewDate;
                const isSelected = dayObj.dateStr === selectedDate;
                const hasNote = notes.some((n) => n.date === dayObj.dateStr);

                return (
                  <div
                    key={dayObj.dateStr}
                    onClick={() => handleDayTap(dayObj.dateStr)}
                    className={`h-full pointer-events-auto transition cursor-pointer p-1 sm:p-1.5 flex flex-col justify-between ${
                      !dayObj.isCurrentMonth
                        ? 'bg-slate-50/50 opacity-40 hover:opacity-80'
                        : isPreviewing || isSelected
                        ? 'ring-2 ring-indigo-600 ring-inset rounded-lg'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* 日付数字ヘッダー */}
                    <div className="flex items-center justify-between w-full pointer-events-none">
                      <span
                        className={`text-xs sm:text-sm font-bold rounded-full w-6 h-6 flex items-center justify-center ${
                          isToday
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : isPreviewing || isSelected
                            ? 'text-indigo-600 font-black'
                            : dayObj.dayOfWeek === 0
                            ? 'text-rose-600'
                            : dayObj.dayOfWeek === 6
                            ? 'text-sky-600'
                            : 'text-slate-800'
                        }`}
                      >
                        {dayObj.day}
                      </span>
                      {hasNote && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" title="手帳ノートあり" />
                      )}
                    </div>

                    {/* 超過件数バッジ（各日最下部） */}
                    <div className="w-full pointer-events-none min-h-[14px]">
                      {overflowCount[dayObj.dayOfWeek] > 0 && (
                        <div className="text-[9px] sm:text-[10px] text-slate-500 font-bold pl-0.5 leading-none">
                          他 {overflowCount[dayObj.dayOfWeek]} 件
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 2. イベントバーレイヤー（日付数字分の下部余白 pt-7 sm:pt-8 に配置、z-20で最前面配置を保証） */}
            <div className="relative z-20 pt-7 sm:pt-8 px-0.5 sm:px-1 pb-4 flex flex-col gap-1 pointer-events-none">
              {slotRows.map((eventsInSlot, slotIdx) => (
                <div key={slotIdx} className="grid grid-cols-7 gap-1 h-5 sm:h-6 items-center">
                  {eventsInSlot.map((ev) => {
                    const colorInfo = getGoogleColor(ev.raw_payload?.color);

                    // 角丸のスタイル算出
                    let roundedClass = 'rounded-md';
                    if (ev.isMultiDay) {
                      if (ev.isStart && ev.isEnd) {
                        roundedClass = 'rounded-md';
                      } else if (ev.isStart) {
                        roundedClass = 'rounded-l-md rounded-r-none';
                      } else if (ev.isEnd) {
                        roundedClass = 'rounded-l-none rounded-r-md';
                      } else {
                        roundedClass = 'rounded-none';
                      }
                    }

                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDayTap(ev.startDateStr);
                        }}
                        style={{
                          gridColumnStart: ev.startCol + 1,
                          gridColumnEnd: ev.endCol + 2,
                          backgroundColor: colorInfo.hex,
                          color: colorInfo.textHex,
                        }}
                        className={`h-full pointer-events-auto cursor-pointer flex items-center px-1 sm:px-2 shadow-2xs hover:brightness-95 transition select-none overflow-hidden ${roundedClass}`}
                        title={ev.title}
                      >
                        {/* 予定タイトル（Googleカレンダー風：横長バー内でスマートにtruncate） */}
                        <span className="text-[9px] sm:text-xs font-bold truncate leading-tight block w-full">
                          {ev.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── 1日拡大プレビューモーダル（暗転フィルターなし・明るくクリアな表示） ── */}
      {previewDate && previewDateObj && (
        <div
          className="fixed inset-0 bg-transparent z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-auto"
          onClick={() => setPreviewDate(null)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl border-2 border-slate-200 overflow-hidden flex flex-col max-h-[82vh] animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-indigo-50/40">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-black shadow-xs ${
                    previewDateObj.isToday
                      ? 'bg-indigo-600 text-white'
                      : previewDateObj.dayOfWeek === 0
                      ? 'bg-rose-100 text-rose-700'
                      : previewDateObj.dayOfWeek === 6
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <span className="text-[10px] leading-tight font-bold opacity-80">
                    {previewDateObj.dayOfWeekName}
                  </span>
                  <span className="text-xl leading-none font-black">
                    {previewDateObj.day}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-black text-slate-900">
                      {previewDateObj.year}年{previewDateObj.month}月{previewDateObj.day}日 ({previewDateObj.dayOfWeekName})
                    </span>
                    {previewDateObj.isToday && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white shadow-2xs">
                        今日
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    {previewEvents.length > 0
                      ? `${previewEvents.length} 件の予定`
                      : '予定はありません'}
                    {previewNote?.hasContent && ' • メモ・実績あり'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewDate(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* モーダルコンテンツ（予定一覧スクロールエリア） */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 max-h-[48vh] flex-1">
              {previewEvents.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  <CalendarDays className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-bold text-slate-500">予定はありません</p>
                  <p className="text-xs text-slate-400 mt-1">下のボタンから1日手帳を開いて予定を追加できます</p>
                </div>
              ) : (
                previewEvents.map((ev) => {
                  const colorInfo = getGoogleColor(ev.raw_payload?.color);
                  const isAllDay = ev.raw_payload?.isAllDay;

                  let timeLabel = '終日';
                  if (!isAllDay && ev.start_time) {
                    const sDate = new Date(ev.start_time);
                    const sTime = sDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                    if (ev.end_time) {
                      const eDate = new Date(ev.end_time);
                      const eTime = eDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                      timeLabel = `${sTime} 〜 ${eTime}`;
                    } else {
                      timeLabel = `${sTime} 〜`;
                    }
                  }

                  return (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition flex items-start gap-3 shadow-2xs"
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 shadow-xs"
                        style={{ backgroundColor: colorInfo.hex }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900 leading-snug break-words">
                          {ev.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1 font-medium">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{timeLabel}</span>
                          {isAllDay && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">
                              終日
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* 手帳ノート（メモ・実績）の有無（実際に記録がある場合のみ表示） */}
              {previewNote?.hasContent && (
                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 flex items-center justify-between text-xs text-amber-900 font-medium shadow-2xs">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-bold">この日のメモ・実績あり</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {previewNote.memoCount > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 font-semibold">
                        メモ {previewNote.memoCount}件
                      </span>
                    )}
                    {previewNote.activityCount > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-900 font-semibold">
                        実績 {previewNote.activityCount}件
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* モーダルフッター（1日手帳へのナビゲーションボタン） */}
            <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const target = previewDate;
                  setPreviewDate(null);
                  if (onOpenDay) {
                    onOpenDay(target);
                  } else {
                    onSelectDate(target);
                  }
                }}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-sm rounded-xl transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>1日手帳を開く（タイムライン）</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-[11px] text-center text-slate-400 font-medium">
                ※ カレンダーのマスをもう一度タップ（2連続タップ）でも開きます
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

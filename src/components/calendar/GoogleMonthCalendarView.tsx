'use client';

import React, { useMemo } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
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
  onChangeMonth,
  onSetYearMonth,
  onSyncCalendar,
  isSyncingCalendar = false,
  googleConnected = false,
}: GoogleMonthCalendarViewProps) {
  // 今日のローカル日付
  const todayDateStr = useMemo(() => {
    const now = new Date();
    return toLocalDateStr(now.toISOString());
  }, []);

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
            <p className="text-[11px] text-slate-400 hidden md:block">日付タップで1日詳細へ移動</p>
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
            onClick={() => onChangeMonth(-1)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition flex items-center gap-1"
            title="前月"
          >
            <ChevronLeft className="w-4 h-4" /> 前月
          </button>
          <button
            onClick={() => {
              const now = new Date();
              onSetYearMonth(now.getFullYear(), now.getMonth() + 1);
              onSelectDate(toLocalDateStr(now.toISOString()));
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-xs"
          >
            今月
          </button>
          <button
            onClick={() => onChangeMonth(1)}
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
      <div className="border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden divide-y divide-slate-200">
        {weekDataList.map(({ week, slotRows, overflowCount }) => (
          <div key={week.weekIndex} className="relative min-h-[105px] sm:min-h-[125px]">
            {/* 1. 背景グリッド＆日付セル（7列） */}
            <div className="absolute inset-0 grid grid-cols-7 divide-x divide-slate-100 pointer-events-none">
              {week.days.map((dayObj) => {
                const isToday = dayObj.dateStr === todayDateStr;
                const isSelected = dayObj.dateStr === selectedDate;
                const hasNote = notes.some((n) => n.date === dayObj.dateStr);

                return (
                  <div
                    key={dayObj.dateStr}
                    onClick={() => onSelectDate(dayObj.dateStr)}
                    className={`h-full pointer-events-auto transition cursor-pointer p-1 sm:p-1.5 flex flex-col justify-between ${
                      !dayObj.isCurrentMonth
                        ? 'bg-slate-50/40 opacity-40 hover:opacity-80'
                        : isSelected
                        ? 'bg-indigo-50/90 ring-2 ring-indigo-400 z-10'
                        : isToday
                        ? 'bg-amber-50/60'
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    {/* 日付数字ヘッダー */}
                    <div className="flex items-center justify-between w-full pointer-events-none">
                      <span
                        className={`text-xs sm:text-sm font-bold rounded-full w-6 h-6 flex items-center justify-center ${
                          isToday
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : isSelected
                            ? 'text-indigo-700 font-black'
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

            {/* 2. イベントバーレイヤー（日付数字分の下部余白 pt-7 sm:pt-8 に配置） */}
            <div className="relative pt-7 sm:pt-8 px-0.5 sm:px-1 pb-4 flex flex-col gap-1 pointer-events-none">
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
                          onSelectDate(ev.startDateStr);
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
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Mic,
  MicOff,
  Camera,
  Sparkles,
  Search,
  CheckCircle2,
  Clock,
  ListTodo,
  FileText,
  FolderTree,
  Plus,
  Loader2,
  Image as ImageIcon,
  Send,
  Trash2,
  CalendarDays,
  RefreshCw,
  X,
  Edit2,
  Check,
} from 'lucide-react';
import { useAutoLocationTracker } from '@/hooks/useAutoLocationTracker';
import DailyTimelineView, { ScheduleItem } from '@/components/calendar/DailyTimelineView';
import GoogleMonthCalendarView from '@/components/calendar/GoogleMonthCalendarView';
import { GOOGLE_CALENDAR_COLORS, getGoogleColor } from '@/components/calendar/GoogleColors';

type VoiceTarget = 'memo' | 'schedule' | 'activity' | 'search';
type ActiveTab = 'notebook' | 'calendar' | 'search';
type DailySubTab = 'timeline' | 'notes';

// 日本時間（ローカル日付）を "YYYY-MM-DD" で取得するヘルパー関数
function formatLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayLocalDate(): string {
  return formatLocalDate(new Date());
}

function addDaysToDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const date = new Date(y, m - 1, d + offsetDays);
  return formatLocalDate(date);
}

// 日本時間（ローカル時刻）ベースで日付を比較するヘルパー関数
function isSameDay(isoString: string, targetDateStr: string): boolean {
  if (!isoString || !targetDateStr) return false;
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}` === targetDateStr;
}

// 日本時間（ローカル）ベースで複数日スケジュールを含む該当日判定ヘルパー関数
function isDateInRange(targetDateStr: string, startTimeIso: string, endTimeIso?: string | null): boolean {
  if (!targetDateStr || !startTimeIso) return false;

  // JST基準の日付文字列を取得
  const sDate = new Date(startTimeIso);
  const sY = sDate.getFullYear();
  const sM = (sDate.getMonth() + 1).toString().padStart(2, '0');
  const sD = sDate.getDate().toString().padStart(2, '0');
  const startDateStr = `${sY}-${sM}-${sD}`;

  // 開始日と一致していれば必ず該当
  if (targetDateStr === startDateStr) return true;

  if (endTimeIso) {
    const eDate = new Date(endTimeIso);
    const eY = eDate.getFullYear();
    const eM = (eDate.getMonth() + 1).toString().padStart(2, '0');
    const eD = eDate.getDate().toString().padStart(2, '0');
    const endDateStr = `${eY}-${eM}-${eD}`;
    if (targetDateStr === endDateStr) return true;
    if (endDateStr >= startDateStr) {
      return targetDateStr >= startDateStr && targetDateStr <= endDateStr;
    }
  }

  return false;
}

export default function DailyNotebookPage() {
  // 日付管理（デフォルト今日: 日本時間ローカル基準 YYYY-MM-DD）
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayLocalDate());

  // データ状態
  const [noteData, setNoteData] = useState<any>(null);
  const [scheduleEvents, setScheduleEvents] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [rawInputs, setRawInputs] = useState<any[]>([]);
  const [aiSummaries, setAiSummaries] = useState<any[]>([]);
  const [locationTracks, setLocationTracks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 入力フォーム状態
  const [newMemoText, setNewMemoText] = useState<string>('');
  const [newActivityTitle, setNewActivityTitle] = useState<string>('');
  const [newScheduleTitle, setNewScheduleTitle] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);

  // 実績編集用状態（案B：ポップアップ編集）
  const [editingActivity, setEditingActivity] = useState<any | null>(null);
  const [editActivityTitle, setEditActivityTitle] = useState<string>('');
  const [editActivityTime, setEditActivityTime] = useState<string>('12:00');
  const [editActivityLocation, setEditActivityLocation] = useState<string>('');
  const [isSavingActivity, setIsSavingActivity] = useState<boolean>(false);

  // デイリーメモ編集用状態
  const [editingRawInput, setEditingRawInput] = useState<any | null>(null);
  const [editRawInputContent, setEditRawInputContent] = useState<string>('');
  const [isSavingRawInput, setIsSavingRawInput] = useState<boolean>(false);

  // 音声認識状態 (Web Speech API) - 長時間無制限＆ハウリング完全防止設計
  const [activeVoiceTarget, setActiveVoiceTarget] = useState<VoiceTarget | null>(null);
  const voiceInitialTextRef = useRef<string>('');
  const currentRecognizedTextRef = useRef<string>('');
  const isVoiceActiveRef = useRef<boolean>(false);
  const activeVoiceTargetRef = useRef<VoiceTarget | null>(null);
  const recognitionRef = useRef<any>(null);

  // Googleカレンダー双方向同期用状態
  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState<boolean>(false);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  // 月間カレンダー表示用状態
  const todayObj = new Date();
  const [calendarYear, setCalendarYear] = useState<number>(todayObj.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(todayObj.getMonth() + 1);
  const [previewDate, setPreviewDate] = useState<string>(() => getTodayLocalDate());
  const [popupDate, setPopupDate] = useState<string | null>(null);
  const [monthSummary, setMonthSummary] = useState<{ notes: any[]; schedules: any[] }>({
    notes: [],
    schedules: [],
  });
  const [isLoadingMonth, setIsLoadingMonth] = useState<boolean>(false);

  // 検索・タブ状態
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('notebook');

  // 手帳内サブタブ（予定タイムライン ↔ ノート）＆横フリック対応
  const [dailySubTab, setDailySubTab] = useState<DailySubTab>('timeline');
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        setDailySubTab('notes'); // 左へスワイプ -> ノートへ
      } else {
        setDailySubTab('timeline'); // 右へスワイプ -> 予定へ
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // ポップアップ選択日の位置情報
  const [popupLocationTracks, setPopupLocationTracks] = useState<any[]>([]);

  useEffect(() => {
    if (popupDate) {
      fetch(`/api/location?date=${popupDate}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const list = Array.isArray(data) ? data : (data?.records || []);
          setPopupLocationTracks(list);
        })
        .catch(() => setPopupLocationTracks([]));
    }
  }, [popupDate]);

  // GPS自動記録フック
  const { isTracking, currentLocation, lastSavedLocation, error: gpsError } =
    useAutoLocationTracker('owner');

  // Google連携ステータス確認
  const checkGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/sync');
      if (res.ok) {
        const data = await res.json();
        setGoogleConnected(!!data.connected);
      }
    } catch (err) {
      console.error('Check Google status error:', err);
    }
  }, []);



  // 1. デイリーノートデータの取得
  const fetchNoteData = useCallback(async (date: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notes?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setNoteData(data.note);
        setScheduleEvents(data.scheduleEvents);
        setActivityLogs(data.activityLogs);
        setRawInputs(data.rawInputs);
        setAiSummaries(data.aiSummaries);
        setLocationTracks(data.locationTracks);
      }
    } catch (err) {
      console.error('Fetch note error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNoteData(selectedDate);
  }, [selectedDate, fetchNoteData]);

  // 月間サマリーデータの取得（カレンダー用）
  const fetchMonthSummary = useCallback(async (year: number, month: number) => {
    setIsLoadingMonth(true);
    try {
      const monthStr = month.toString().padStart(2, '0');
      const res = await fetch(`/api/notes?mode=month&year=${year}&month=${monthStr}`);
      if (res.ok) {
        const data = await res.json();
        setMonthSummary({
          notes: data.notes || [],
          schedules: data.schedules || [],
        });
      }
    } catch (err) {
      console.error('Fetch month error:', err);
    } finally {
      setIsLoadingMonth(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'calendar') {
      fetchMonthSummary(calendarYear, calendarMonth);
    }
  }, [activeTab, calendarYear, calendarMonth, fetchMonthSummary]);

  // Google連携解除
  const handleDisconnectGoogle = async () => {
    if (!confirm('Googleカレンダーとの連携を解除しますか？\n（※Googleカレンダー本体の予定が消えることはありません）')) return;
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' });
      if (res.ok) {
        setGoogleConnected(false);
        setSyncToastMessage('Googleカレンダーとの連携を解除しました');
        setTimeout(() => setSyncToastMessage(null), 4000);
      }
    } catch (err: any) {
      alert('連携解除エラー: ' + err.message);
    }
  };

  // Googleカレンダー双方向同期実行
  const handleSyncCalendar = useCallback(async (isSilent = false) => {
    setIsSyncingCalendar(true);
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setGoogleConnected(true);
        setSyncToastMessage(`Googleカレンダー同期完了（新規取込: ${data.pulledCount}件, 更新: ${data.updatedCount || 0}件）`);
        setTimeout(() => setSyncToastMessage(null), 4000);
        await fetchNoteData(selectedDate);
        await fetchMonthSummary(calendarYear, calendarMonth);
      } else if (!isSilent) {
        alert('同期エラー: ' + (data.error || '同期に失敗しました'));
      }
    } catch (err: any) {
      if (!isSilent) {
        alert('同期通信エラー: ' + err.message);
      }
    } finally {
      setIsSyncingCalendar(false);
    }
  }, [fetchNoteData, selectedDate, fetchMonthSummary, calendarYear, calendarMonth]);

  useEffect(() => {
    checkGoogleStatus();
  }, [checkGoogleStatus]);

  // OAuth連携リダイレクト（?gcal_connected=1）の検出＆自動初期同期
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('gcal_connected') === '1') {
        setGoogleConnected(true);
        setSyncToastMessage('Googleカレンダーと連携しました！初回同期を実行中...');
        handleSyncCalendar(true);
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      } else if (urlParams.get('gcal_error')) {
        const err = urlParams.get('gcal_error');
        alert('Googleカレンダー連携エラー: ' + err);
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, [handleSyncCalendar]);

  // 日付の切り替え（日本時間ローカル安全加算）
  const changeDate = (offsetDays: number) => {
    setSelectedDate((prev) => addDaysToDateString(prev, offsetDays));
  };

  // 日跨ぎ（0:00跨ぎ）および画面復帰時の「今日」自動追従
  useEffect(() => {
    let lastKnownToday = getTodayLocalDate();

    const checkDateRollOver = () => {
      const currentToday = getTodayLocalDate();
      if (currentToday !== lastKnownToday) {
        // 直前まで「今日」を見ていた場合は、自動で新しい「今日」に移動
        setSelectedDate((prev) => {
          if (prev === lastKnownToday) {
            return currentToday;
          }
          return prev;
        });
        lastKnownToday = currentToday;
      }
    };

    // 15秒ごとのタイマーチェック（日付跨ぎ検知）
    const interval = setInterval(checkDateRollOver, 15000);

    // スマホの画面復帰（タブフォーカス・スリープ解除）時の検知
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkDateRollOver();
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkDateRollOver);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkDateRollOver);
    };
  }, []);

  // カレンダーの月切り替え
  const changeCalendarMonth = (delta: number) => {
    let newMonth = calendarMonth + delta;
    let newYear = calendarYear;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    setCalendarYear(newYear);
    setCalendarMonth(newMonth);
  };

  // 2. メモの追加（生データ・非破壊）
  const handleAddMemo = async () => {
    if (!newMemoText.trim() || !noteData) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_raw_input',
          noteId: noteData.id,
          data: {
            inputType: 'text',
            content: newMemoText.trim(),
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setRawInputs((prev) => [...prev, json.item]);
        setNewMemoText('');
      }
    } catch (err) {
      console.error('Add memo error:', err);
    }
  };

  // 3. 実績の追加
  const handleAddActivity = async () => {
    if (!newActivityTitle.trim() || !noteData) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_activity',
          noteId: noteData.id,
          data: {
            title: newActivityTitle.trim(),
            startTime: new Date().toISOString(),
            locationName: currentLocation?.place_name || undefined,
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setActivityLogs((prev) => [...prev, json.item]);
        setNewActivityTitle('');
      }
    } catch (err) {
      console.error('Add activity error:', err);
    }
  };

  // 実績の編集開始（案B：ポップアップモーダル）
  const handleOpenEditActivity = (act: any) => {
    setEditingActivity(act);
    setEditActivityTitle(act.title || '');
    setEditActivityLocation(act.location_name || '');

    const targetTimeIso = act.start_time || act.created_at;
    if (targetTimeIso) {
      const d = new Date(targetTimeIso);
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      setEditActivityTime(`${h}:${m}`);
    } else {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      setEditActivityTime(`${h}:${m}`);
    }
  };

  // 実績の更新保存
  const handleSaveEditActivity = async () => {
    if (!editingActivity || !editActivityTitle.trim()) return;
    setIsSavingActivity(true);

    try {
      let startIso: string | null = null;
      if (editActivityTime && editActivityTime.includes(':')) {
        const [sy, sm, sd] = selectedDate.split('-').map((v) => parseInt(v, 10));
        const [sh, smin] = editActivityTime.split(':').map((v) => parseInt(v, 10));
        const localDate = new Date(sy, sm - 1, sd, sh, smin, 0, 0);
        startIso = localDate.toISOString();
      }

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_activity',
          noteId: editingActivity.note_id || noteData?.id,
          data: {
            id: editingActivity.id,
            title: editActivityTitle.trim(),
            startTime: startIso,
            locationName: editActivityLocation.trim() || null,
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setActivityLogs((prev) =>
          prev.map((act) => (act.id === json.item.id ? json.item : act))
        );
        setEditingActivity(null);
        await fetchNoteData(selectedDate);
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert('保存に失敗しました: ' + (errJson.error || res.statusText));
      }
    } catch (err: any) {
      console.error('Update activity error:', err);
      alert('保存処理中にエラーが発生しました: ' + (err.message || ''));
    } finally {
      setIsSavingActivity(false);
    }
  };

  // デイリーメモの編集開始
  const handleOpenEditRawInput = (input: any) => {
    setEditingRawInput(input);
    setEditRawInputContent(input.content || '');
  };

  // デイリーメモの更新保存
  const handleSaveEditRawInput = async () => {
    if (!editingRawInput || !editRawInputContent.trim()) return;
    setIsSavingRawInput(true);

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_raw_input',
          noteId: editingRawInput.note_id || noteData?.id,
          data: {
            id: editingRawInput.id,
            content: editRawInputContent.trim(),
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setRawInputs((prev) =>
          prev.map((item) => (item.id === json.item.id ? json.item : item))
        );
        setEditingRawInput(null);
        await fetchNoteData(selectedDate);
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert('メモの保存に失敗しました: ' + (errJson.error || res.statusText));
      }
    } catch (err: any) {
      console.error('Update raw input error:', err);
      alert('メモ保存処理中にエラーが発生しました: ' + (err.message || ''));
    } finally {
      setIsSavingRawInput(false);
    }
  };

  // 4. 予定の追加
  const handleAddSchedule = async () => {
    if (!newScheduleTitle.trim() || !noteData) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_schedule',
          noteId: noteData.id,
          data: {
            title: newScheduleTitle.trim(),
            startTime: new Date().toISOString(),
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setScheduleEvents((prev) => [...prev, json.item]);
        setNewScheduleTitle('');
        await fetchMonthSummary(calendarYear, calendarMonth);
      }
    } catch (err) {
      console.error('Add schedule error:', err);
    }
  };

  // Googleスタイル予定追加（直接指定）
  const handleAddScheduleDirect = async (
    data: {
      title: string;
      startTime: string;
      endTime?: string | null;
      color?: string;
      isAllDay?: boolean;
    },
    targetDate?: string
  ) => {
    const tDate = targetDate || selectedDate;
    let nId = noteData?.id;
    if (tDate !== selectedDate || !nId) {
      const resNote = await fetch(`/api/notes?date=${tDate}`);
      if (resNote.ok) {
        const d = await resNote.json();
        nId = d.note?.id;
      }
    }
    if (!nId) return;

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_schedule',
          noteId: nId,
          data: {
            title: data.title,
            startTime: data.startTime,
            endTime: data.endTime,
            color: data.color,
            isAllDay: data.isAllDay,
          },
        }),
      });
      if (res.ok) {
        await fetchNoteData(selectedDate);
        await fetchMonthSummary(calendarYear, calendarMonth);
      }
    } catch (err) {
      console.error('Add schedule error:', err);
    }
  };

  // Googleスタイル予定更新
  const handleUpdateScheduleDirect = async (data: {
    id: string;
    title: string;
    startTime: string;
    endTime?: string | null;
    color?: string;
    isAllDay?: boolean;
  }) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_schedule',
          noteId: noteData?.id,
          data,
        }),
      });
      if (res.ok) {
        await fetchNoteData(selectedDate);
        await fetchMonthSummary(calendarYear, calendarMonth);
      }
    } catch (err) {
      console.error('Update schedule error:', err);
    }
  };

  // 予定の完了・未完了トグル（レ点チェック）
  const handleToggleScheduleComplete = async (id: string, isCompleted: boolean) => {
    const target =
      scheduleEvents.find((s) => s.id === id) ||
      monthSummary.schedules.find((s) => s.id === id);
    if (!target) return;

    // 即座にUI反映（超高速レスポンス）
    setScheduleEvents((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, raw_payload: { ...(s.raw_payload || {}), isCompleted } }
          : s
      )
    );
    setMonthSummary((prev) => ({
      ...prev,
      schedules: prev.schedules.map((s) =>
        s.id === id
          ? { ...s, raw_payload: { ...(s.raw_payload || {}), isCompleted } }
          : s
      ),
    }));

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_schedule',
          noteId: noteData?.id,
          data: {
            id,
            title: target.title,
            startTime: target.start_time,
            endTime: target.end_time,
            color: target.raw_payload?.color,
            isAllDay: target.raw_payload?.isAllDay,
            isCompleted,
          },
        }),
      });
      if (res.ok) {
        await fetchNoteData(selectedDate);
        await fetchMonthSummary(calendarYear, calendarMonth);
      }
    } catch (err) {
      console.error('Toggle complete error:', err);
    }
  };

  // 5. 削除機能（予定・実績・生メモ）
  const handleDeleteSchedule = async (id: string) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_schedule', id }),
      });
      if (res.ok) {
        setScheduleEvents((prev) => prev.filter((ev) => ev.id !== id));
        await fetchMonthSummary(calendarYear, calendarMonth);
      }
    } catch (err) {
      console.error('Delete schedule error:', err);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_activity', id }),
      });
      if (res.ok) {
        setActivityLogs((prev) => prev.filter((act) => act.id !== id));
      }
    } catch (err) {
      console.error('Delete activity error:', err);
    }
  };

  const handleDeleteRawInput = async (id: string) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_raw_input', id }),
      });
      if (res.ok) {
        setRawInputs((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err) {
      console.error('Delete raw input error:', err);
    }
  };

  // 音声認識チャンクの重複・累積成長・部分重複を排除して綺麗に結合する関数
  const mergeTranscripts = (chunks: string[]): string => {
    let merged = '';
    for (const raw of chunks) {
      const text = (raw || '').trim();
      if (!text) continue;
      if (!merged) {
        merged = text;
        continue;
      }
      // 1. 完全一致または末尾が一致（重複排除）
      if (merged === text || merged.endsWith(text)) {
        continue;
      }
      // 2. 新しいテキストがこれまでのテキスト全体を含んでいる（累積成長）
      if (text.startsWith(merged)) {
        merged = text;
        continue;
      }
      // 3. これまでのテキストが新しいテキストを含んでいる
      if (merged.includes(text)) {
        continue;
      }
      // 4. 末尾と先頭の重なり（オーバーラップ）をマージ
      const maxOverlap = Math.min(merged.length, text.length);
      let matched = false;
      for (let len = maxOverlap; len >= 2; len--) {
        if (merged.slice(-len) === text.slice(0, len)) {
          merged = merged + text.slice(len);
          matched = true;
          break;
        }
      }
      // 5. 完全に独立した新しい文
      if (!matched) {
        merged = merged + ' ' + text;
      }
    }
    return merged;
  };

  // 6. 音声認識（Web Speech API）- 時間無制限＆ハウリング・重複完全排除
  const toggleVoiceRecognition = (target: VoiceTarget) => {
    // 既に同じ入力欄で認識中の場合、ユーザーがタップして停止
    if (activeVoiceTarget === target) {
      isVoiceActiveRef.current = false;
      activeVoiceTargetRef.current = null;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
      setActiveVoiceTarget(null);
      return;
    }

    // 別の入力欄が動いている場合は一度停止
    isVoiceActiveRef.current = false;
    activeVoiceTargetRef.current = null;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // ignore
      }
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('お使いのブラウザは音声入力に対応していません。（ChromeまたはSafari推奨）');
      return;
    }

    // 録音開始前のテキストを保持
    let currentVal = '';
    if (target === 'memo') currentVal = newMemoText;
    else if (target === 'schedule') currentVal = newScheduleTitle;
    else if (target === 'activity') currentVal = newActivityTitle;
    else if (target === 'search') currentVal = searchQuery;
    voiceInitialTextRef.current = (currentVal || '').trim();
    currentRecognizedTextRef.current = (currentVal || '').trim();

    isVoiceActiveRef.current = true;
    activeVoiceTargetRef.current = target;
    setActiveVoiceTarget(target);

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    // 連続認識を全端末で有効化（途中で勝手に切れるのを防止）
    recognition.continuous = true;
    // 重複や雪だるま式増殖を防ぐため、中間結果はOFF（確定文のみ取得）
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const chunks: string[] = [];
      for (let i = 0; i < event.results.length; ++i) {
        const t = event.results[i][0]?.transcript;
        if (t) chunks.push(t);
      }

      // 重複・累積を完全に排除したセッション認識テキスト
      const sessionTranscript = mergeTranscripts(chunks);
      if (!sessionTranscript) return;

      const prefix = voiceInitialTextRef.current ? voiceInitialTextRef.current + ' ' : '';
      const updated = (prefix + sessionTranscript).trim();
      currentRecognizedTextRef.current = updated;

      if (target === 'memo') setNewMemoText(updated);
      else if (target === 'schedule') setNewScheduleTitle(updated);
      else if (target === 'activity') setNewActivityTitle(updated);
      else if (target === 'search') setSearchQuery(updated);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        isVoiceActiveRef.current = false;
        activeVoiceTargetRef.current = null;
        setActiveVoiceTarget(null);
      }
    };

    recognition.onend = () => {
      // ユーザーが手動で停止ボタンを押していない場合（スマホの無音タイムアウト等）、自動継続
      if (isVoiceActiveRef.current && activeVoiceTargetRef.current === target) {
        // 次のセッションのために基準テキストを最新値に更新
        voiceInitialTextRef.current = currentRecognizedTextRef.current;
        try {
          recognition.start();
          return;
        } catch (e) {
          console.log('Recognition restart:', e);
        }
      }
      isVoiceActiveRef.current = false;
      activeVoiceTargetRef.current = null;
      setActiveVoiceTarget(null);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.error('Start recognition error:', err);
      isVoiceActiveRef.current = false;
      activeVoiceTargetRef.current = null;
      setActiveVoiceTarget(null);
    }
  };

  // 6. 写真アップロード (Supabase Storage)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !noteData) return;

    setIsUploadingPhoto(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('noteId', noteData.id);

    try {
      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const json = await res.json();
        setRawInputs((prev) => [...prev, json.rawInput]);
      } else {
        alert('写真のアップロードに失敗しました。');
      }
    } catch (err) {
      console.error('Photo upload error:', err);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // 7. AI要約の実行 (Gemini)
  const handleTriggerSummary = async () => {
    if (!noteData || rawInputs.length === 0) {
      alert('要約するメモがまだありません。');
      return;
    }

    setIsSummarizing(true);
    const textAll = rawInputs
      .filter((r) => r.input_type === 'text' || r.input_type === 'voice')
      .map((r) => r.content)
      .join('\n');

    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: noteData.id,
          textToSummarize: textAll,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setAiSummaries((prev) => [...prev, json.summary]);
      }
    } catch (err) {
      console.error('AI summarize error:', err);
    } finally {
      setIsSummarizing(false);
    }
  };

  // 8. 検索の実行
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // カレンダーの日付セル計算
  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const firstDayOfWeek = new Date(calendarYear, calendarMonth - 1, 1).getDay(); // 0=日, 1=月...
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* -- ヘッダー -- */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-3 shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              CN
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Chrono Nexus</h1>
              <p className="text-xs text-slate-500">自己管理手帳 & ライフログ</p>
            </div>
          </div>

          {/* GPS自動追跡インジケーター */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>GPS自動把握：稼働中</span>
            {lastSavedLocation && (
              <span className="text-[10px] text-emerald-600 hidden sm:inline">
                ({new Date(lastSavedLocation.recorded_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 記録)
              </span>
            )}
          </div>

          {/* Googleカレンダー連携 / 同期ボタン */}
          <div className="flex items-center gap-2">
            {googleConnected ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleSyncCalendar(false)}
                  disabled={isSyncingCalendar}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold transition shadow-xs active:scale-95 disabled:opacity-50"
                  title="Googleカレンダーと手帳の双方向同期を実行"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCalendar ? 'animate-spin text-indigo-600' : 'text-indigo-600'}`} />
                  <span className="hidden sm:inline">{isSyncingCalendar ? '同期中...' : 'Google同期'}</span>
                  <span className="sm:hidden">{isSyncingCalendar ? '同期中' : '同期'}</span>
                </button>
                <button
                  onClick={handleDisconnectGoogle}
                  className="px-2 py-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-[11px] font-medium transition"
                  title="Google連携を安全に解除"
                >
                  解除
                </button>
              </div>
            ) : (
              <a
                href="/api/auth/google"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-semibold transition shadow-xs active:scale-95"
                title="Googleカレンダーと連携して予定を双方向同期"
              >
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <span>Google連携</span>
              </a>
            )}
          </div>

          {/* タブナビゲーション */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setActiveTab('notebook')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'notebook'
                  ? 'bg-white shadow-xs text-indigo-600 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              今日の手帳
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'calendar'
                  ? 'bg-white shadow-xs text-indigo-600 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              月間カレンダー
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'search'
                  ? 'bg-white shadow-xs text-indigo-600 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全文検索
            </button>
          </div>
        </div>
      </header>

      {/* -- メインコンテンツ -- */}
      <main className={`max-w-6xl mx-auto w-full flex-1 ${activeTab === 'calendar' ? 'p-1 sm:p-6' : 'p-4 sm:p-6'}`}>
        {activeTab === 'notebook' && (
          <>
            {/* -- 日付バー -- */}
            <div className="flex items-center justify-between bg-white rounded-2xl p-4 border border-slate-200 shadow-xs mb-6">
              <button
                onClick={() => changeDate(-1)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition"
                title="前の日"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-base sm:text-lg font-bold text-slate-900 border-none bg-transparent cursor-pointer focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDate(getTodayLocalDate());
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-xs cursor-pointer active:scale-95 shrink-0 ${
                    selectedDate === getTodayLocalDate()
                      ? 'bg-slate-100 text-slate-400 border border-slate-200'
                      : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-sm ring-2 ring-indigo-200'
                  }`}
                  title="今日の日付に戻る"
                >
                  今日
                </button>
              </div>

              <button
                onClick={() => changeDate(1)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition"
                title="次の日"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* -- 予定 ↔ ノート 横フリック＆切替タブ -- */}
            <div className="flex items-center bg-slate-200/70 p-1.5 rounded-2xl mb-6 shadow-inner">
              <button
                type="button"
                onClick={() => setDailySubTab('timeline')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                  dailySubTab === 'timeline'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-4 h-4" /> 1日の予定（タイムライン）
              </button>
              <button
                type="button"
                onClick={() => setDailySubTab('notes')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                  dailySubTab === 'notes'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-4 h-4" /> デイリーノート（メモ・AI要約）
              </button>
            </div>

            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <p className="text-sm">手帳を開いています...</p>
              </div>
            ) : (
              <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="transition-all duration-200"
              >
                {/* 1. タイムライン画面（Googleカレンダー風） */}
                {dailySubTab === 'timeline' && (
                  <DailyTimelineView
                    date={selectedDate}
                    schedules={scheduleEvents}
                    locationTracks={locationTracks}
                    onAddSchedule={handleAddScheduleDirect}
                    onUpdateSchedule={handleUpdateScheduleDirect}
                    onDeleteSchedule={handleDeleteSchedule}
                    onToggleComplete={handleToggleScheduleComplete}
                  />
                )}

                {/* 2. デイリーノート画面（メモ・AI要約・実績・足跡） */}
                {dailySubTab === 'notes' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* 左列：実績 ＆ 足跡 */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* 実績行動ログブロック */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            <h2 className="font-bold text-slate-900">今日の実績（Activity Log）</h2>
                          </div>
                          <span className="text-xs text-slate-400">{activityLogs.length}件</span>
                        </div>

                        <div className="space-y-2 mb-4">
                          {activityLogs.length === 0 ? (
                            <p className="text-xs text-slate-400 py-4 text-center">まだ実績の記録はありません</p>
                          ) : (
                            activityLogs.map((act) => (
                              <div
                                key={act.id}
                                className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-start justify-between gap-2 group"
                              >
                                <div className="flex items-start gap-2 flex-1">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5"></span>
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{act.title}</p>
                                    <div className="flex items-center gap-2 text-[11px] text-emerald-700 mt-0.5">
                                      <span>
                                        {new Date(act.start_time || act.created_at).toLocaleTimeString('ja-JP', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                      {act.location_name && (
                                        <span className="flex items-center gap-0.5">
                                          <MapPin className="w-3 h-3" /> {act.location_name}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                                  <button
                                    onClick={() => handleOpenEditActivity(act)}
                                    className="p-1 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-100/60 transition"
                                    title="実績を編集"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteActivity(act.id)}
                                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                    title="実績を削除"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {/* 実績クイック追加 */}
                        <div className="space-y-2 mt-4 pt-3 border-t border-slate-100">
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              placeholder="今やったことをメモ...（例：駅前で買い物）"
                              value={newActivityTitle}
                              onChange={(e) => setNewActivityTitle(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                              className="w-full pl-4 pr-12 py-3 text-base bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 shadow-2xs"
                            />
                            <button
                              type="button"
                              onClick={() => toggleVoiceRecognition('activity')}
                              className={`absolute right-2 p-2 rounded-lg transition ${
                                activeVoiceTarget === 'activity'
                                  ? 'bg-rose-500 text-white animate-pulse'
                                  : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                              }`}
                              title="声で実績を入力"
                            >
                              {activeVoiceTarget === 'activity' ? (
                                <MicOff className="w-5 h-5" />
                              ) : (
                                <Mic className="w-5 h-5" />
                              )}
                            </button>
                          </div>
                          <button
                            onClick={handleAddActivity}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition shadow-xs"
                          >
                            <Plus className="w-4 h-4" /> 実績を記録する
                          </button>
                        </div>
                      </div>

                      {/* GPS足跡ログ */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-5 h-5 text-rose-500" />
                            <h2 className="font-bold text-slate-900">今日の足跡（GPS自動記録）</h2>
                          </div>
                          <span className="text-xs text-slate-400">{locationTracks.length}ポイント</span>
                        </div>

                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {locationTracks.length === 0 ? (
                            <p className="text-xs text-slate-400 py-3 text-center">
                              移動すると自動でここに足跡が記録されます
                            </p>
                          ) : (
                            locationTracks.map((loc, idx) => (
                              <div
                                key={loc.id || idx}
                                className="text-xs p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between"
                              >
                                <span className="text-slate-600 font-mono">
                                  {new Date(loc.recorded_at).toLocaleTimeString('ja-JP', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <span className="text-slate-500 text-[11px]">
                                  {loc.place_name || `緯度: ${loc.latitude.toFixed(4)}, 経度: ${loc.longitude.toFixed(4)}`}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 右列：デイリーノート本体（生入力 ＆ AI要約 ＆ 写真） */}
                    <div className="lg:col-span-7 space-y-6">
                      {/* メモ書き込み・入力ツールバー */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                        <h2 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                          <FileText className="w-5 h-5 text-indigo-600" />
                          デイリーメモ（非破壊・永久保存）
                        </h2>

                        <div className="relative mb-3">
                          <textarea
                            rows={4}
                            placeholder="今日のできごと、気づき、メモを声または手入力で自由に記録..."
                            value={newMemoText}
                            onChange={(e) => setNewMemoText(e.target.value)}
                            className="w-full p-4 pr-14 text-base bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 shadow-2xs leading-relaxed"
                          />
                          <button
                            type="button"
                            onClick={() => toggleVoiceRecognition('memo')}
                            className={`absolute right-3 top-3 p-2.5 rounded-xl transition ${
                              activeVoiceTarget === 'memo'
                                ? 'bg-rose-500 text-white animate-pulse'
                                : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                            title="声でメモを入力（何分でも話し続けられます）"
                          >
                            {activeVoiceTarget === 'memo' ? (
                              <MicOff className="w-6 h-6" />
                            ) : (
                              <Mic className="w-6 h-6" />
                            )}
                          </button>
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <label className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition">
                              <Camera className="w-4 h-4 text-slate-600" />
                              <span>{isUploadingPhoto ? 'アップロード中...' : '写真を添付'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handlePhotoUpload}
                                disabled={isUploadingPhoto}
                              />
                            </label>
                          </div>

                          <button
                            onClick={handleAddMemo}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                          >
                            <Send className="w-4 h-4" /> メモを記録する
                          </button>
                        </div>
                      </div>

                      {/* AI要約カード */}
                      <div className="bg-gradient-to-br from-indigo-50/70 via-purple-50/50 to-white rounded-2xl p-5 border border-indigo-100 shadow-xs">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-indigo-900">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            <h2 className="font-bold">Gemini AI による清書・要約</h2>
                          </div>
                          <button
                            onClick={handleTriggerSummary}
                            disabled={isSummarizing || rawInputs.length === 0}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
                          >
                            {isSummarizing ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                要約中...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                AIで要約する
                              </>
                            )}
                          </button>
                        </div>

                        {aiSummaries.length === 0 ? (
                          <p className="text-xs text-indigo-600/70 py-4 text-center">
                            右上の「AIで要約する」ボタンを押すと、今日のメモがここに美しく整理されます
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {aiSummaries.map((s) => (
                              <div
                                key={s.id}
                                className="p-4 bg-white/90 backdrop-blur rounded-xl border border-indigo-100/60 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed shadow-2xs"
                              >
                                {s.summary_content}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 生入力リスト */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                        <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                          <FolderTree className="w-5 h-5 text-slate-500" />
                          記録された生ログ（タイムライン）
                        </h2>

                        <div className="space-y-3">
                          {rawInputs.length === 0 ? (
                            <p className="text-xs text-slate-400 py-6 text-center">
                              今日のメモや写真がここに蓄積されます
                            </p>
                          ) : (
                            rawInputs.map((input) => (
                              <div
                                key={input.id}
                                className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition group relative"
                              >
                                <div className="flex items-center justify-between mb-1.5 text-[11px] text-slate-400">
                                  <span className="font-medium uppercase text-slate-500">
                                    {input.input_type === 'photo' ? '📸 写真' : '📝 メモ'}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <span>
                                      {new Date(input.recorded_at).toLocaleTimeString('ja-JP', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                    {input.input_type !== 'photo' && (
                                      <button
                                        onClick={() => handleOpenEditRawInput(input)}
                                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                        title="このメモを編集"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteRawInput(input.id)}
                                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                      title="このメモを削除"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {input.input_type === 'photo' ? (
                                  <div className="mt-2">
                                    <img
                                      src={input.content}
                                      alt="添付写真"
                                      className="rounded-lg max-h-64 object-cover border border-slate-200"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                                    {input.content}
                                  </p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 2. 月間カレンダータブ（Googleカレンダー風 複数日連結バー＆完全同期） */}
        {activeTab === 'calendar' && (
          <GoogleMonthCalendarView
            year={calendarYear}
            month={calendarMonth}
            schedules={monthSummary.schedules}
            notes={monthSummary.notes}
            selectedDate={selectedDate}
            onSelectDate={(dateStr) => {
              setSelectedDate(dateStr);
              setActiveTab('notebook');
            }}
            onChangeMonth={(delta) => changeCalendarMonth(delta)}
            onSetYearMonth={(y, m) => {
              setCalendarYear(y);
              setCalendarMonth(m);
            }}
            onSyncCalendar={() => handleSyncCalendar(false)}
            isSyncingCalendar={isSyncingCalendar}
            googleConnected={googleConnected}
          />
        )}

        {/* 3. 全文検索タブ（広々入力＆マイク内蔵） */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-5 h-5 text-indigo-600" />
              手帳の全文検索
            </h2>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="キーワードで過去の手帳を検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-4 pr-12 py-3.5 text-base bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:bg-white text-slate-900 placeholder:text-slate-400 shadow-2xs transition"
                />
                <button
                  type="button"
                  onClick={() => toggleVoiceRecognition('search')}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition ${
                    activeVoiceTarget === 'search'
                      ? 'bg-rose-500 text-white animate-pulse'
                      : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title="声で検索ワードを入力"
                >
                  {activeVoiceTarget === 'search' ? (
                    <MicOff className="w-5 h-5" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-base font-bold flex items-center justify-center gap-2 transition shadow-xs disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                検索する
              </button>
            </form>

            {searchResults && (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-700">検索結果</h3>
                {searchResults.rawInputs?.length === 0 && searchResults.summaries?.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4">一致する記録は見つかりませんでした</p>
                ) : (
                  <div className="space-y-2">
                    {searchResults.rawInputs?.map((item: any) => (
                      <div key={item.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-xs text-slate-400 mb-1">
                          {new Date(item.recorded_at).toLocaleDateString('ja-JP')}
                        </p>
                        <p className="text-sm text-slate-800">{item.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 案B：実績編集モーダル（ポップアップ） ── */}
        {editingActivity && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => !isSavingActivity && setEditingActivity(null)}
          >
            <div
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* モーダルヘッダー */}
              <div className="flex items-center justify-between px-5 py-4 bg-emerald-50 border-b border-emerald-100">
                <div className="flex items-center gap-2 text-emerald-800 font-bold">
                  <Edit2 className="w-4 h-4 text-emerald-600" />
                  <span>今日の実績を編集</span>
                </div>
                <button
                  onClick={() => !isSavingActivity && setEditingActivity(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-emerald-100/50 transition"
                  title="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* フォーム本体 */}
              <div className="p-5 space-y-4">
                {/* 実績内容 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    実績内容 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editActivityTitle}
                    onChange={(e) => setEditActivityTitle(e.target.value)}
                    placeholder="例：福井邸 ガレージ打ち合わせ完了"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEditActivity()}
                  />
                </div>

                {/* 記録時刻 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    記録時刻
                  </label>
                  <input
                    type="time"
                    value={editActivityTime}
                    onChange={(e) => setEditActivityTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs"
                  />
                </div>

                {/* 場所名 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    場所名（任意）
                  </label>
                  <input
                    type="text"
                    value={editActivityLocation}
                    onChange={(e) => setEditActivityLocation(e.target.value)}
                    placeholder="例：福井邸、駅前コメリ"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEditActivity()}
                  />
                </div>
              </div>

              {/* フッターボタン */}
              <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingActivity(null)}
                  disabled={isSavingActivity}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/70 rounded-xl transition disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditActivity}
                  disabled={isSavingActivity || !editActivityTitle.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-xs disabled:opacity-50"
                >
                  {isSavingActivity ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      保存する
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── デイリーメモ編集モーダル（ポップアップ） ── */}
        {editingRawInput && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => !isSavingRawInput && setEditingRawInput(null)}
          >
            <div
              className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* モーダルヘッダー */}
              <div className="flex items-center justify-between px-5 py-4 bg-indigo-50/80 border-b border-indigo-100">
                <div className="flex items-center gap-2 text-indigo-900 font-bold">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>デイリーメモを編集</span>
                </div>
                <button
                  onClick={() => !isSavingRawInput && setEditingRawInput(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-indigo-100/50 transition"
                  title="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* フォーム本体 */}
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    メモ内容 <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={6}
                    value={editRawInputContent}
                    onChange={(e) => setEditRawInputContent(e.target.value)}
                    placeholder="メモ内容を入力..."
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-normal text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition leading-relaxed shadow-2xs resize-none"
                    autoFocus
                  />
                </div>
              </div>

              {/* フッターボタン */}
              <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingRawInput(null)}
                  disabled={isSavingRawInput}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/70 rounded-xl transition disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditRawInput}
                  disabled={isSavingRawInput || !editRawInputContent.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-xs disabled:opacity-50"
                >
                  {isSavingRawInput ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      保存する
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Googleカレンダー同期完了トースト通知 */}
        {syncToastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs sm:text-sm px-4 py-3 rounded-2xl shadow-xl border border-slate-700 flex items-center gap-2 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{syncToastMessage}</span>
          </div>
        )}
      </main>
    </div>
  );
}
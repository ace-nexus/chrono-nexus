'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import TaskManagementView from '@/components/tasks/TaskManagementView';
import UnifiedAiInputModal from '@/components/ai/UnifiedAiInputModal';
import GpsActivityModal from '@/components/location/GpsActivityModal';
import { useContinuousSpeechRecognition } from '@/lib/useContinuousSpeechRecognition';
import { CheckSquare, Square, ArrowRight, Settings } from 'lucide-react';

type ActiveTab = 'notebook' | 'calendar' | 'tasks' | 'search';
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

  // 実績新規作成時の指定時刻（デフォルト: 現在時刻）
  const [newActivityTime, setNewActivityTime] = useState<string>(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });

  // デイリーメモ編集用状態
  const [editingRawInput, setEditingRawInput] = useState<any | null>(null);
  const [editRawInputContent, setEditRawInputContent] = useState<string>('');
  const [editRawInputTime, setEditRawInputTime] = useState<string>('12:00');
  const [isSavingRawInput, setIsSavingRawInput] = useState<boolean>(false);

  // AI補正状態
  const [isAiFormattingMemo, setIsAiFormattingMemo] = useState<boolean>(false);
  const [isAiFormattingActivity, setIsAiFormattingActivity] = useState<boolean>(false);
  const [isAiFormattingEditActivity, setIsAiFormattingEditActivity] = useState<boolean>(false);
  const [isAiFormattingEditMemo, setIsAiFormattingEditMemo] = useState<boolean>(false);

  // 音声認識フック（重複排除＆文字ハウリング完全防止）
  const memoVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setNewMemoText(text),
  });
  const activityVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setNewActivityTitle(text),
  });
  const searchVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setSearchQuery(text),
  });

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

  // 実績・足跡・デイリーノート用モーダル状態（要求②＆③：ボタンで開く）
  const [showDailyRecordModal, setShowDailyRecordModal] = useState<boolean>(false);
  const [showUnifiedAiModal, setShowUnifiedAiModal] = useState<boolean>(false);
  const [showGpsModal, setShowGpsModal] = useState<boolean>(false);
  const [todayTasks, setTodayTasks] = useState<any[]>([]);

  // 日付の切り替え（日本時間ローカル安全加算 ＆ URL連動）
  const changeDate = useCallback((offsetDays: number) => {
    setSelectedDate((prev) => {
      const nextDate = addDaysToDateString(prev, offsetDays);
      if (typeof window !== 'undefined') {
        window.history.replaceState({ tab: 'notebook', date: nextDate }, '', `?tab=notebook&date=${nextDate}`);
      }
      return nextDate;
    });
  }, []);

  // 横フリックで1日カレンダーの日付を前日・翌日に移動（要求②）
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
        changeDate(1); // 左へスワイプ -> 翌日へ移動！
      } else {
        changeDate(-1); // 右へスワイプ -> 前日へ移動！
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // 画面遷移管理（Androidスマートフォンの「戻るボタン（＜）」完全連動）
  const navigateTo = useCallback((nextTab: ActiveTab, nextDate?: string) => {
    const targetDate = nextDate || selectedDate;

    // 現在と同じ画面・日付なら履歴を追加しない
    if (activeTab === nextTab && (!nextDate || selectedDate === nextDate)) {
      return;
    }

    if (typeof window !== 'undefined') {
      const stateObj = { tab: nextTab, date: targetDate };
      const urlQuery = nextTab === 'notebook'
        ? `?tab=${nextTab}&date=${targetDate}`
        : `?tab=${nextTab}`;
      window.history.pushState(stateObj, '', urlQuery);
    }

    if (nextDate) {
      setSelectedDate(nextDate);
      const [y, m] = nextDate.split('-').map((v) => parseInt(v, 10));
      if (y && m) {
        setCalendarYear(y);
        setCalendarMonth(m);
      }
    }
    setActiveTab(nextTab);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTab, selectedDate]);

  // Android「戻る」ボタン（popstateイベント）監視
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 初回ロード時のURLパラメータ反映
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') as ActiveTab | null;
    const initialDate = params.get('date');

    let curTab = activeTab;
    let curDate = selectedDate;

    if (initialTab && ['notebook', 'calendar', 'tasks', 'search'].includes(initialTab)) {
      curTab = initialTab;
      setActiveTab(initialTab);
    }
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      curDate = initialDate;
      setSelectedDate(initialDate);
    }

    // 初回ステートをreplaceState & pushStateで初期化（戻り先の基点・脱出防止バッファ）
    window.history.replaceState({ tab: curTab, date: curDate }, '');
    window.history.pushState({ tab: curTab, date: curDate }, '');

    const handlePopState = (event: PopStateEvent) => {
      // 1. モーダルが開いていればまず閉じる（画面遷移しない）
      if (showGpsModal) {
        setShowGpsModal(false);
        return;
      }
      if (showUnifiedAiModal) {
        setShowUnifiedAiModal(false);
        return;
      }
      if (showDailyRecordModal) {
        setShowDailyRecordModal(false);
        return;
      }
      if (editingActivity) {
        setEditingActivity(null);
        return;
      }
      if (editingRawInput) {
        setEditingRawInput(null);
        return;
      }

      const today = getTodayLocalDate();

      // 2. 履歴ステートがあれば復元
      if (event.state && event.state.tab) {
        setActiveTab(event.state.tab);
        if (event.state.date) {
          setSelectedDate(event.state.date);
        }
      } else {
        // 履歴終端なら今日の一日手帳へ戻す
        setActiveTab('notebook');
        setSelectedDate(today);
      }

      // 3. アプリ外脱出ガード:
      // 何度Androidの「戻る(<)」を押しても外部ブラウザに脱出せず今日の手帳に留まるようガード
      setTimeout(() => {
        window.history.pushState({ tab: 'notebook', date: today }, '', `?tab=notebook&date=${today}`);
      }, 50);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [editingActivity, editingRawInput, showDailyRecordModal]);

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

  // 今日の重要タスク取得（代替案②用）
  const fetchTodayTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?view=all');
      if (res.ok) {
        const d = await res.json();
        setTodayTasks(d.tasks || []);
      }
    } catch (_) {}
  }, []);

  const handleToggleFocusTask = async (task: any) => {
    const nextCompleted = !task.isCompleted;
    setTodayTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, isCompleted: nextCompleted } : t))
    );
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, isCompleted: nextCompleted }),
      });
      fetchTodayTasks();
    } catch (_) {}
  };

  const focusTasks = useMemo(() => {
    return todayTasks.filter((t) => {
      if (t.archived) return false;
      const isDueToday = t.dueDate && t.dueDate <= selectedDate;
      const isHighPriority = t.priority === 'S' || t.priority === 'A';
      const isUndatedActive = !t.dueDate || t.isNoDate;
      return isDueToday || isHighPriority || (isUndatedActive && !t.isCompleted);
    });
  }, [todayTasks, selectedDate]);

  // 実績の完全時系列ソート（過去時刻入力・時間修正時も自動で差し込み整列）
  const sortedActivityLogs = useMemo(() => {
    return [...activityLogs].sort((a, b) => {
      const timeA = a.start_time || a.created_at || '';
      const timeB = b.start_time || b.created_at || '';
      return timeA.localeCompare(timeB);
    });
  }, [activityLogs]);

  // デイリーメモ・写真ログの完全時系列ソート
  const sortedRawInputs = useMemo(() => {
    return [...rawInputs].sort((a, b) => {
      const timeA = a.recorded_at || a.created_at || '';
      const timeB = b.recorded_at || b.created_at || '';
      return timeA.localeCompare(timeB);
    });
  }, [rawInputs]);

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
    fetchTodayTasks();
  }, [selectedDate, fetchNoteData, fetchTodayTasks]);

  // タブ切り替え時にタスクを常に最新同期（消失バグ防止）
  useEffect(() => {
    if (activeTab === 'notebook' || activeTab === 'tasks') {
      fetchTodayTasks();
    }
  }, [activeTab, fetchTodayTasks]);

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

  const isSyncingRef = useRef<boolean>(false);
  const lastSyncTimeRef = useRef<number>(0);
  const hasInitSyncedRef = useRef<boolean>(false);

  // Googleカレンダー双方向同期実行（完全排他制御）
  const handleSyncCalendar = useCallback(async (isSilent = false) => {
    if (isSyncingRef.current) {
      console.log('[CalendarSync] 既に同期処理が実行中のためスキップします');
      return;
    }
    isSyncingRef.current = true;
    setIsSyncingCalendar(true);
    lastSyncTimeRef.current = Date.now();
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setGoogleConnected(true);
        if (!isSilent) {
          setSyncToastMessage(`Googleカレンダー同期完了（新規取込: ${data.pulledCount}件, 更新: ${data.updatedCount || 0}件）`);
          setTimeout(() => setSyncToastMessage(null), 4000);
        }
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
      isSyncingRef.current = false;
    }
  }, [fetchNoteData, selectedDate, fetchMonthSummary, calendarYear, calendarMonth]);

  // Google連携ステータス確認＆初回自動同期（マウント時1回のみ実行、再レンダリングループ完全防止）
  useEffect(() => {
    if (hasInitSyncedRef.current) return;
    hasInitSyncedRef.current = true;

    const initSync = async () => {
      try {
        const res = await fetch('/api/calendar/sync');
        if (res.ok) {
          const data = await res.json();
          const isConn = !!data.connected;
          setGoogleConnected(isConn);
          if (isConn) {
            handleSyncCalendar(true);
          }
        }
      } catch (err) {
        console.error('Init Google sync error:', err);
      }
    };
    initSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画面復帰時（タブ復帰・スマホ画面復帰）の自動同期（5分間隔で安全に制御）
  useEffect(() => {
    const handleFocusSync = () => {
      if (document.visibilityState === 'visible' && !isSyncingRef.current) {
        const now = Date.now();
        if (now - lastSyncTimeRef.current > 5 * 60 * 1000) {
          handleSyncCalendar(true);
        }
      }
    };

    window.addEventListener('focus', handleFocusSync);
    document.addEventListener('visibilitychange', handleFocusSync);
    return () => {
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleFocusSync);
    };
  }, [handleSyncCalendar]);

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
            recordedAt: new Date().toISOString(),
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setRawInputs((prev) => [...prev, json.item]);
        setNewMemoText('');
        memoVoice.reset();
      }
    } catch (err) {
      console.error('Add memo error:', err);
    }
  };

  // 3. 実績の追加（時刻指定対応：過去時刻でも時系列に自動差し込み）
  const handleAddActivity = async () => {
    if (!newActivityTitle.trim() || !noteData) return;
    try {
      let startIso: string = new Date().toISOString();
      if (newActivityTime && newActivityTime.includes(':')) {
        const [sy, sm, sd] = selectedDate.split('-').map((v) => parseInt(v, 10));
        const [sh, smin] = newActivityTime.split(':').map((v) => parseInt(v, 10));
        const localDate = new Date(sy, sm - 1, sd, sh, smin, 0, 0);
        startIso = localDate.toISOString();
      }

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_activity',
          noteId: noteData.id,
          data: {
            title: newActivityTitle.trim(),
            startTime: startIso,
            locationName: currentLocation?.place_name || undefined,
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setActivityLogs((prev) => [...prev, json.item]);
        setNewActivityTitle('');
        activityVoice.reset();
        const now = new Date();
        setNewActivityTime(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
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

  // 実績の更新保存（時系列自動整列）
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

    const targetTimeIso = input.recorded_at || input.created_at;
    if (targetTimeIso) {
      const d = new Date(targetTimeIso);
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      setEditRawInputTime(`${h}:${m}`);
    } else {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      setEditRawInputTime(`${h}:${m}`);
    }
  };

  // デイリーメモの更新保存（時刻変更・時系列自動整列対応）
  const handleSaveEditRawInput = async () => {
    if (!editingRawInput || !editRawInputContent.trim()) return;
    setIsSavingRawInput(true);

    try {
      let recordedIso: string | null = null;
      if (editRawInputTime && editRawInputTime.includes(':')) {
        const [sy, sm, sd] = selectedDate.split('-').map((v) => parseInt(v, 10));
        const [sh, smin] = editRawInputTime.split(':').map((v) => parseInt(v, 10));
        const localDate = new Date(sy, sm - 1, sd, sh, smin, 0, 0);
        recordedIso = localDate.toISOString();
      }

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_raw_input',
          noteId: editingRawInput.note_id || noteData?.id,
          data: {
            id: editingRawInput.id,
            content: editRawInputContent.trim(),
            recordedAt: recordedIso,
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

  // ── AI補正（清書・リファイン）ハンドラー群 ──
  // デイリーメモ新規入力のAI補正
  const handleFormatNewMemoWithAi = async () => {
    if (!newMemoText.trim() || isAiFormattingMemo) return;
    setIsAiFormattingMemo(true);
    try {
      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newMemoText.trim(),
          mode: 'memo',
          currentDate: selectedDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.formattedText) {
          setNewMemoText(data.formattedText);
          memoVoice.reset();
        }
      }
    } catch (err) {
      console.error('Format memo error:', err);
    } finally {
      setIsAiFormattingMemo(false);
    }
  };

  // 実績新規入力のAI補正
  const handleFormatNewActivityWithAi = async () => {
    if (!newActivityTitle.trim() || isAiFormattingActivity) return;
    setIsAiFormattingActivity(true);
    try {
      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newActivityTitle.trim(),
          mode: 'activity',
          currentDate: selectedDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.formattedText) {
          setNewActivityTitle(data.formattedText);
          activityVoice.reset();
        }
      }
    } catch (err) {
      console.error('Format activity error:', err);
    } finally {
      setIsAiFormattingActivity(false);
    }
  };

  // 実績編集のAI補正
  const handleFormatEditActivityWithAi = async () => {
    if (!editActivityTitle.trim() || isAiFormattingEditActivity) return;
    setIsAiFormattingEditActivity(true);
    try {
      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editActivityTitle.trim(),
          mode: 'activity',
          currentDate: selectedDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.formattedText) {
          setEditActivityTitle(data.formattedText);
        }
      }
    } catch (err) {
      console.error('Format edit activity error:', err);
    } finally {
      setIsAiFormattingEditActivity(false);
    }
  };

  // デイリーメモ編集のAI補正
  const handleFormatEditRawInputWithAi = async () => {
    if (!editRawInputContent.trim() || isAiFormattingEditMemo) return;
    setIsAiFormattingEditMemo(true);
    try {
      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editRawInputContent.trim(),
          mode: 'memo',
          currentDate: selectedDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.formattedText) {
          setEditRawInputContent(data.formattedText);
        }
      }
    } catch (err) {
      console.error('Format edit raw input error:', err);
    } finally {
      setIsAiFormattingEditMemo(false);
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
    if (!confirm('この実績ログを削除してもよろしいですか？')) return;
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
    if (!confirm('このメモ・記録を削除してもよろしいですか？')) return;
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

  // 6. 予定ごとのメモ更新・保存・削除機能
  const handleUpdateScheduleMemo = async (scheduleId: string, memo: string) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_schedule_memo',
          id: scheduleId,
          data: { id: scheduleId, memo },
        }),
      });
      if (res.ok) {
        const result = await res.json();
        // タイムライン用スケジュールを更新
        setScheduleEvents((prev) =>
          prev.map((sc) =>
            sc.id === scheduleId
              ? {
                  ...sc,
                  description: result.item?.description,
                  raw_payload: {
                    ...(sc.raw_payload || {}),
                    ...(result.item?.raw_payload || {}),
                  },
                }
              : sc
          )
        );
        // カレンダー月間サマリーの予定も更新
        setMonthSummary((prev) => ({
          ...prev,
          schedules: prev.schedules.map((sc) =>
            sc.id === scheduleId
              ? {
                  ...sc,
                  raw_payload: {
                    ...(sc.raw_payload || {}),
                    ...(result.item?.raw_payload || {}),
                  },
                }
              : sc
          ),
        }));
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'メモの保存に失敗しました');
      }
    } catch (err) {
      console.error('Update schedule memo error:', err);
      throw err;
    }
  };

  const handleDeleteScheduleMemo = async (scheduleId: string) => {
    await handleUpdateScheduleMemo(scheduleId, '');
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
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-3 sm:px-6 py-2.5 shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={() => navigateTo('notebook', getTodayLocalDate())}>
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-700 text-white flex items-center justify-center font-black text-base sm:text-lg shadow-xs">
              CN
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Chrono Nexus</h1>
              <p className="text-[10px] sm:text-xs text-slate-500 hidden sm:block">自己管理手帳 & ライフログ</p>
            </div>
          </div>

          {/* ヘッダー右側：検索 ＆ GPS・設定ボタン（押し間違い防止＆スッキリ化） */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('search')}
              className={`p-2 rounded-xl transition flex items-center gap-1 text-xs font-bold ${
                activeTab === 'search'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="全文検索"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">検索</span>
            </button>

            <button
              onClick={() => setShowGpsModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold transition border border-slate-200"
              title="GPS活動ログ・現場日報・Google同期設定"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">GPS日報・設定</span>
              <span className="sm:hidden">GPS設定</span>
            </button>
          </div>
        </div>
      </header>

      {/* -- メインコンテンツ -- */}
      <main className={`max-w-6xl mx-auto w-full flex-1 pb-28 sm:pb-32 ${activeTab === 'calendar' ? 'p-1 sm:p-6' : 'p-4 sm:p-6'}`}>
        {activeTab === 'notebook' && (
          <>
            {/* -- 日付バー ＆ 実績・記録ボタン（要求②＆③） -- */}
            <div className="flex items-center justify-between bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-xs mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                <button
                  onClick={() => changeDate(-1)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition cursor-pointer"
                  title="前の日"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-xl border border-slate-200">
                  <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      setSelectedDate(nextDate);
                      if (typeof window !== 'undefined') {
                        window.history.replaceState({ tab: 'notebook', date: nextDate }, '', `?tab=notebook&date=${nextDate}`);
                      }
                    }}
                    className="text-sm sm:text-base font-bold text-slate-900 border-none bg-transparent cursor-pointer focus:outline-none"
                  />
                </div>

                <button
                  onClick={() => changeDate(1)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition cursor-pointer"
                  title="次の日"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const todayStr = getTodayLocalDate();
                    setSelectedDate(todayStr);
                    if (typeof window !== 'undefined') {
                      window.history.replaceState({ tab: 'notebook', date: todayStr }, '', `?tab=notebook&date=${todayStr}`);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer active:scale-95 shrink-0 ${
                    selectedDate === getTodayLocalDate()
                      ? 'bg-slate-100 text-slate-400 border border-slate-200'
                      : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-sm ring-2 ring-indigo-200'
                  }`}
                  title="今日の日付に戻る"
                >
                  今日
                </button>
              </div>

              {/* 要求②＆③：今日の実績・足跡記録ポップアップボタン */}
              <button
                type="button"
                onClick={() => setShowDailyRecordModal(true)}
                className={`px-3.5 py-2 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition shadow-xs cursor-pointer active:scale-95 ${
                  selectedDate === getTodayLocalDate()
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-emerald-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                }`}
              >
                {selectedDate === getTodayLocalDate() ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                    <span>今日の実績・メモ</span>
                    {(activityLogs.length > 0 || rawInputs.length > 0) && (
                      <span className="bg-emerald-800 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black">
                        {activityLogs.length + rawInputs.length}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 text-rose-500" />
                    <span>この日の足跡・記録</span>
                    {(locationTracks.length > 0 || rawInputs.length > 0) && (
                      <span className="bg-slate-300 text-slate-800 text-[10px] px-1.5 py-0.5 rounded-full font-black">
                        {locationTracks.length + rawInputs.length}
                      </span>
                    )}
                  </>
                )}
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
                {/* メイン：常に1日の予定タイムラインを広々と表示（左右スワイプで前日・翌日移動） */}
                <DailyTimelineView
                  date={selectedDate}
                  schedules={scheduleEvents}
                  locationTracks={locationTracks}
                  onAddSchedule={handleAddScheduleDirect}
                  onUpdateSchedule={handleUpdateScheduleDirect}
                  onDeleteSchedule={handleDeleteSchedule}
                  onToggleComplete={handleToggleScheduleComplete}
                  onUpdateScheduleMemo={handleUpdateScheduleMemo}
                  onDeleteScheduleMemo={handleDeleteScheduleMemo}
                />
              </div>
            )}

            {/* ── 「今日の実績・メモ」or「この日の足跡・記録」モーダル（要求②＆③：ボタンで開く） ── */}
            {showDailyRecordModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
                onClick={() => setShowDailyRecordModal(false)}
              >
                <div
                  className="bg-slate-50 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* モーダルヘッダー */}
                  <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
                    <div className="flex items-center gap-2.5">
                      {selectedDate === getTodayLocalDate() ? (
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-xs">
                          <MapPin className="w-5 h-5 text-rose-500" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-black text-slate-900 text-base sm:text-lg">
                          {selectedDate === getTodayLocalDate()
                            ? '今日の実績 ＆ メモ・足跡'
                            : `${selectedDate} の足跡 ＆ 記録ログ`}
                        </h3>
                        <p className="text-xs text-slate-400">
                          {selectedDate === getTodayLocalDate()
                            ? '今日の行動と気づきをリアルタイムに記録'
                            : '過去のGPS移動履歴・写真・メモログ'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowDailyRecordModal(false)}
                      className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* モーダル本文（スクロール可能） */}
                  <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* 左列：実績 ＆ 足跡 */}
                      <div className="lg:col-span-5 space-y-6">
                        {/* 実績行動ログブロック（過去の日付でも記録があれば表示） */}
                        {(selectedDate === getTodayLocalDate() || sortedActivityLogs.length > 0) && (
                          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                <h2 className="font-bold text-slate-900">
                                  {selectedDate === getTodayLocalDate() ? '今日の実績（Activity Log）' : '記録された実績'}
                                </h2>
                              </div>
                              <span className="text-xs text-slate-400">{sortedActivityLogs.length}件</span>
                            </div>

                            <div className="space-y-2 mb-4">
                              {sortedActivityLogs.length === 0 ? (
                                <p className="text-xs text-slate-400 py-4 text-center">実績の記録はありません</p>
                              ) : (
                                sortedActivityLogs.map((act) => (
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
                                        className="p-1 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-100/60 transition cursor-pointer"
                                        title="実績を編集"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteActivity(act.id)}
                                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                        title="実績を削除"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            {/* 今日のみ：実績クイック追加（時刻指定・AI補正対応） */}
                            {selectedDate === getTodayLocalDate() && (
                              <div className="space-y-2 mt-4 pt-3 border-t border-slate-100">
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 shrink-0">
                                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                                    <input
                                      type="time"
                                      value={newActivityTime}
                                      onChange={(e) => setNewActivityTime(e.target.value)}
                                      className="text-xs font-bold text-slate-700 bg-transparent focus:outline-none w-18 cursor-pointer"
                                      title="記録時刻（過去時刻を指定するとその時間位置に自動整列します）"
                                    />
                                  </div>
                                  <div className="relative flex-1 flex items-center">
                                    <input
                                      type="text"
                                      placeholder="今やったことをメモ...（例：駅前で買い物）"
                                      value={newActivityTitle}
                                      onChange={(e) => setNewActivityTitle(e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                                      className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 shadow-2xs"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => activityVoice.toggle(newActivityTitle)}
                                      className={`absolute right-1.5 p-1.5 rounded-lg transition cursor-pointer ${
                                        activityVoice.isListening
                                          ? 'bg-rose-500 text-white animate-pulse'
                                          : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                                      }`}
                                      title="声で実績を入力"
                                    >
                                      {activityVoice.isListening ? (
                                        <MicOff className="w-4 h-4" />
                                      ) : (
                                        <Mic className="w-4 h-4" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={handleFormatNewActivityWithAi}
                                    disabled={isAiFormattingActivity || !newActivityTitle.trim()}
                                    className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1 transition disabled:opacity-50 shrink-0 cursor-pointer"
                                    title="AIで実績タイトルを簡潔明瞭に清書"
                                  >
                                    {isAiFormattingActivity ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                    )}
                                    <span>✨ AI補正</span>
                                  </button>
                                  <button
                                    onClick={handleAddActivity}
                                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                                  >
                                    <Plus className="w-4 h-4" /> 実績を記録する
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* GPS足跡ログ（要求③：今日以外でも必要不可欠な項目） */}
                        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-5 h-5 text-rose-500" />
                              <h2 className="font-bold text-slate-900">
                                {selectedDate === getTodayLocalDate() ? '今日の足跡（GPS自動記録）' : 'この日の足跡（GPS記録）'}
                              </h2>
                            </div>
                            <span className="text-xs text-slate-400">{locationTracks.length}ポイント</span>
                          </div>

                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {locationTracks.length === 0 ? (
                              <p className="text-xs text-slate-400 py-3 text-center">
                                足跡の記録はありません
                              </p>
                            ) : (
                              locationTracks.map((loc, idx) => (
                                <div
                                  key={loc.id || idx}
                                  className="text-xs p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 hover:bg-slate-100/70 transition"
                                >
                                  <span className="text-slate-600 font-mono shrink-0 font-medium">
                                    {new Date(loc.recorded_at).toLocaleTimeString('ja-JP', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                  <span className="text-slate-700 text-[11px] font-semibold truncate text-right">
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
                        {/* 今日のみ：メモ書き込みフォーム（要求③：今日以外は非表示） */}
                        {selectedDate === getTodayLocalDate() && (
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
                              <div className="absolute right-3 top-3 flex items-center gap-1.5">
                                {(newMemoText.trim() || memoVoice.isListening) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      memoVoice.clear();
                                      setNewMemoText('');
                                    }}
                                    className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                    title="メモを一括消去してやり直す"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => memoVoice.toggle(newMemoText)}
                                  className={`p-2.5 rounded-xl transition cursor-pointer ${
                                    memoVoice.isListening
                                      ? 'bg-rose-500 text-white animate-pulse'
                                      : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                                  }`}
                                  title="声でメモを入力（何分でも話し続けられます）"
                                >
                                  {memoVoice.isListening ? (
                                    <MicOff className="w-6 h-6" />
                                  ) : (
                                    <Mic className="w-6 h-6" />
                                  )}
                                </button>
                              </div>
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
                                <button
                                  type="button"
                                  onClick={handleFormatNewMemoWithAi}
                                  disabled={isAiFormattingMemo || !newMemoText.trim()}
                                  className="px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                                  title="AIでメモを読みやすく清書・整理"
                                >
                                  {isAiFormattingMemo ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-4 h-4 text-purple-600" />
                                  )}
                                  <span>✨ AI補正</span>
                                </button>
                              </div>

                              <button
                                onClick={handleAddMemo}
                                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                              >
                                <Send className="w-4 h-4" /> メモを記録する
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── 本日の重要タスク＆現場持ち物（Today's Focus）代替案② ── */}
                        <div className="bg-gradient-to-br from-amber-50/70 via-orange-50/30 to-white rounded-2xl p-4 sm:p-5 border border-amber-200/80 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm shadow-xs font-bold">
                                🎯
                              </span>
                              <div>
                                <h2 className="font-bold text-sm sm:text-base text-slate-900 leading-tight">
                                  本日の重要タスク ＆ 現場持ち物
                                </h2>
                                <p className="text-[11px] text-slate-500">
                                  本日締切・重要タスク・未完了タスク（その場で完了チェック可能）
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => navigateTo('tasks')}
                                className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>タスク追加</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => navigateTo('tasks')}
                                className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <span>全タスク</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {focusTasks.length === 0 ? (
                            <p className="text-xs text-slate-400 py-3.5 text-center bg-white/70 rounded-xl border border-dashed border-amber-200">
                              本日締切または未完了のタスクはありません
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {focusTasks.map((t) => (
                                <div
                                  key={t.id}
                                  className="p-3 bg-white rounded-xl border border-amber-100 shadow-2xs flex items-center justify-between gap-3 hover:border-amber-300 transition"
                                >
                                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleFocusTask(t)}
                                      className="text-slate-400 hover:text-emerald-600 transition shrink-0 cursor-pointer"
                                      title={t.isCompleted ? '未完了に戻す' : '完了にする'}
                                    >
                                      {t.isCompleted ? (
                                        <CheckSquare className="w-5 h-5 text-emerald-600" />
                                      ) : (
                                        <Square className="w-5 h-5" />
                                      )}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {t.priority === 'S' && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-rose-600 text-white shadow-2xs">
                                            重要度 S
                                          </span>
                                        )}
                                        {t.priority === 'A' && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-orange-500 text-white shadow-2xs">
                                            重要度 A
                                          </span>
                                        )}
                                        {t.priority === 'B' && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500 text-white shadow-2xs">
                                            重要度 B
                                          </span>
                                        )}
                                        {t.priority === 'C' && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-200 text-slate-700">
                                            重要度 C
                                          </span>
                                        )}
                                        <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                          {t.genre}
                                        </span>
                                        {t.locationName && (
                                          <span className="flex items-center gap-0.5 text-[10px] text-amber-700 font-medium">
                                            <MapPin className="w-3 h-3 text-amber-500" />
                                            {t.locationName}
                                          </span>
                                        )}
                                        {t.dueDate && (
                                          <span className="text-[10px] text-slate-400">
                                            締切: {t.dueDate}{t.dueTime ? ` ${t.dueTime}` : ' (終日)'}
                                          </span>
                                        )}
                                      </div>
                                      <p
                                        className={`text-xs sm:text-sm font-bold mt-0.5 truncate ${
                                          t.isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                                        }`}
                                      >
                                        {t.title}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 記録された生ログ（タイムライン） */}
                        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                          <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <FolderTree className="w-5 h-5 text-slate-500" />
                            記録されたメモ・写真ログ
                          </h2>

                          <div className="space-y-3">
                            {sortedRawInputs.length === 0 ? (
                              <p className="text-xs text-slate-400 py-6 text-center">
                                記録されたメモや写真はありません
                              </p>
                            ) : (
                              sortedRawInputs.map((input) => (
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
                                          className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                                          title="このメモを編集"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleDeleteRawInput(input.id)}
                                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
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
                  </div>
                </div>
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
            }}
            onOpenDay={(dateStr) => {
              navigateTo('notebook', dateStr);
            }}
            onChangeMonth={(delta) => changeCalendarMonth(delta)}
            onSetYearMonth={(y, m) => {
              setCalendarYear(y);
              setCalendarMonth(m);
            }}
            onSyncCalendar={() => handleSyncCalendar(false)}
            isSyncingCalendar={isSyncingCalendar}
            googleConnected={googleConnected}
            onUpdateScheduleMemo={handleUpdateScheduleMemo}
            onDeleteScheduleMemo={handleDeleteScheduleMemo}
            onAddSchedule={handleAddScheduleDirect}
          />
        )}

        {/* 3. タスク管理タブ（新設：ジャンル・重要度・3日自動アーカイブ・専用検索） */}
        {activeTab === 'tasks' && (
          <TaskManagementView
            onOpenCalendarDate={(dateStr) => {
              navigateTo('calendar', dateStr);
            }}
          />
        )}

        {/* 4. 全文検索タブ（出自・日付明記 ＆ タップで該当日の1日手帳へスムーズジャンプ） */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5 max-w-4xl mx-auto pb-32">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm shadow-xs">
                  🔍
                </span>
                <span>手帳の全文検索</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                予定・デイリーメモ・タスク・実績ログを横断してキーワード検索します
              </p>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="キーワードを入力（例: 新井邸、見積、道具、会議...）"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 text-sm bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-500 focus:bg-white text-slate-900 placeholder:text-slate-400 shadow-2xs transition"
                />
                <button
                  type="button"
                  onClick={() => searchVoice.toggle(searchQuery)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition cursor-pointer ${
                    searchVoice.isListening
                      ? 'bg-rose-500 text-white animate-pulse shadow-xs'
                      : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title="声で検索ワードを入力"
                >
                  {searchVoice.isListening ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>検索</span>
              </button>
            </form>

            {searchResults && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>検索結果 ({searchResults.count || searchResults.items?.length || 0}件)</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    ※タップすると該当日の1日手帳へジャンプします
                  </span>
                </div>

                {!searchResults.items || searchResults.items.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl text-slate-400">
                    <p className="text-xs">一致する記録は見つかりませんでした</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {searchResults.items.map((item: any) => (
                      <div
                        key={`${item.source}-${item.id}`}
                        onClick={() => {
                          if (item.date && item.date !== '日付未定') {
                            navigateTo('notebook', item.date);
                          } else if (item.source === 'task') {
                            navigateTo('tasks');
                          } else {
                            navigateTo('notebook', getTodayLocalDate());
                          }
                        }}
                        className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200/80 transition cursor-pointer space-y-1.5 shadow-2xs hover:shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {/* 出自バッジ */}
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                                item.sourceBadgeColor || 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {item.source === 'calendar' && '📅 '}
                              {item.source === 'task' && '📋 '}
                              {item.source === 'memo' && '📝 '}
                              {item.source === 'activity' && '🏃 '}
                              {item.sourceLabel}
                            </span>

                            {/* 日付 */}
                            <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>{item.date}</span>
                            </span>
                          </div>
                        </div>

                        {/* タイトル */}
                        <p className="text-sm font-bold text-slate-900 break-words">
                          {item.title}
                        </p>

                        {/* スニペット */}
                        {item.snippet && (
                          <p className="text-xs text-slate-500 line-clamp-2 whitespace-pre-wrap">
                            {item.snippet}
                          </p>
                        )}
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      実績内容 <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleFormatEditActivityWithAi}
                      disabled={isAiFormattingEditActivity || !editActivityTitle.trim()}
                      className="px-2 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                      title="AIで実績タイトルを清書"
                    >
                      {isAiFormattingEditActivity ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                      )}
                      <span>✨ AI補正</span>
                    </button>
                  </div>
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
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      メモ内容 <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleFormatEditRawInputWithAi}
                      disabled={isAiFormattingEditMemo || !editRawInputContent.trim()}
                      className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                      title="AIでメモを読みやすく清書"
                    >
                      {isAiFormattingEditMemo ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      )}
                      <span>✨ AI補正</span>
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={editRawInputContent}
                    onChange={(e) => setEditRawInputContent(e.target.value)}
                    placeholder="メモ内容を入力..."
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-normal text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition leading-relaxed shadow-2xs resize-none"
                    autoFocus
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
                    value={editRawInputTime}
                    onChange={(e) => setEditRawInputTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition shadow-2xs"
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

        {/* ── 画面右下常設：一括AI窓口（なんでも話す）FABボタン ── */}
        <button
          type="button"
          onClick={() => setShowUnifiedAiModal(true)}
          className="fixed bottom-20 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-400 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-white shadow-xl flex items-center justify-center transition cursor-pointer border-2 border-white/80"
          title="何でも話せる一括AI窓口"
        >
          <Sparkles className="w-6 h-6 animate-pulse" />
        </button>

        {/* ── 一括AI窓口モーダル ── */}
        <UnifiedAiInputModal
          isOpen={showUnifiedAiModal}
          onClose={() => setShowUnifiedAiModal(false)}
          onSuccess={(targetDate) => {
            const destDate = targetDate || selectedDate;
            if (targetDate && targetDate !== selectedDate) {
              navigateTo('notebook', destDate);
            } else {
              fetchNoteData(destDate);
            }
            fetchMonthSummary(calendarYear, calendarMonth);
            fetchTodayTasks();
            if (googleConnected) {
              handleSyncCalendar(true);
            }
          }}
          currentDate={selectedDate}
        />
        {/* ── スマホ操作に最適化された下部固定ナビゲーションバー（ボトムナビ） ── */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg px-2 py-1.5">
          <div className="max-w-md mx-auto grid grid-cols-5 gap-1 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => {
                const today = getTodayLocalDate();
                navigateTo('notebook', today);
                if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex flex-col items-center py-1.5 rounded-xl transition cursor-pointer ${
                activeTab === 'notebook'
                  ? 'text-amber-600 font-black bg-amber-50'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <FileText className="w-5 h-5 mb-0.5" />
              <span>1日手帳</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('calendar')}
              className={`flex flex-col items-center py-1.5 rounded-xl transition cursor-pointer ${
                activeTab === 'calendar'
                  ? 'text-indigo-600 font-black bg-indigo-50'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-5 h-5 mb-0.5" />
              <span>カレンダー</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('tasks')}
              className={`flex flex-col items-center py-1.5 rounded-xl transition cursor-pointer ${
                activeTab === 'tasks'
                  ? 'text-amber-600 font-black bg-amber-50'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <CheckSquare className="w-5 h-5 mb-0.5" />
              <span>タスク</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('search')}
              className={`flex flex-col items-center py-1.5 rounded-xl transition cursor-pointer ${
                activeTab === 'search'
                  ? 'text-indigo-600 font-black bg-indigo-50'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Search className="w-5 h-5 mb-0.5" />
              <span>検索</span>
            </button>

            <button
              type="button"
              onClick={() => setShowGpsModal(true)}
              className="flex flex-col items-center py-1.5 rounded-xl text-slate-500 hover:text-slate-900 transition cursor-pointer"
            >
              <MapPin className="w-5 h-5 mb-0.5 text-emerald-600" />
              <span>GPS日報</span>
            </button>
          </div>
        </nav>

        {/* ── GPS活動ログ・日報モーダル ── */}
        <GpsActivityModal
          isOpen={showGpsModal}
          onClose={() => setShowGpsModal(false)}
          currentDate={selectedDate}
          onSyncGoogleCalendar={() => handleSyncCalendar(false)}
          onDisconnectGoogleCalendar={handleDisconnectGoogle}
          isSyncingCalendar={isSyncingCalendar}
          googleConnected={googleConnected}
          lastRecordedAt={lastSavedLocation?.recorded_at || null}
          onAddActivityFromStay={(stay) => {
            handleAddScheduleDirect({
              title: `📍 現場滞在: ${stay.placeName}`,
              startTime: stay.startTime,
              endTime: stay.endTime,
            });
          }}
        />
      </main>
    </div>
  );
}
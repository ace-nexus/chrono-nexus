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
  X,
} from 'lucide-react';
import { useAutoLocationTracker } from '@/hooks/useAutoLocationTracker';

type VoiceTarget = 'memo' | 'schedule' | 'activity' | 'search';
type ActiveTab = 'notebook' | 'calendar' | 'search';

export default function DailyNotebookPage() {
  // 日付管理（デフォルト今日: YYYY-MM-DD）
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

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

  // 音声認識状態 (Web Speech API) - 長時間無制限＆ハウリング完全防止設計
  const [activeVoiceTarget, setActiveVoiceTarget] = useState<VoiceTarget | null>(null);
  const voiceInitialTextRef = useRef<string>('');
  const currentRecognizedTextRef = useRef<string>('');
  const isVoiceActiveRef = useRef<boolean>(false);
  const activeVoiceTargetRef = useRef<VoiceTarget | null>(null);
  const recognitionRef = useRef<any>(null);

  // 月間カレンダー表示用状態
  const todayObj = new Date();
  const [calendarYear, setCalendarYear] = useState<number>(todayObj.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(todayObj.getMonth() + 1);
  const [previewDate, setPreviewDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
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

  // GPS自動記録フック
  const { isTracking, currentLocation, lastSavedLocation, error: gpsError } =
    useAutoLocationTracker('owner');

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

  // 日付の切り替え
  const changeDate = (offsetDays: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + offsetDays);
    setSelectedDate(current.toISOString().split('T')[0]);
  };

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
      }
    } catch (err) {
      console.error('Add schedule error:', err);
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
      <main className="max-w-6xl mx-auto w-full p-4 sm:p-6 flex-1">
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

              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-indigo-600" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-lg font-bold text-slate-900 border-none bg-transparent cursor-pointer focus:outline-none"
                />
                <button
                  onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                  className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-600 font-semibold rounded-md hover:bg-indigo-100 transition"
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

            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <p className="text-sm">手帳を開いています...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* -- 左列：予定 vs 実績（完全分離 2カラム） -- */}
                <div className="lg:col-span-5 space-y-6">
                  {/* ① 予定ブロック (Google Calendar / 手動) */}
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-sky-500" />
                        <h2 className="font-bold text-slate-900">今日の予定（Schedule）</h2>
                      </div>
                      <span className="text-xs text-slate-400">{scheduleEvents.length}件</span>
                    </div>

                    <div className="space-y-2 mb-4">
                      {scheduleEvents.length === 0 ? (
                        <p className="text-xs text-slate-400 py-4 text-center">予定はありません</p>
                      ) : (
                        scheduleEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="p-3 bg-sky-50/60 rounded-xl border border-sky-100 flex items-start justify-between gap-2 group"
                          >
                            <div className="flex items-start gap-2 flex-1">
                              <span className="w-2 h-2 rounded-full bg-sky-500 mt-1.5"></span>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{ev.title}</p>
                                {ev.start_time && (
                                  <p className="text-[11px] text-sky-600">
                                    {new Date(ev.start_time).toLocaleTimeString('ja-JP', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </p>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteSchedule(ev.id)}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition opacity-80 group-hover:opacity-100"
                              title="予定を削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 予定のクイック追加（広々入力＆マイク内蔵・最初の文字もくっきり） */}
                    <div className="space-y-2 mt-4 pt-3 border-t border-slate-100">
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          placeholder="予定を入力...（例：15:00 ミーティング）"
                          value={newScheduleTitle}
                          onChange={(e) => setNewScheduleTitle(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddSchedule()}
                          className="w-full pl-4 pr-12 py-3 text-base bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-500 focus:bg-white transition text-slate-900 placeholder:text-slate-400 shadow-2xs"
                        />
                        <button
                          type="button"
                          onClick={() => toggleVoiceRecognition('schedule')}
                          className={`absolute right-2 p-2 rounded-lg transition ${
                            activeVoiceTarget === 'schedule'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'text-slate-400 hover:text-sky-600 hover:bg-sky-50'
                          }`}
                          title="声で予定を入力"
                        >
                          {activeVoiceTarget === 'schedule' ? (
                            <MicOff className="w-5 h-5" />
                          ) : (
                            <Mic className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                      <button
                        onClick={handleAddSchedule}
                        className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition shadow-xs"
                      >
                        <Plus className="w-4 h-4" /> 予定を追加する
                      </button>
                    </div>
                  </div>

                  {/* ② 実績・行動ログブロック (やったこと・予定とは分離) */}
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
                                    {new Date(act.created_at).toLocaleTimeString('ja-JP', {
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
                            <button
                              onClick={() => handleDeleteActivity(act.id)}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition opacity-80 group-hover:opacity-100"
                              title="実績を削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 実績のクイック追加（広々入力＆マイク内蔵・最初の文字もくっきり） */}
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

                  {/* ③ GPS足跡ログ（自動記録された位置情報） */}
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

                {/* -- 右列：デイリーノート本体（生入力 ＆ AI要約 ＆ 写真） -- */}
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
                        placeholder="思いついたこと、気づき、メモを自由に入力...（声でゆっくり話しても大丈夫です）"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        className="w-full p-4 text-base bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-500 focus:bg-white transition leading-relaxed text-slate-900 placeholder:text-slate-400 shadow-2xs resize-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {/* 音声入力ボタン */}
                        <button
                          type="button"
                          onClick={() => toggleVoiceRecognition('memo')}
                          className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition shadow-2xs ${
                            activeVoiceTarget === 'memo'
                              ? 'bg-rose-500 text-white animate-pulse ring-2 ring-rose-300'
                              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          {activeVoiceTarget === 'memo' ? (
                            <MicOff className="w-4 h-4" />
                          ) : (
                            <Mic className="w-4 h-4 text-indigo-600" />
                          )}
                          {activeVoiceTarget === 'memo' ? '🔴 音声入力中（タップで完了）' : '🎙️ 声でメモする'}
                        </button>

                        {/* 写真添付ボタン */}
                        <label className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2 cursor-pointer transition">
                          <Camera className="w-4 h-4 text-sky-600" />
                          {isUploadingPhoto ? '保存中...' : '写真添付'}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoUpload}
                            disabled={isUploadingPhoto}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* メモ保存ボタン */}
                        <button
                          onClick={handleAddMemo}
                          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition shadow-xs"
                        >
                          <Send className="w-4 h-4" /> メモを保存
                        </button>
                      </div>
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

                  {/* 生入力リスト（写真やテキストのログ） */}
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
                              <div className="flex items-center gap-2">
                                <span>
                                  {new Date(input.recorded_at).toLocaleTimeString('ja-JP', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
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
          </>
        )}

        {/* 2. 月間カレンダータブ（Googleカレンダー超えの視認性＆プレビュー機能） */}
        {activeTab === 'calendar' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shadow-2xs">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                    {calendarYear}年 {calendarMonth}月
                  </h2>
                  <p className="text-xs text-slate-400">日付をタップすると拡大表示されます（もう一度タップで元に戻ります）</p>
                </div>
                {isLoadingMonth && <Loader2 className="w-5 h-5 animate-spin text-indigo-500 ml-2" />}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeCalendarMonth(-1)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition flex items-center gap-1"
                  title="前月"
                >
                  <ChevronLeft className="w-4 h-4" /> 前月
                </button>
                <button
                  onClick={() => {
                    const now = new Date();
                    setCalendarYear(now.getFullYear());
                    setCalendarMonth(now.getMonth() + 1);
                    setPreviewDate(now.toISOString().split('T')[0]);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-xs"
                >
                  今月
                </button>
                <button
                  onClick={() => changeCalendarMonth(1)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition flex items-center gap-1"
                  title="翌月"
                >
                  翌月 <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 曜日ヘッダー（くっきり配色） */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs sm:text-sm py-2 border-b border-slate-200/80">
              <span className="text-rose-600 bg-rose-50/60 py-1.5 rounded-lg">日</span>
              <span className="text-slate-700 py-1.5">月</span>
              <span className="text-slate-700 py-1.5">火</span>
              <span className="text-slate-700 py-1.5">水</span>
              <span className="text-slate-700 py-1.5">木</span>
              <span className="text-slate-700 py-1.5">金</span>
              <span className="text-sky-600 bg-sky-50/60 py-1.5 rounded-lg">土</span>
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {paddingDays.map((_, idx) => (
                <div
                  key={`pad-${idx}`}
                  className="min-h-[80px] sm:min-h-[105px] p-1 bg-slate-50/40 rounded-xl border border-transparent opacity-30"
                />
              ))}
              {monthDays.map((day) => {
                const dateStr = `${calendarYear}-${calendarMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const isPreview = dateStr === previewDate;
                const isPopup = dateStr === popupDate;
                const dayOfWeek = new Date(calendarYear, calendarMonth - 1, day).getDay(); // 0=日, 6=土
                const daySchedules = monthSummary.schedules.filter(
                  (s) => s.start_time && s.start_time.startsWith(dateStr)
                );
                const hasNote = monthSummary.notes.some((n) => n.date === dateStr);

                return (
                  <button
                    key={day}
                    onClick={() => {
                      setPreviewDate(dateStr);
                      setPopupDate((prev) => (prev === dateStr ? null : dateStr));
                    }}
                    className={`min-h-[80px] sm:min-h-[105px] p-1.5 sm:p-2.5 rounded-xl border text-left flex flex-col justify-between transition group relative cursor-pointer ${
                      isPopup
                        ? 'bg-indigo-100/90 border-indigo-500 ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10'
                        : isPreview
                        ? 'bg-indigo-50/90 border-indigo-400 ring-2 ring-indigo-500 shadow-xs'
                        : isToday
                        ? 'bg-amber-50/60 border-amber-300'
                        : 'bg-white hover:bg-slate-50 border-slate-200/70 hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-xs sm:text-sm font-bold rounded-full w-6 h-6 flex items-center justify-center ${
                          isToday
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : isPreview
                            ? 'text-indigo-700 font-black'
                            : dayOfWeek === 0
                            ? 'text-rose-600'
                            : dayOfWeek === 6
                            ? 'text-sky-600'
                            : 'text-slate-800'
                        }`}
                      >
                        {day}
                      </span>
                      {hasNote && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500" title="手帳ノートあり" />
                      )}
                    </div>

                    {/* 予定リストバッジ */}
                    <div className="w-full space-y-1 overflow-hidden mt-1">
                      {daySchedules.slice(0, 2).map((sch) => (
                        <div
                          key={sch.id}
                          className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 truncate font-semibold border border-sky-200/60"
                        >
                          {sch.title}
                        </div>
                      ))}
                      {daySchedules.length > 2 && (
                        <div className="text-[9px] sm:text-[10px] text-slate-500 font-bold pl-1">
                          +{daySchedules.length - 2}件の予定
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── 選択した日の詳細プレビューデッキ（Googleカレンダー超えの視認性） ── */}
            {(() => {
              const previewDaySchedules = monthSummary.schedules.filter(
                (s) => s.start_time && s.start_time.startsWith(previewDate)
              );
              const previewDayNote = monthSummary.notes.some((n) => n.date === previewDate);

              return (
                <div className="bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 rounded-2xl p-5 border border-indigo-100 shadow-xs space-y-4 mt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100/70 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-2xs">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-base sm:text-lg text-slate-900">
                          {previewDate.split('-')[0]}年{parseInt(previewDate.split('-')[1], 10)}月{parseInt(previewDate.split('-')[2], 10)}日 の予定と記録
                        </h3>
                        <p className="text-xs text-slate-500">
                          {previewDaySchedules.length > 0 ? `${previewDaySchedules.length}件の予定があります` : '予定はありません'}
                          {previewDayNote ? '・手帳メモあり' : ''}
                        </p>
                      </div>
                      {previewDate === new Date().toISOString().split('T')[0] && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-600 text-white ml-2">
                          今日
                        </span>
                      )}
                    </div>

                    {/* この日の手帳を開くボタン */}
                    <button
                      onClick={() => {
                        setSelectedDate(previewDate);
                        setActiveTab('notebook');
                      }}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition shadow-xs cursor-pointer"
                    >
                      <FileText className="w-4 h-4" /> この日の手帳を開く →
                    </button>
                  </div>

                  {/* その日の予定一覧 */}
                  <div className="space-y-2">
                    {previewDaySchedules.length === 0 ? (
                      <div className="p-4 rounded-xl bg-white/70 border border-slate-200/60 text-center text-xs text-slate-400">
                        この日の予定は登録されていません。「この日の手帳を開く」から新しい予定を追加できます。
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {previewDaySchedules.map((sch) => (
                          <div
                            key={sch.id}
                            className="p-3.5 bg-white rounded-xl border border-sky-100 flex items-center justify-between shadow-2xs"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
                              <span className="text-sm font-bold text-slate-800 truncate">{sch.title}</span>
                            </div>
                            {sch.start_time && (
                              <span className="text-xs font-mono font-bold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg shrink-0 ml-2 border border-sky-100">
                                {new Date(sch.start_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* その日の手帳メモ情報 */}
                  {previewDayNote && (
                    <div className="flex items-center gap-2 p-3 bg-indigo-50/70 rounded-xl border border-indigo-100 text-xs text-indigo-900 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>この日は手帳メモ・生ログが記録されています。「この日の手帳を開く」ボタンから閲覧・追記ができます。</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 日付拡大ポップアップ（その日のスケジュールが綺麗に見え、もう一度さわると元に戻る） ── */}
            {popupDate && (() => {
              const popupSchedules = monthSummary.schedules.filter(
                (s) => s.start_time && s.start_time.startsWith(popupDate)
              );
              const popupNote = monthSummary.notes.some((n) => n.date === popupDate);
              const [y, m, d] = popupDate.split('-');
              const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
              const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
              const dayOfWeekStr = weekDays[dateObj.getDay()];
              const isToday = popupDate === new Date().toISOString().split('T')[0];

              return (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
                  onClick={() => setPopupDate(null)}
                >
                  <div
                    className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-5 animate-in zoom-in-95 duration-200"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* ポップアップヘッダー */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-100">
                          <Calendar className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-xl sm:text-2xl font-black text-slate-900">
                              {parseInt(m, 10)}月{parseInt(d, 10)}日 ({dayOfWeekStr})
                            </h3>
                            {isToday && (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-600 text-white shadow-2xs">
                                今日
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {y}年 ・ {popupSchedules.length > 0 ? `${popupSchedules.length}件の予定` : '予定なし'}
                            {popupNote ? ' ・ 手帳メモあり' : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setPopupDate(null)}
                        className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
                        title="閉じる（もう一度タップでも戻ります）"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* スケジュール一覧（綺麗に視認性高く表示） */}
                    <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-500" />
                        この日のスケジュール一覧
                      </h4>

                      {popupSchedules.length === 0 ? (
                        <div className="p-6 rounded-2xl bg-slate-50/80 border border-dashed border-slate-200 text-center">
                          <p className="text-sm font-bold text-slate-500">この日の予定はありません</p>
                          <p className="text-xs text-slate-400 mt-1">下のボタンから手帳を開いて予定を簡単に追加できます</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {popupSchedules.map((sch) => (
                            <div
                              key={sch.id}
                              className="p-4 bg-gradient-to-r from-sky-50/70 to-indigo-50/40 rounded-2xl border border-sky-100 flex items-center justify-between gap-3 shadow-2xs hover:border-sky-300 transition"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-3 h-3 rounded-full bg-sky-500 shrink-0" />
                                <span className="text-base font-bold text-slate-900 truncate">
                                  {sch.title}
                                </span>
                              </div>
                              {sch.start_time && (
                                <span className="text-xs font-mono font-black text-sky-800 bg-white px-3 py-1.5 rounded-xl shrink-0 border border-sky-100 shadow-2xs">
                                  {new Date(sch.start_time).toLocaleTimeString('ja-JP', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 手帳記録の有無案内 */}
                    {popupNote && (
                      <div className="flex items-center gap-2 p-3.5 bg-indigo-50/80 rounded-2xl border border-indigo-100 text-xs text-indigo-900 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>この日は手帳メモ・写真・生ログが記録されています。</span>
                      </div>
                    )}

                    {/* フッターアクション */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => {
                          setSelectedDate(popupDate);
                          setPopupDate(null);
                          setActiveTab('notebook');
                        }}
                        className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-md shadow-indigo-100 cursor-pointer"
                      >
                        <FileText className="w-4 h-4" /> この日の手帳を開く
                      </button>
                      <button
                        onClick={() => setPopupDate(null)}
                        className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition cursor-pointer"
                      >
                        元に戻る
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
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
      </main>
    </div>
  );
}
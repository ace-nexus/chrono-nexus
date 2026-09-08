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

  // 音声認識状態 (Web Speech API) - ハウリング/二重連結防止設計
  const [activeVoiceTarget, setActiveVoiceTarget] = useState<VoiceTarget | null>(null);
  const voiceInitialTextRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);

  // 月間カレンダー表示用状態
  const todayObj = new Date();
  const [calendarYear, setCalendarYear] = useState<number>(todayObj.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(todayObj.getMonth() + 1);
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

  // 6. 音声認識（Web Speech API）- 全入力共通＆雪だるま式重複バグ完全解消
  const toggleVoiceRecognition = (target: VoiceTarget) => {
    if (activeVoiceTarget === target) {
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

    // 録音開始前のテキストを保持（上書きや重複を防ぐ基準点）
    let currentVal = '';
    if (target === 'memo') currentVal = newMemoText;
    else if (target === 'schedule') currentVal = newScheduleTitle;
    else if (target === 'activity') currentVal = newActivityTitle;
    else if (target === 'search') currentVal = searchQuery;
    voiceInitialTextRef.current = currentVal;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      // セッション全体の全結果を0から連結（重複再加算を防ぐ）
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        sessionTranscript += event.results[i][0].transcript;
      }
      const prefix = voiceInitialTextRef.current ? voiceInitialTextRef.current + ' ' : '';
      const updated = prefix + sessionTranscript;

      if (target === 'memo') setNewMemoText(updated);
      else if (target === 'schedule') setNewScheduleTitle(updated);
      else if (target === 'activity') setNewActivityTitle(updated);
      else if (target === 'search') setSearchQuery(updated);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setActiveVoiceTarget(null);
    };

    recognition.onend = () => {
      setActiveVoiceTarget(null);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setActiveVoiceTarget(target);
    } catch (err) {
      console.error('Start recognition error:', err);
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

                    {/* 予定のクイック追加（音声マイク連動） */}
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="予定を追加..."
                        value={newScheduleTitle}
                        onChange={(e) => setNewScheduleTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSchedule()}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => toggleVoiceRecognition('schedule')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center transition ${
                          activeVoiceTarget === 'schedule'
                            ? 'bg-rose-500 text-white animate-pulse'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="声で予定を入力"
                      >
                        {activeVoiceTarget === 'schedule' ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={handleAddSchedule}
                        className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                      >
                        <Plus className="w-3.5 h-3.5" /> 追加
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

                    {/* 実績のクイック追加（音声マイク連動） */}
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="今やったことをメモ..."
                        value={newActivityTitle}
                        onChange={(e) => setNewActivityTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => toggleVoiceRecognition('activity')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center transition ${
                          activeVoiceTarget === 'activity'
                            ? 'bg-rose-500 text-white animate-pulse'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="声で実績を入力"
                      >
                        {activeVoiceTarget === 'activity' ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={handleAddActivity}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                      >
                        <Plus className="w-3.5 h-3.5" /> 記録
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
                        rows={3}
                        placeholder="思いついたこと、気づき、メモを自由に入力...（音声入力もOK）"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* 音声入力ボタン */}
                        <button
                          type="button"
                          onClick={() => toggleVoiceRecognition('memo')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                            activeVoiceTarget === 'memo'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {activeVoiceTarget === 'memo' ? (
                            <MicOff className="w-4 h-4" />
                          ) : (
                            <Mic className="w-4 h-4 text-indigo-600" />
                          )}
                          {activeVoiceTarget === 'memo' ? '音声認識中...' : '声でメモ'}
                        </button>

                        {/* 写真添付ボタン */}
                        <label className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1.5 cursor-pointer transition">
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
                          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition shadow-xs"
                        >
                          <Send className="w-3.5 h-3.5" /> 保存
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

        {/* 2. 月間カレンダータブ（Googleカレンダー風ビュー） */}
        {activeTab === 'calendar' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-bold text-slate-900">
                  {calendarYear}年 {calendarMonth}月
                </h2>
                {isLoadingMonth && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeCalendarMonth(-1)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition"
                  title="前月"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    const now = new Date();
                    setCalendarYear(now.getFullYear());
                    setCalendarMonth(now.getMonth() + 1);
                  }}
                  className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 font-semibold rounded-lg hover:bg-indigo-100 transition"
                >
                  今月
                </button>
                <button
                  onClick={() => changeCalendarMonth(1)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition"
                  title="翌月"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 gap-1 text-center font-semibold text-xs py-2 border-b border-slate-100">
              <span className="text-rose-500">日</span>
              <span className="text-slate-600">月</span>
              <span className="text-slate-600">火</span>
              <span className="text-slate-600">水</span>
              <span className="text-slate-600">木</span>
              <span className="text-slate-600">金</span>
              <span className="text-sky-500">土</span>
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {paddingDays.map((_, idx) => (
                <div
                  key={`pad-${idx}`}
                  className="min-h-[70px] sm:min-h-[90px] p-1 bg-slate-50/40 rounded-xl border border-transparent opacity-30"
                />
              ))}
              {monthDays.map((day) => {
                const dateStr = `${calendarYear}-${calendarMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const isSelected = dateStr === selectedDate;
                const daySchedules = monthSummary.schedules.filter(
                  (s) => s.start_time && s.start_time.startsWith(dateStr)
                );
                const hasNote = monthSummary.notes.some((n) => n.date === dateStr);

                return (
                  <button
                    key={day}
                    onClick={() => {
                      setSelectedDate(dateStr);
                      setActiveTab('notebook');
                    }}
                    className={`min-h-[70px] sm:min-h-[90px] p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition group relative ${
                      isSelected
                        ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-400'
                        : isToday
                        ? 'bg-amber-50/50 border-amber-200'
                        : 'bg-white hover:bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                          isToday
                            ? 'bg-indigo-600 text-white shadow-xs'
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
                    <div className="w-full space-y-0.5 overflow-hidden mt-1">
                      {daySchedules.slice(0, 2).map((sch) => (
                        <div
                          key={sch.id}
                          className="text-[10px] px-1 py-0.5 rounded bg-sky-100/90 text-sky-800 truncate font-medium"
                        >
                          {sch.title}
                        </div>
                      ))}
                      {daySchedules.length > 2 && (
                        <div className="text-[9px] text-slate-400 font-medium pl-1">
                          +{daySchedules.length - 2}件
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. 全文検索タブ */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-5 h-5 text-indigo-600" />
              手帳の全文検索
            </h2>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                placeholder="キーワードで過去の手帳を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => toggleVoiceRecognition('search')}
                className={`px-3 py-3 rounded-xl text-sm font-semibold flex items-center transition ${
                  activeVoiceTarget === 'search'
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="声で検索ワードを入力"
              >
                {activeVoiceTarget === 'search' ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4 text-indigo-600" />
                )}
              </button>
              <button
                type="submit"
                disabled={isSearching}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                検索
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
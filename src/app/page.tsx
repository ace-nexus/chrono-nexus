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
} from 'lucide-react';
import { useAutoLocationTracker } from '@/hooks/useAutoLocationTracker';

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

  // 音声認識状態 (Web Speech API)
  const [isListening, setIsListening] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // 検索・ツリー表示状態
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'notebook' | 'search' | 'tree'>('notebook');

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

  // 日付の切り替え
  const changeDate = (offsetDays: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + offsetDays);
    setSelectedDate(current.toISOString().split('T')[0]);
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
    const nowTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
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

  // 5. 音声入力トグル (Web Speech API)
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('お使いのブラウザは音声入力に対応していません。（Chrome推奨）');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setNewMemoText((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript));
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* ── ヘッダー ── */}
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
              className={`px-3 py-1 rounded-md transition ${activeTab === 'notebook' ? 'bg-white shadow-xs text-indigo-600 font-bold' : 'text-slate-600'}`}
            >
              手帳
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1 rounded-md transition ${activeTab === 'search' ? 'bg-white shadow-xs text-indigo-600 font-bold' : 'text-slate-600'}`}
            >
              検索
            </button>
          </div>
        </div>
      </header>

      {/* ── メインコンテンツ ── */}
      <main className="max-w-6xl mx-auto w-full p-4 sm:p-6 flex-1">
        {activeTab === 'notebook' ? (
          <>
            {/* ── 日付バー ── */}
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
                {/* ── 左列：予定 vs 実績（完全分離 2カラム） ── */}
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
                            className="p-3 bg-sky-50/60 rounded-xl border border-sky-100 flex items-start gap-2"
                          >
                            <span className="w-2 h-2 rounded-full bg-sky-500 mt-1.5"></span>
                            <div className="flex-1">
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
                        ))
                      )}
                    </div>

                    {/* 予定のクイック追加 */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="予定を追加..."
                        value={newScheduleTitle}
                        onChange={(e) => setNewScheduleTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSchedule()}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500"
                      />
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
                            className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-start gap-2"
                          >
                            <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5"></span>
                            <div className="flex-1">
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
                        ))
                      )}
                    </div>

                    {/* 実績のクイック追加 */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="今やったことをメモ..."
                        value={newActivityTitle}
                        onChange={(e) => setNewActivityTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                      />
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

                {/* ── 右列：デイリーノート本体（生入力 ＆ AI要約 ＆ 写真） ── */}
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
                          onClick={toggleListening}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                            isListening
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-indigo-600" />}
                          {isListening ? '音声認識中...' : '声でメモ'}
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
                            className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition"
                          >
                            <div className="flex items-center justify-between mb-1.5 text-[11px] text-slate-400">
                              <span className="font-medium uppercase text-slate-500">
                                {input.input_type === 'photo' ? '📸 写真' : '📝 メモ'}
                              </span>
                              <span>
                                {new Date(input.recorded_at).toLocaleTimeString('ja-JP', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
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
        ) : (
          /* ── 検索タブ ── */
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
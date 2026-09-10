'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckSquare,
  Square,
  Plus,
  Search,
  AlertCircle,
  Clock,
  Calendar,
  Tag,
  Trash2,
  Edit2,
  X,
  Loader2,
  Archive,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sparkles,
  Mic,
  MicOff,
  Camera,
  Check,
} from 'lucide-react';
import { useContinuousSpeechRecognition } from '@/lib/useContinuousSpeechRecognition';

export interface TaskItem {
  id: string;
  noteId?: string;
  title: string;
  description: string;
  genre: string;
  priority: 'S' | 'A' | 'B' | 'C';
  dueDate: string | null;
  dueTime: string | null;
  isAllDay: boolean;
  isNoDate: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  archived: boolean;
  locationName: string | null;
  createdAt: string;
  isUrgent?: boolean;
  isStale?: boolean;
  staleDays?: number;
}

interface TaskManagementViewProps {
  onOpenCalendarDate?: (dateStr: string) => void;
}

export default function TaskManagementView({ onOpenCalendarDate }: TaskManagementViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [genres, setGenres] = useState<string[]>(['買い物', '見積', 'その他']);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // 新規タスクモーダル用状態
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newGenre, setNewGenre] = useState<string>('その他');
  const [newPriority, setNewPriority] = useState<'S' | 'A' | 'B' | 'C'>('B');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newIsNoDate, setNewIsNoDate] = useState<boolean>(true);
  const [newLocation, setNewLocation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // 音声タスク作成用
  const [voiceInputText, setVoiceInputText] = useState<string>('');
  const [isParsingVoiceTask, setIsParsingVoiceTask] = useState<boolean>(false);

  // カメラ手書き解析用
  const [isProcessingVision, setIsProcessingVision] = useState<boolean>(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // 新ジャンル追加ダイアログ用状態
  const [showAddGenreModal, setShowAddGenreModal] = useState<boolean>(false);
  const [newGenreName, setNewGenreName] = useState<string>('');

  // 編集モーダル用状態
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

  // 音声入力フック
  const { isListening, stop: stopVoice, toggle: toggleVoice } = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => {
      setVoiceInputText(text);
    },
  });

  // データ取得
  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/tasks?view=all');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Fetch tasks error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGenres = async () => {
    // 1. ローカルキャッシュから即時復元
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('chrono_task_genres');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setGenres(parsed);
          }
        } catch (_) {}
      }
    }

    // 2. DBから最新取得して更新
    try {
      const res = await fetch('/api/tasks/genres');
      if (res.ok) {
        const data = await res.json();
        if (data.genres && Array.isArray(data.genres)) {
          setGenres(data.genres);
          if (typeof window !== 'undefined') {
            localStorage.setItem('chrono_task_genres', JSON.stringify(data.genres));
          }
        }
      }
    } catch (err) {
      console.error('Fetch genres error:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchGenres();
  }, []);

  // 音声からタスクをAI判定してモーダルを開く
  const handleParseVoiceToTask = async () => {
    if (!voiceInputText.trim() || isParsingVoiceTask) return;
    stopVoice();
    setIsParsingVoiceTask(true);

    try {
      const res = await fetch('/api/ai/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: voiceInputText.trim(),
          availableGenres: genres,
        }),
      });

      if (!res.ok) throw new Error('音声解析に失敗しました');

      const data = await res.json();
      const t = data.task;
      if (t) {
        setNewTitle(t.title || voiceInputText.trim());
        setNewDescription(t.description || '');
        setNewGenre(genres.includes(t.genre) ? t.genre : 'その他');
        setNewPriority(['S', 'A', 'B', 'C'].includes(t.priority) ? t.priority : 'B');
        setNewDueDate(t.dueDate || '');
        setNewIsNoDate(Boolean(t.isNoDate || !t.dueDate));
        setNewLocation(t.locationName || '');
        setVoiceInputText('');
        setShowNewModal(true); // AIが各空欄を事前入力した状態でモーダルを開く
      }
    } catch (err: any) {
      alert(err.message || 'AI判定エラー');
    } finally {
      setIsParsingVoiceTask(false);
    }
  };

  // 手書きメモのカメラ撮影 ➔ Gemini Visionでタスク抽出
  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingVision(true);

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        if (!base64Data) return;

        try {
          const res = await fetch('/api/ai/vision-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: base64Data,
              mimeType: file.type || 'image/jpeg',
              availableGenres: genres,
            }),
          });

          if (!res.ok) {
            throw new Error('手書き文字の解析に失敗しました');
          }

          const data = await res.json();
          const extractedTasks = data.tasks || [];

          if (extractedTasks.length === 0) {
            alert('画像からタスクを読み取れませんでした。もう一度撮影してください。');
            return;
          }

          // 1件目のタスクを新規モーダルに事前反映
          const first = extractedTasks[0];
          setNewTitle(first.title || '手書きタスク');
          setNewDescription(
            extractedTasks.length > 1
              ? `【他 ${extractedTasks.length - 1}件のメモ内容】\n` +
                extractedTasks
                  .slice(1)
                  .map((t: any) => `・${t.title}`)
                  .join('\n')
              : first.description || ''
          );
          setNewGenre(genres.includes(first.genre) ? first.genre : 'その他');
          setNewPriority(['S', 'A', 'B', 'C'].includes(first.priority) ? first.priority : 'B');
          setNewDueDate(first.dueDate || '');
          setNewIsNoDate(Boolean(first.isNoDate || !first.dueDate));
          setNewLocation(first.locationName || '');

          setShowNewModal(true);
        } catch (vErr: any) {
          alert(vErr.message || '手書き解析エラー');
        } finally {
          setIsProcessingVision(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      alert('写真の読み込みに失敗しました');
      setIsProcessingVision(false);
    }
  };

  // タスク完了トグル
  const handleToggleComplete = async (task: TaskItem) => {
    const nextCompleted = !task.isCompleted;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, isCompleted: nextCompleted } : t))
    );

    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          isCompleted: nextCompleted,
        }),
      });
    } catch (err) {
      console.error('Toggle complete error:', err);
      fetchTasks();
    }
  };

  // タスク削除
  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('このタスクを削除してもよろしいですか？')) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Delete task error:', err);
      fetchTasks();
    }
  };

  // 新規タスク作成
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          genre: newGenre,
          priority: newPriority,
          dueDate: newIsNoDate ? null : newDueDate || null,
          isNoDate: newIsNoDate,
          locationName: newLocation.trim() || null,
        }),
      });

      if (res.ok) {
        setNewTitle('');
        setNewDescription('');
        setNewDueDate('');
        setNewIsNoDate(true);
        setNewLocation('');
        setShowNewModal(false);
        fetchTasks();
      }
    } catch (err) {
      alert('タスク作成に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 新ジャンル追加
  const handleAddGenre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGenreName.trim()) return;
    try {
      const res = await fetch('/api/tasks/genres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGenreName.trim() }),
      });
      if (res.ok) {
        const d = await res.json();
        setGenres(d.genres);
        if (typeof window !== 'undefined') {
          localStorage.setItem('chrono_task_genres', JSON.stringify(d.genres));
        }
        setNewGenre(newGenreName.trim());
        setNewGenreName('');
        setShowAddGenreModal(false);
      }
    } catch (err) {
      alert('ジャンル追加エラー');
    }
  };

  // 編集保存
  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editingTask.title.trim()) return;
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTask.id,
          title: editingTask.title.trim(),
          description: editingTask.description,
          genre: editingTask.genre,
          priority: editingTask.priority,
          dueDate: editingTask.isNoDate ? null : editingTask.dueDate,
          isNoDate: editingTask.isNoDate,
          locationName: editingTask.locationName,
        }),
      });
      setEditingTask(null);
      fetchTasks();
    } catch (err) {
      alert('タスク更新エラー');
    }
  };

  // フィルタリング
  const { activeTasks, recentCompletedTasks, archivedTasks } = useMemo(() => {
    let list = tasks;

    if (selectedGenre !== 'all') {
      list = list.filter((t) => t.genre === selectedGenre);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.genre.toLowerCase().includes(q) ||
          (t.locationName && t.locationName.toLowerCase().includes(q))
      );
    }

    const active = list.filter((t) => !t.isCompleted && !t.archived);
    const recentCompleted = list.filter((t) => t.isCompleted && !t.archived);
    const archived = list.filter((t) => t.archived);

    return { activeTasks: active, recentCompletedTasks: recentCompleted, archivedTasks: archived };
  }, [tasks, selectedGenre, searchQuery]);

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'S':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white shadow-2xs">重要度 S</span>;
      case 'A':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-orange-500 text-white shadow-2xs">重要度 A</span>;
      case 'B':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500 text-white">重要度 B</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">低 C</span>;
    }
  };

  return (
    <div className="space-y-4 pb-20 max-w-4xl mx-auto animate-in fade-in duration-200">
      {/* ── 最上部：AI事前入力バー（音声入力 ＆ 手書き撮影） ── */}
      <div className="bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 rounded-3xl p-4 sm:p-5 text-white shadow-md space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-sm">
              ✨
            </span>
            <div>
              <h2 className="font-bold text-base leading-tight">AIタスク作成（空欄自動補完）</h2>
              <p className="text-[11px] text-amber-100">
                話すか手書きメモを撮るだけで、AIが空欄を埋めてくれます
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 隠しカメラインプット */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              onChange={handleCameraCapture}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isProcessingVision}
              className="px-3 py-2 bg-white/20 hover:bg-white/30 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-white/30"
              title="スマホカメラでメモ用紙・付箋を撮影してタスク化"
            >
              {isProcessingVision ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  解析中...
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  手書き撮影
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setNewTitle('');
                setNewDescription('');
                setNewGenre('その他');
                setNewPriority('B');
                setNewDueDate('');
                setNewIsNoDate(true);
                setNewLocation('');
                setShowNewModal(true);
              }}
              className="px-3 py-2 bg-white text-amber-800 hover:bg-amber-50 active:scale-95 rounded-xl text-xs font-bold flex items-center gap-1 transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              手動追加
            </button>
          </div>
        </div>

        {/* 音声入力バー */}
        <div className="bg-white/15 backdrop-blur-xs rounded-2xl p-2.5 flex items-center gap-2 border border-white/25">
          <button
            type="button"
            onClick={() => toggleVoice(voiceInputText)}
            className={`p-2.5 rounded-xl transition shadow-xs shrink-0 ${
              isListening
                ? 'bg-rose-500 text-white animate-bounce'
                : 'bg-white text-amber-700 hover:bg-amber-50 active:scale-95'
            }`}
            title={isListening ? '停止' : '音声で吹き込む'}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={voiceInputText}
            onChange={(e) => setVoiceInputText(e.target.value)}
            placeholder={
              isListening
                ? 'お話しください（例: 来週火曜までにA社に見積送付、重要度A）'
                : '話すか入力して「AIで空欄補完」を押してください...'
            }
            className="flex-1 bg-transparent text-white placeholder:text-amber-100/70 text-xs sm:text-sm font-medium focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleParseVoiceToTask();
            }}
          />

          <button
            type="button"
            onClick={handleParseVoiceToTask}
            disabled={!voiceInputText.trim() || isParsingVoiceTask}
            className="px-3.5 py-2 bg-white hover:bg-amber-50 active:scale-95 text-amber-800 rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-40 shrink-0 flex items-center gap-1 cursor-pointer"
          >
            {isParsingVoiceTask ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                解析中
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                AIで補完
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 検索バー ＆ ジャンル選択チップ ── */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-xs space-y-3">
        {/* インライン検索 */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="タスク名、メモ、現場、ジャンルで絞り込み..."
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 rounded-xl border border-slate-200 focus:bg-white focus:outline-none focus:border-amber-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ジャンル選択チップ */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedGenre('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition cursor-pointer ${
              selectedGenre === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            すべて
          </button>

          {genres.map((g) => {
            const isSelected = selectedGenre === g;
            const count = tasks.filter((t) => !t.isCompleted && !t.archived && t.genre === g).length;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGenre(g)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 transition cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <span>{g}</span>
                {count > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      isSelected ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAddGenreModal(true)}
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 shrink-0 flex items-center gap-1 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>追加</span>
          </button>
        </div>
      </div>

      {/* ── タスク一覧 ── */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            <p className="text-xs">タスクを読み込み中...</p>
          </div>
        ) : activeTasks.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
            <CheckSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-600">未完了のタスクはありません</p>
            <p className="text-xs text-slate-400 mt-1">
              上のマイク・手書き撮影ボタンから新しいタスクを追加できます
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className={`bg-white rounded-2xl p-4 border transition shadow-xs hover:border-amber-300 ${
                  task.isUrgent
                    ? 'border-rose-300 bg-rose-50/20'
                    : task.isStale
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleToggleComplete(task)}
                      className="text-slate-400 hover:text-emerald-600 mt-0.5 transition shrink-0 cursor-pointer"
                      title="完了にする"
                    >
                      <Square className="w-5 h-5" />
                    </button>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getPriorityBadge(task.priority)}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {task.genre}
                        </span>

                        {task.isUrgent && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700 border border-rose-200 animate-pulse flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            期日切迫！
                          </span>
                        )}

                        {task.isStale && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {task.staleDays}日放置中
                          </span>
                        )}
                      </div>

                      <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
                        {task.title}
                      </h3>

                      {task.description && (
                        <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                          {task.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1 flex-wrap">
                        {task.dueDate ? (
                          <button
                            type="button"
                            onClick={() => onOpenCalendarDate && onOpenCalendarDate(task.dueDate!)}
                            className="flex items-center gap-1 text-indigo-600 hover:underline font-bold cursor-pointer"
                            title="カレンダーで見る"
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>締切: {task.dueDate}</span>
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>期日指定なし</span>
                          </span>
                        )}

                        {task.locationName && (
                          <span className="flex items-center gap-1 text-slate-500">
                            <MapPin className="w-3.5 h-3.5 text-amber-500" />
                            <span>{task.locationName}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingTask(task)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                      title="編集"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 完了リスト（3日以内完了・薄文字表示・復活可能） ── */}
      {recentCompletedTasks.length > 0 && (
        <div className="pt-4 space-y-2 border-t border-slate-200">
          <div className="flex items-center justify-between px-1 text-xs font-bold text-slate-500">
            <span>最近完了したタスク ({recentCompletedTasks.length})</span>
            <span className="text-[10px] text-slate-400">※完了後3日間表示・自動アーカイブ</span>
          </div>

          <div className="space-y-1.5">
            {recentCompletedTasks.map((task) => (
              <div
                key={task.id}
                className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/60 flex items-center justify-between gap-2 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleToggleComplete(task)}
                    className="text-emerald-600 hover:text-slate-400 transition shrink-0 cursor-pointer"
                    title="未完了に戻す"
                  >
                    <CheckSquare className="w-5 h-5" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-400 line-through truncate">
                      {task.title}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium shrink-0">
                    {task.genre}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteTask(task.id)}
                  className="p-1 text-slate-300 hover:text-rose-600 transition"
                  title="削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── アーカイブ一覧モード切り替えボタン ── */}
      <div className="pt-2 text-center">
        <button
          type="button"
          onClick={() => setShowArchived(!showArchived)}
          className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 mx-auto py-2 px-3 rounded-xl hover:bg-slate-100 transition cursor-pointer"
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{showArchived ? 'アーカイブを閉じる' : `過去のアーカイブを見る (${archivedTasks.length})`}</span>
          {showArchived ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showArchived && (
          <div className="mt-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left space-y-2">
            <h4 className="text-xs font-bold text-slate-700">保管済みアーカイブ</h4>
            {archivedTasks.length === 0 ? (
              <p className="text-xs text-slate-400">アーカイブされたタスクはありません</p>
            ) : (
              <div className="space-y-1">
                {archivedTasks.map((t) => (
                  <div key={t.id} className="p-2 bg-white rounded-lg border border-slate-200 text-xs flex justify-between items-center text-slate-500">
                    <span className="line-through">{t.title}</span>
                    <span className="text-[10px] text-slate-400">{t.genre}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 新規タスク作成モーダル（AIが空欄事前入力 ＆ 手動調整可能） ── */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-600" />
                <span>タスクの確認・登録</span>
              </h3>
              <button type="button" onClick={() => setShowNewModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">タスク名 *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例: 見積書を作成、コーナンで塗料を買う"
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500 text-xs font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">詳細・メモ（任意）</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="寸法、数量、型番、連絡先など..."
                  rows={2}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500 text-xs resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ジャンル</label>
                  <select
                    value={newGenre}
                    onChange={(e) => setNewGenre(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {genres.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">重要度</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    <option value="S">S (至急・最優先 / 3日放置警告)</option>
                    <option value="A">A (高 / 3日放置警告)</option>
                    <option value="B">B (普通 / 7日放置警告)</option>
                    <option value="C">C (低 / 30日放置)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">締切期日</label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsNoDate}
                      onChange={(e) => {
                        setNewIsNoDate(e.target.checked);
                        if (e.target.checked) setNewDueDate('');
                      }}
                      className="rounded text-amber-500"
                    />
                    <span>期日指定なし</span>
                  </label>
                </div>
                {!newIsNoDate && (
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                )}
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">対象の場所・店名（任意）</label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="例: コーナンプロ、新井邸現場"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 font-bold"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newTitle.trim()}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? '登録中...' : 'タスクを追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 新ジャンル追加モーダル ── */}
      {showAddGenreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-xs rounded-2xl p-4 shadow-xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <h4 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-amber-600" />
              新しいジャンルを追加
            </h4>
            <form onSubmit={handleAddGenre} className="space-y-3">
              <input
                type="text"
                value={newGenreName}
                onChange={(e) => setNewGenreName(e.target.value)}
                placeholder="例: 経費、材料発注"
                required
                autoFocus
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:outline-none"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddGenreModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 font-bold"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-xs"
                >
                  追加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 既存タスク編集モーダル ── */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                <span>タスクを編集</span>
              </h3>
              <button type="button" onClick={() => setEditingTask(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateTask} className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">タスク名 *</label>
                <input
                  type="text"
                  value={editingTask.title}
                  onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none text-xs font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">詳細・メモ</label>
                <textarea
                  value={editingTask.description || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                  rows={2}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none text-xs resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ジャンル</label>
                  <select
                    value={editingTask.genre}
                    onChange={(e) => setEditingTask({ ...editingTask, genre: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {genres.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">重要度</label>
                  <select
                    value={editingTask.priority}
                    onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as any })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    <option value="S">S (至急・最優先)</option>
                    <option value="A">A (高)</option>
                    <option value="B">B (普通)</option>
                    <option value="C">C (低)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">締切期日</label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingTask.isNoDate}
                      onChange={(e) => {
                        setEditingTask({
                          ...editingTask,
                          isNoDate: e.target.checked,
                          dueDate: e.target.checked ? null : editingTask.dueDate,
                        });
                      }}
                      className="rounded text-amber-500"
                    />
                    <span>期日指定なし</span>
                  </label>
                </div>
                {!editingTask.isNoDate && (
                  <input
                    type="date"
                    value={editingTask.dueDate || ''}
                    onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                )}
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">場所・店名</label>
                <input
                  type="text"
                  value={editingTask.locationName || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, locationName: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 font-bold"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs"
                >
                  変更を保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
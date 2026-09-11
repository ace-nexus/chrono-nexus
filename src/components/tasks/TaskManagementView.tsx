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
  Sun,
  Moon,
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
  endTime?: string | null;
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

export interface VisionTaskItem {
  id: string;
  title: string;
  description: string;
  genre: string;
  priority: 'S' | 'A' | 'B' | 'C';
  dueDate: string | null;
  dueTime: string | null;
  endTime?: string | null;
  isNoDate: boolean;
  locationName: string | null;
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
  const [newDueTime, setNewDueTime] = useState<string>('');
  const [newEndTime, setNewEndTime] = useState<string>('');
  const [newIsNoDate, setNewIsNoDate] = useState<boolean>(true);
  const [newLocation, setNewLocation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // 手書きカメラ撮影タスク一括確認モーダル用状態
  const [showVisionModal, setShowVisionModal] = useState<boolean>(false);
  const [visionTasks, setVisionTasks] = useState<VisionTaskItem[]>([]);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState<boolean>(false);

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
  const { isListening, stop: stopVoice, toggle: toggleVoice, clear: clearVoice } = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => {
      setVoiceInputText(text);
    },
  });

  // 時刻が午後(12:00〜23:59)かどうかを判定
  const isPmTime = (timeStr?: string | null): boolean => {
    if (!timeStr) return false;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    return !isNaN(h) && h >= 12;
  };

  // 12時間表記の日本語表示（例: 午前 9:00 / 午後 2:30）
  const formatAmPmDisplay = (timeStr?: string | null): string => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    if (isNaN(h)) return timeStr;
    const pm = h >= 12;
    const displayH = pm ? (h === 12 ? 12 : h - 12) : h;
    return `${pm ? '午後' : '午前'} ${displayH}:${m}`;
  };

  // 時刻の AM / PM を切り替え
  const toggleTimeAmPm = (currentTime: string | null | undefined, targetAmPm: 'AM' | 'PM'): string => {
    if (!currentTime) {
      return targetAmPm === 'AM' ? '09:00' : '14:00';
    }
    const parts = currentTime.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    if (isNaN(h)) return currentTime;

    const currentIsPm = h >= 12;
    if (targetAmPm === 'AM' && currentIsPm) {
      h = h - 12;
    } else if (targetAmPm === 'PM' && !currentIsPm) {
      h = h + 12;
    }
    return `${String(h).padStart(2, '0')}:${m}`;
  };

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
        const aiGenre = (t.genre && typeof t.genre === 'string' && t.genre.trim()) ? t.genre.trim() : 'その他';
        if (aiGenre && !genres.includes(aiGenre)) {
          setGenres((prev) => Array.from(new Set([...prev, aiGenre])));
          fetch('/api/tasks/genres', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: aiGenre }),
          }).catch(console.error);
        }
        setNewGenre(aiGenre);
        setNewPriority(['S', 'A', 'B', 'C'].includes(t.priority) ? t.priority : 'B');
        setNewDueDate(t.dueDate || '');
        setNewDueTime(t.dueTime || '');
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

  // クライアント側で画像をOCR解析に最適なサイズ（長辺1600px、JPEG圧縮）に高速リサイズ
  const compressImageForOcr = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve((e.target?.result as string).split(',')[1]);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);

          // JPEG 80% で圧縮（数百KBに軽量化され、Vercelの4.5MB制限を確実に回避）
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          const base64 = dataUrl.split(',')[1];
          resolve(base64);
        };
        img.onerror = () => {
          resolve((e.target?.result as string).split(',')[1]);
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // 手書きメモのカメラ撮影 ➔ Gemini Visionでタスク抽出
  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingVision(true);
      const base64Data = await compressImageForOcr(file);
      if (!base64Data) {
        alert('画像の読み込みに失敗しました');
        return;
      }

      const res = await fetch('/api/ai/vision-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: 'image/jpeg',
          availableGenres: genres,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `通信エラー (HTTP ${res.status})`);
      }

      const data = await res.json();
      const extractedTasks = data.tasks || [];

      if (extractedTasks.length === 0) {
        alert('画像からタスクを読み取れませんでした。○印の付いた文字が写るよう、明るい場所でもう一度撮影してください。');
        return;
      }

      // 各タスクを独立したアイテムとして一括確認モーダルへ展開
      const newExtractedGenres: string[] = [];
      const items: VisionTaskItem[] = extractedTasks.map((t: any, idx: number) => {
        const itemGenre = (t.genre && typeof t.genre === 'string' && t.genre.trim()) ? t.genre.trim() : 'その他';
        if (itemGenre && !genres.includes(itemGenre) && !newExtractedGenres.includes(itemGenre)) {
          newExtractedGenres.push(itemGenre);
        }
        return {
          id: `vision_${Date.now()}_${idx}`,
          title: (t.title || '').replace(/^[○◯⚪●⭘\s]+/, '').trim() || '手書きタスク',
          description: t.description || '',
          genre: itemGenre,
          priority: ['S', 'A', 'B', 'C'].includes(t.priority) ? t.priority : 'B',
          dueDate: t.dueDate || '',
          dueTime: t.dueTime || '',
          isNoDate: Boolean(t.isNoDate || !t.dueDate),
          locationName: t.locationName || '',
        };
      });

      if (newExtractedGenres.length > 0) {
        setGenres((prev) => Array.from(new Set([...prev, ...newExtractedGenres])));
        newExtractedGenres.forEach((g) => {
          fetch('/api/tasks/genres', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: g }),
          }).catch(console.error);
        });
      }

      setVisionTasks(items);
      setShowVisionModal(true);
    } catch (vErr: any) {
      alert(`手書き解析エラー: ${vErr.message || '通信に失敗しました'}`);
    } finally {
      setIsProcessingVision(false);
      if (e.target) e.target.value = '';
    }
  };

  // 手書きタスクの一括登録
  const handleBatchRegisterVisionTasks = async () => {
    const valid = visionTasks.filter((t) => t.title.trim());
    if (valid.length === 0) {
      alert('登録するタスクがありません。タスク名を入力してください。');
      return;
    }

    try {
      setIsBatchSubmitting(true);
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: valid.map((t) => ({
            title: t.title.trim(),
            description: t.description.trim(),
            genre: t.genre,
            priority: t.priority,
            dueDate: t.isNoDate ? null : t.dueDate || null,
            dueTime: t.isNoDate ? null : t.dueTime || null,
            isAllDay: Boolean(!t.dueTime),
            isNoDate: t.isNoDate,
            locationName: t.locationName?.trim() || null,
          })),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'タスクの一括保存に失敗しました');
      }

      setShowVisionModal(false);
      setVisionTasks([]);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || '一括保存中にエラーが発生しました');
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  // 手書きタスクの個別更新ヘルパー
  const handleUpdateVisionTask = (id: string, updates: Partial<VisionTaskItem>) => {
    setVisionTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  // 手書きタスクの個別削除
  const handleDeleteVisionTask = (id: string) => {
    setVisionTasks((prev) => prev.filter((t) => t.id !== id));
  };

  // 手書きタスクに手動で1行追加
  const handleAddVisionTaskRow = () => {
    const newItem: VisionTaskItem = {
      id: `vision_${Date.now()}_${visionTasks.length}`,
      title: '',
      description: '',
      genre: 'その他',
      priority: 'B',
      dueDate: '',
      dueTime: '',
      isNoDate: true,
      locationName: '',
    };
    setVisionTasks((prev) => [...prev, newItem]);
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
          dueTime: newIsNoDate ? null : newDueTime || null,
          endTime: newIsNoDate ? null : newEndTime || null,
          isAllDay: Boolean(!newDueTime),
          isNoDate: newIsNoDate,
          locationName: newLocation.trim() || null,
        }),
      });

      if (res.ok) {
        setNewTitle('');
        setNewDescription('');
        setNewDueDate('');
        setNewDueTime('');
        setNewEndTime('');
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
    const addedName = newGenreName.trim();
    try {
      const res = await fetch('/api/tasks/genres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addedName }),
      });
      if (res.ok) {
        const d = await res.json();
        setGenres(d.genres);
        if (typeof window !== 'undefined') {
          localStorage.setItem('chrono_task_genres', JSON.stringify(d.genres));
        }
        setNewGenre(addedName);
        if (editingTask) {
          setEditingTask((prev) => prev ? { ...prev, genre: addedName } : null);
        }
        setNewGenreName('');
        setShowAddGenreModal(false);
      } else {
        const errData = await res.json();
        alert(errData.error || 'ジャンル追加に失敗しました');
      }
    } catch (err) {
      alert('ジャンル追加エラー');
    }
  };

  // ジャンル削除
  const handleDeleteGenre = async (genreName: string) => {
    if (['買い物', '見積', 'その他'].includes(genreName)) {
      alert('デフォルトジャンル（買い物・見積・その他）は削除できません');
      return;
    }
    if (!confirm(`ジャンル「${genreName}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/tasks/genres?name=${encodeURIComponent(genreName)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const d = await res.json();
        setGenres(d.genres);
        if (typeof window !== 'undefined') {
          localStorage.setItem('chrono_task_genres', JSON.stringify(d.genres));
        }
        if (selectedGenre === genreName) setSelectedGenre('all');
        if (newGenre === genreName) setNewGenre('その他');
        if (editingTask?.genre === genreName) {
          setEditingTask((prev) => prev ? { ...prev, genre: 'その他' } : null);
        }
      } else {
        const errData = await res.json();
        alert(errData.error || 'ジャンル削除に失敗しました');
      }
    } catch (err) {
      alert('ジャンル削除エラー');
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
          dueTime: editingTask.isNoDate ? null : editingTask.dueTime || null,
          endTime: editingTask.isNoDate ? null : editingTask.endTime || null,
          isAllDay: Boolean(!editingTask.dueTime),
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
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white shadow-2xs">重要度 B</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-700">重要度 C</span>;
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

          {(voiceInputText.trim() || isListening) && (
            <button
              type="button"
              onClick={() => {
                clearVoice();
                setVoiceInputText('');
              }}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition cursor-pointer shrink-0"
              title="入力をクリアしてやり直す"
            >
              <X className="w-4 h-4" />
            </button>
          )}

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
                            <span>
                              締切: {task.dueDate}
                              {task.dueTime
                                ? task.endTime
                                  ? ` ${task.dueTime}〜${task.endTime}`
                                  : ` ${task.dueTime}`
                                : ' (終日)'}
                            </span>
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700">ジャンル</label>
                    <button
                      type="button"
                      onClick={() => setShowAddGenreModal(true)}
                      className="text-[10px] text-amber-600 hover:text-amber-700 font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      ＋新規追加
                    </button>
                  </div>
                  <select
                    value={newGenre}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setShowAddGenreModal(true);
                      } else {
                        setNewGenre(e.target.value);
                      }
                    }}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {Array.from(new Set([...genres, newGenre])).filter(Boolean).map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                    <option value="__NEW__">＋ 新しいジャンルを追加...</option>
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
                  <label className="font-bold text-slate-700">締切期日・時間</label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsNoDate}
                      onChange={(e) => {
                        setNewIsNoDate(e.target.checked);
                        if (e.target.checked) {
                          setNewDueDate('');
                          setNewDueTime('');
                        }
                      }}
                      className="rounded text-amber-500"
                    />
                    <span>期日指定なし</span>
                  </label>
                </div>
                {!newIsNoDate && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-0.5">締切日付 *</label>
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        required={!newIsNoDate}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>

                    {/* 時間設定カード（午前/午後が明瞭で切り替えやすいUI） */}
                    <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 text-xs">
                      {/* 開始時間 */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-700 font-bold text-xs shrink-0 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            開始時間:
                          </span>
                          <input
                            type="time"
                            value={newDueTime}
                            onChange={(e) => setNewDueTime(e.target.value)}
                            className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                            title="開始時間"
                          />
                          {newDueTime && (
                            <button
                              type="button"
                              onClick={() => {
                                setNewDueTime('');
                                setNewEndTime('');
                              }}
                              className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                              title="時間をクリア"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {newDueTime ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              {formatAmPmDisplay(newDueTime)}
                            </span>
                            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                              <button
                                type="button"
                                onClick={() => setNewDueTime(toggleTimeAmPm(newDueTime, 'AM'))}
                                className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                  !isPmTime(newDueTime)
                                    ? 'bg-sky-600 text-white font-extrabold shadow-inner'
                                    : 'bg-white text-slate-500 hover:bg-slate-100'
                                }`}
                                title="午前 (AM) に切り替え"
                              >
                                <Sun className="w-3 h-3" />
                                午前
                              </button>
                              <button
                                type="button"
                                onClick={() => setNewDueTime(toggleTimeAmPm(newDueTime, 'PM'))}
                                className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                  isPmTime(newDueTime)
                                    ? 'bg-amber-600 text-white font-extrabold shadow-inner'
                                    : 'bg-white text-slate-500 hover:bg-slate-100'
                                }`}
                                title="午後 (PM) に切り替え"
                              >
                                <Moon className="w-3 h-3" />
                                午後
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">空欄＝終日扱い</span>
                        )}
                      </div>

                      {/* 終了時間 */}
                      {newDueTime && (
                        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200/80 pt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-700 font-bold text-xs shrink-0 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              終了時間:
                            </span>
                            <input
                              type="time"
                              value={newEndTime}
                              onChange={(e) => setNewEndTime(e.target.value)}
                              className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                              title="終了時間"
                            />
                            {newEndTime && (
                              <button
                                type="button"
                                onClick={() => setNewEndTime('')}
                                className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                title="終了時間をクリア"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {newEndTime ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                {formatAmPmDisplay(newEndTime)}
                              </span>
                              <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => setNewEndTime(toggleTimeAmPm(newEndTime, 'AM'))}
                                  className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                    !isPmTime(newEndTime)
                                      ? 'bg-sky-600 text-white font-extrabold shadow-inner'
                                      : 'bg-white text-slate-500 hover:bg-slate-100'
                                  }`}
                                  title="午前 (AM) に切り替え"
                                >
                                  <Sun className="w-3 h-3" />
                                  午前
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNewEndTime(toggleTimeAmPm(newEndTime, 'PM'))}
                                  className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                    isPmTime(newEndTime)
                                      ? 'bg-amber-600 text-white font-extrabold shadow-inner'
                                      : 'bg-white text-slate-500 hover:bg-slate-100'
                                  }`}
                                  title="午後 (PM) に切り替え"
                                >
                                  <Moon className="w-3 h-3" />
                                  午後
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const parts = newDueTime.split(':');
                                const nextH = Math.min(23, (parseInt(parts[0], 10) || 0) + 1);
                                setNewEndTime(`${String(nextH).padStart(2, '0')}:${parts[1] || '00'}`);
                              }}
                              className="text-[11px] text-amber-700 font-semibold hover:underline cursor-pointer"
                            >
                              + 終了時間を設定
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-600" />
                新しいジャンルを追加
              </h4>
              <button
                type="button"
                onClick={() => setShowAddGenreModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddGenre} className="space-y-3">
              <input
                type="text"
                value={newGenreName}
                onChange={(e) => setNewGenreName(e.target.value)}
                placeholder="例: 塗装、現調、経費、材料発注"
                required
                autoFocus
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:border-amber-500"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddGenreModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-xs cursor-pointer"
                >
                  追加・保存
                </button>
              </div>
            </form>

            {/* 登録済みカスタムジャンル一覧（削除も可能） */}
            {genres.filter((g) => !['買い物', '見積', 'その他'].includes(g)).length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 mb-1.5">追加済みカスタムジャンル:</p>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {genres
                    .filter((g) => !['買い物', '見積', 'その他'].includes(g))
                    .map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-medium"
                      >
                        <span>{g}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteGenre(g)}
                          className="text-slate-400 hover:text-rose-500 cursor-pointer"
                          title={`ジャンル「${g}」を削除`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            )}
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700">ジャンル</label>
                    <button
                      type="button"
                      onClick={() => setShowAddGenreModal(true)}
                      className="text-[10px] text-amber-600 hover:text-amber-700 font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      ＋新規追加
                    </button>
                  </div>
                  <select
                    value={editingTask.genre}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setShowAddGenreModal(true);
                      } else {
                        setEditingTask({ ...editingTask, genre: e.target.value });
                      }
                    }}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {Array.from(new Set([...genres, editingTask.genre])).filter(Boolean).map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                    <option value="__NEW__">＋ 新しいジャンルを追加...</option>
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
                  <label className="font-bold text-slate-700">締切期日・時間</label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingTask.isNoDate}
                      onChange={(e) => {
                        setEditingTask({
                          ...editingTask,
                          isNoDate: e.target.checked,
                          dueDate: e.target.checked ? null : editingTask.dueDate,
                          dueTime: e.target.checked ? null : editingTask.dueTime,
                        });
                      }}
                      className="rounded text-amber-500"
                    />
                    <span>期日指定なし</span>
                  </label>
                </div>
                {!editingTask.isNoDate && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-0.5">締切日付 *</label>
                      <input
                        type="date"
                        value={editingTask.dueDate || ''}
                        onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>

                    {/* 時間設定カード（午前/午後が明瞭で切り替えやすいUI） */}
                    <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 text-xs">
                      {/* 開始時間 */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-700 font-bold text-xs shrink-0 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            開始時間:
                          </span>
                          <input
                            type="time"
                            value={editingTask.dueTime || ''}
                            onChange={(e) => setEditingTask({ ...editingTask, dueTime: e.target.value || null })}
                            className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                            title="開始時間"
                          />
                          {editingTask.dueTime && (
                            <button
                              type="button"
                              onClick={() => setEditingTask({ ...editingTask, dueTime: null, endTime: null })}
                              className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                              title="時間をクリア"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {editingTask.dueTime ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              {formatAmPmDisplay(editingTask.dueTime)}
                            </span>
                            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                              <button
                                type="button"
                                onClick={() => setEditingTask({ ...editingTask, dueTime: toggleTimeAmPm(editingTask.dueTime, 'AM') })}
                                className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                  !isPmTime(editingTask.dueTime)
                                    ? 'bg-sky-600 text-white font-extrabold shadow-inner'
                                    : 'bg-white text-slate-500 hover:bg-slate-100'
                                }`}
                                title="午前 (AM) に切り替え"
                              >
                                <Sun className="w-3 h-3" />
                                午前
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTask({ ...editingTask, dueTime: toggleTimeAmPm(editingTask.dueTime, 'PM') })}
                                className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                  isPmTime(editingTask.dueTime)
                                    ? 'bg-amber-600 text-white font-extrabold shadow-inner'
                                    : 'bg-white text-slate-500 hover:bg-slate-100'
                                }`}
                                title="午後 (PM) に切り替え"
                              >
                                <Moon className="w-3 h-3" />
                                午後
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">空欄＝終日扱い</span>
                        )}
                      </div>

                      {/* 終了時間 */}
                      {editingTask.dueTime && (
                        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200/80 pt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-700 font-bold text-xs shrink-0 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              終了時間:
                            </span>
                            <input
                              type="time"
                              value={editingTask.endTime || ''}
                              onChange={(e) => setEditingTask({ ...editingTask, endTime: e.target.value || null })}
                              className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                              title="終了時間"
                            />
                            {editingTask.endTime && (
                              <button
                                type="button"
                                onClick={() => setEditingTask({ ...editingTask, endTime: null })}
                                className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                title="終了時間をクリア"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {editingTask.endTime ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                {formatAmPmDisplay(editingTask.endTime)}
                              </span>
                              <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => setEditingTask({ ...editingTask, endTime: toggleTimeAmPm(editingTask.endTime, 'AM') })}
                                  className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                    !isPmTime(editingTask.endTime)
                                      ? 'bg-sky-600 text-white font-extrabold shadow-inner'
                                      : 'bg-white text-slate-500 hover:bg-slate-100'
                                  }`}
                                  title="午前 (AM) に切り替え"
                                >
                                  <Sun className="w-3 h-3" />
                                  午前
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTask({ ...editingTask, endTime: toggleTimeAmPm(editingTask.endTime, 'PM') })}
                                  className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                    isPmTime(editingTask.endTime)
                                      ? 'bg-amber-600 text-white font-extrabold shadow-inner'
                                      : 'bg-white text-slate-500 hover:bg-slate-100'
                                  }`}
                                  title="午後 (PM) に切り替え"
                                >
                                  <Moon className="w-3 h-3" />
                                  午後
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const parts = editingTask.dueTime!.split(':');
                                const nextH = Math.min(23, (parseInt(parts[0], 10) || 0) + 1);
                                setEditingTask({
                                  ...editingTask,
                                  endTime: `${String(nextH).padStart(2, '0')}:${parts[1] || '00'}`,
                                });
                              }}
                              className="text-[11px] text-amber-700 font-semibold hover:underline cursor-pointer"
                            >
                              + 終了時間を設定
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
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

      {/* ── 手書きカメラ撮影タスク一括確認・登録モーダル ── */}
      {showVisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* ヘッダー */}
            <div className="px-5 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                  <Camera className="w-5 h-5 text-amber-100" />
                </div>
                <div>
                  <h3 className="font-bold text-base leading-tight">
                    手書きメモからタスク抽出 ({visionTasks.length}件)
                  </h3>
                  <p className="text-[11px] text-amber-100/90">
                    ○の付いた各項目を個別のタスクとして認識しました
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVisionModal(false)}
                className="p-1.5 rounded-xl hover:bg-white/20 text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* タスク一覧リスト（スクロール可能） */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3 bg-slate-50/50">
              {visionTasks.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  タスクがありません。「＋タスクを追加」を押してください。
                </div>
              ) : (
                visionTasks.map((item, idx) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl p-3 sm:p-3.5 border border-slate-200 shadow-2xs space-y-2.5 relative group"
                  >
                    {/* タスク上部: 番号バッジ & 削除ボタン */}
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        <span>○ タスク {idx + 1}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteVisionTask(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="このタスクを除外"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* タスク名入力 */}
                    <div>
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => handleUpdateVisionTask(item.id, { title: e.target.value })}
                        placeholder="やるべきこと・タスク名 *"
                        className="w-full font-bold text-slate-900 text-xs sm:text-sm bg-slate-50 focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl px-3 py-2 outline-none transition"
                      />
                    </div>

                    {/* 詳細メタ情報（ジャンル、重要度、締切日） */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {/* ジャンル */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-bold text-slate-500">ジャンル</label>
                          <button
                            type="button"
                            onClick={() => setShowAddGenreModal(true)}
                            className="text-[9px] text-amber-600 hover:text-amber-700 font-bold flex items-center gap-0.5 cursor-pointer"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            追加
                          </button>
                        </div>
                        <select
                          value={item.genre}
                          onChange={(e) => {
                            if (e.target.value === '__NEW__') {
                              setShowAddGenreModal(true);
                            } else {
                              handleUpdateVisionTask(item.id, { genre: e.target.value });
                            }
                          }}
                          className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                        >
                          {Array.from(new Set([...genres, item.genre])).filter(Boolean).map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                          <option value="__NEW__">＋ 新規追加...</option>
                        </select>
                      </div>

                      {/* 重要度 */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">重要度</label>
                        <select
                          value={item.priority}
                          onChange={(e) => handleUpdateVisionTask(item.id, { priority: e.target.value as any })}
                          className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                        >
                          <option value="S">S (至急・最優先)</option>
                          <option value="A">A (急ぎ)</option>
                          <option value="B">B (普通)</option>
                          <option value="C">C (低)</option>
                        </select>
                      </div>

                      {/* 期日 ＆ 時間 */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-bold text-slate-500">締切期日・時間</label>
                          <label className="flex items-center gap-0.5 text-[9px] text-slate-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.isNoDate}
                              onChange={(e) =>
                                handleUpdateVisionTask(item.id, {
                                  isNoDate: e.target.checked,
                                  dueDate: e.target.checked ? null : item.dueDate,
                                  dueTime: e.target.checked ? null : item.dueTime,
                                })
                              }
                              className="rounded text-amber-500 w-3 h-3"
                            />
                            <span>なし</span>
                          </label>
                        </div>
                        {!item.isNoDate ? (
                          <div className="grid grid-cols-2 gap-1">
                            <input
                              type="date"
                              value={item.dueDate || ''}
                              onChange={(e) => handleUpdateVisionTask(item.id, { dueDate: e.target.value })}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                              title="日付"
                            />
                            <input
                              type="time"
                              value={item.dueTime || ''}
                              onChange={(e) => handleUpdateVisionTask(item.id, { dueTime: e.target.value || null })}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                              title="時間（空欄＝終日）"
                            />
                          </div>
                        ) : (
                          <div className="p-1.5 bg-slate-100 rounded-lg text-[11px] text-slate-400 text-center font-medium">
                            期日指定なし
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 場所・メモ入力 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-0.5">
                      <input
                        type="text"
                        value={item.locationName || ''}
                        onChange={(e) => handleUpdateVisionTask(item.id, { locationName: e.target.value })}
                        placeholder="場所・現場名（任意）"
                        className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      />
                      <input
                        type="text"
                        value={item.description || ''}
                        onChange={(e) => handleUpdateVisionTask(item.id, { description: e.target.value })}
                        placeholder="メモ・補足・寸法など（任意）"
                        className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                ))
              )}

              {/* タスク追加ボタン */}
              <button
                type="button"
                onClick={handleAddVisionTaskRow}
                className="w-full py-2.5 border-2 border-dashed border-slate-200 hover:border-amber-400 hover:bg-amber-50/50 rounded-2xl text-xs font-bold text-slate-500 hover:text-amber-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>タスクを1件手動追加</span>
              </button>
            </div>

            {/* フッターアクション */}
            <div className="p-3.5 sm:p-4 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shadow-xs">
              <button
                type="button"
                onClick={() => setShowVisionModal(false)}
                className="px-4 py-2.5 rounded-xl text-slate-500 hover:bg-slate-100 font-bold text-xs cursor-pointer"
              >
                破棄して閉じる
              </button>

              <button
                type="button"
                onClick={handleBatchRegisterVisionTasks}
                disabled={isBatchSubmitting || visionTasks.filter((t) => t.title.trim()).length === 0}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold rounded-xl text-xs shadow-md disabled:opacity-40 flex items-center gap-1.5 active:scale-95 transition cursor-pointer"
              >
                {isBatchSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    一括登録中...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{visionTasks.filter((t) => t.title.trim()).length}件のタスクを一括登録</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
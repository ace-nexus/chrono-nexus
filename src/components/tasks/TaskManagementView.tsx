'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';

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

  // 新ジャンル追加ダイアログ用状態
  const [showAddGenreModal, setShowAddGenreModal] = useState<boolean>(false);
  const [newGenreName, setNewGenreName] = useState<string>('');

  // 編集モーダル用状態
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

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
    try {
      const res = await fetch('/api/tasks/genres');
      if (res.ok) {
        const data = await res.json();
        if (data.genres) setGenres(data.genres);
      }
    } catch (err) {
      console.error('Fetch genres error:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchGenres();
  }, []);

  // タスク完了トグル
  const handleToggleComplete = async (task: TaskItem) => {
    const nextCompleted = !task.isCompleted;
    // UIを先行反映
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

    // ジャンルフィルタ
    if (selectedGenre !== 'all') {
      list = list.filter((t) => t.genre === selectedGenre);
    }

    // 検索フィルタ
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

  // 重要度バッジのスタイリング
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
      {/* ── ヘッダー ＆ 新規タスク追加ボタン ── */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm shadow-xs">
              📋
            </span>
            <span>タスク管理</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {activeTasks.length}件 未完了
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            思いつきを仕分け・重要度アラート・完了後3日で自動アーカイブ
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新規タスク</span>
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
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-700'
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
            className="px-2 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:text-amber-600 hover:bg-amber-50 border border-dashed border-slate-300 flex items-center gap-1 shrink-0 transition cursor-pointer"
            title="新しいジャンルを追加"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>追加</span>
          </button>
        </div>
      </div>

      {/* ── 未完了タスク一覧 ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 text-xs font-bold text-slate-600">
          <span>未完了タスク ({activeTasks.length})</span>
          {activeTasks.some((t) => t.isUrgent || t.isStale) && (
            <span className="text-rose-600 flex items-center gap-1 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>注意タスクあり</span>
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs">タスクを読み込み中...</p>
          </div>
        ) : activeTasks.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
            <p className="text-sm font-bold text-slate-600">タスクはありません</p>
            <p className="text-xs mt-1 text-slate-400">
              「新規タスク」または右下の「一括AIマイク」からいつでも追加できます
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className={`bg-white rounded-2xl p-3.5 border transition shadow-2xs hover:shadow-xs space-y-2 ${
                  task.isUrgent
                    ? 'border-rose-400 bg-rose-50/20'
                    : task.isStale
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {/* チェックボックス */}
                    <button
                      type="button"
                      onClick={() => handleToggleComplete(task)}
                      className="mt-0.5 text-slate-400 hover:text-amber-500 transition shrink-0 cursor-pointer"
                    >
                      <Square className="w-5 h-5" />
                    </button>

                    <div className="min-w-0 flex-1">
                      {/* タイトル */}
                      <p className="text-sm font-black text-slate-900 break-words leading-snug">
                        {task.title}
                      </p>

                      {/* 詳細説明 */}
                      {task.description && (
                        <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap leading-relaxed">
                          {task.description}
                        </p>
                      )}

                      {/* メタ情報バッジ */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
                        {/* 重要度 */}
                        {getPriorityBadge(task.priority)}

                        {/* ジャンル */}
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                          {task.genre}
                        </span>

                        {/* 期日 */}
                        {!task.isNoDate && task.dueDate && (
                          <span
                            onClick={() => onOpenCalendarDate && onOpenCalendarDate(task.dueDate!)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition ${
                              task.isUrgent
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                            title="カレンダーで該当日を表示"
                          >
                            <Calendar className="w-3 h-3 shrink-0" />
                            <span>{task.dueDate}</span>
                            {task.dueTime && <span>{task.dueTime}</span>}
                          </span>
                        )}

                        {/* 放置アラート */}
                        {task.isStale && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{task.staleDays}日放置</span>
                          </span>
                        )}

                        {/* 場所 */}
                        {task.locationName && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            <span>{task.locationName}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 操作ボタン */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingTask(task)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                      title="編集"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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

      {/* ── 新規タスク作成モーダル ── */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-600" />
                <span>新しいタスクを追加</span>
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
                  placeholder="例: 見積書を作成、コピー用紙を買う"
                  required
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500 text-xs font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">詳細・メモ（任意）</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="寸法、数量、連絡事項など..."
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
                    <option value="B">B (中・標準 / 7日放置警告)</option>
                    <option value="C">C (低・いつでも / 30日放置)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">締切期日</label>
                  <button
                    type="button"
                    onClick={() => setNewIsNoDate(!newIsNoDate)}
                    className="text-[11px] text-amber-600 font-bold hover:underline"
                  >
                    {newIsNoDate ? '期日を設定する' : '期日なしにする'}
                  </button>
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
                <label className="font-bold text-slate-700 block mb-1">場所・現場（場所連動通知用）</label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="例: ホームセンター、新井邸"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || isSubmitting}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? '追加中...' : '追加する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ジャンル追加モーダル ── */}
      {showAddGenreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">新しいジャンルの追加</h3>
            <form onSubmit={handleAddGenre} className="space-y-3">
              <input
                type="text"
                value={newGenreName}
                onChange={(e) => setNewGenreName(e.target.value)}
                placeholder="ジャンル名 (例: 資材発注、現場確認)"
                required
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-amber-500"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddGenreModal(false)} className="px-3 py-1.5 text-xs text-slate-500">
                  キャンセル
                </button>
                <button type="submit" className="px-4 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl shadow-xs">
                  追加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 編集モーダル ── */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">タスクの編集</h3>
            <form onSubmit={handleUpdateTask} className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">タスク名</label>
                <input
                  type="text"
                  value={editingTask.title}
                  onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ジャンル</label>
                  <select
                    value={editingTask.genre}
                    onChange={(e) => setEditingTask({ ...editingTask, genre: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
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
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="S">S (至急)</option>
                    <option value="A">A (高)</option>
                    <option value="B">B (中)</option>
                    <option value="C">C (低)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingTask(null)} className="px-3 py-1.5 text-xs text-slate-500">
                  キャンセル
                </button>
                <button type="submit" className="px-4 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl shadow-xs">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
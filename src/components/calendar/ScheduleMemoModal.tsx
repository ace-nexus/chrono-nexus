'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useContinuousSpeechRecognition } from '@/lib/useContinuousSpeechRecognition';
import {
  X,
  Mic,
  MicOff,
  Trash2,
  Save,
  Clock,
  FileText,
  Loader2,
  Sparkles,
  RotateCcw,
  Plus,
  Check,
  Calendar,
} from 'lucide-react';

export interface ScheduleMemoTarget {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  description?: string | null;
  raw_payload?: {
    memo?: string | null;
    color?: string;
    isAllDay?: boolean;
    [key: string]: any;
  } | null;
}

export interface DetectedTaskItem {
  id: string;
  title: string;
  date: string;
  startTime?: string | null;
  isAllDay: boolean;
  isAdding?: boolean;
  added?: boolean;
}

interface ScheduleMemoModalProps {
  isOpen: boolean;
  schedule: ScheduleMemoTarget | null;
  onClose: () => void;
  onSave: (scheduleId: string, memo: string) => Promise<void>;
  onDelete: (scheduleId: string) => Promise<void>;
  onAddSchedule?: (
    data: {
      title: string;
      startTime: string;
      endTime?: string | null;
      color?: string;
      isAllDay?: boolean;
    },
    targetDate?: string
  ) => Promise<void>;
}

// 音声認識チャンクの重複・累積成長・部分重複を排除して綺麗に結合する関数
function mergeTranscripts(chunks: string[]): string {
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
}

export default function ScheduleMemoModal({
  isOpen,
  schedule,
  onClose,
  onSave,
  onDelete,
  onAddSchedule,
}: ScheduleMemoModalProps) {
  const [memoText, setMemoText] = useState<string>('');
  const [backupText, setBackupText] = useState<string | null>(null);
  const [detectedTasks, setDetectedTasks] = useState<DetectedTaskItem[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isFormatting, setIsFormatting] = useState<boolean>(false);
  const [refineInstruction, setRefineInstruction] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);

  // 堅牢な音声認識フックの接続（メモ本文用 ＆ 微修正指示用）
  const memoVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setMemoText(text),
  });

  const refineVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setRefineInstruction(text),
  });

  // 初期値セット & クリーンアップ
  useEffect(() => {
    if (schedule && isOpen) {
      const initialMemo =
        schedule.raw_payload?.memo ?? schedule.description ?? '';
      setMemoText(initialMemo);
      setBackupText(null);
      setDetectedTasks([]);
    } else {
      setMemoText('');
      setBackupText(null);
      setDetectedTasks([]);
    }
    memoVoice.stop();
    refineVoice.stop();
    memoVoice.reset();
    refineVoice.reset();
  }, [schedule, isOpen]);

  // 音声認識のトグル
  const toggleVoiceInput = () => {
    memoVoice.toggle(memoText);
  };

  // AIで文を整える機能（Gemini API呼び出し ＋ タスク自動抽出）
  const handleAiFormat = async () => {
    if (isFormatting || !memoText.trim()) return;
    try {
      // 音声認識中なら停止
      memoVoice.stop();
      refineVoice.stop();

      setIsFormatting(true);
      // 元の文章をバックアップ
      setBackupText(memoText);

      // 基準日時（予定の開始日時または今日の日付）を特定
      let dateStr = new Date().toISOString().split('T')[0];
      let dayOfWeekStr = '';
      if (schedule?.start_time) {
        const refD = new Date(schedule.start_time);
        if (!isNaN(refD.getTime())) {
          dateStr = refD.toISOString().split('T')[0];
          dayOfWeekStr = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][refD.getDay()] || '';
        }
      }

      const res = await fetch('/api/ai/format-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: memoText,
          scheduleTitle: schedule?.title || '',
          currentDate: dateStr,
          currentDayOfWeek: dayOfWeekStr,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI整形に失敗しました');
      }

      const data = await res.json();
      if (data.formattedText) {
        setMemoText(data.formattedText);
        memoVoice.reset();
      }
      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        setDetectedTasks(data.tasks);
      } else {
        setDetectedTasks([]);
      }
    } catch (err: any) {
      alert(`AI整形エラー: ${err.message}`);
    } finally {
      setIsFormatting(false);
    }
  };

  // 検出タスクのフィールド修正（タイトル、日付、時間など）
  const updateTaskField = (index: number, field: keyof DetectedTaskItem, value: any) => {
    setDetectedTasks((prev) =>
      prev.map((t, idx) => (idx === index ? { ...t, [field]: value } : t))
    );
  };

  // 検出タスクの破棄・スキップ（カレンダーには追加しない）
  const removeTask = (index: number) => {
    setDetectedTasks((prev) => prev.filter((_, idx) => idx !== index));
  };

  // タスクをワンタップでカレンダーに予定として追加
  const handleAddScheduleFromTask = async (index: number) => {
    if (!onAddSchedule) {
      alert('予定追加機能が連携されていません');
      return;
    }
    const task = detectedTasks[index];
    if (!task || !task.title.trim() || !task.date) return;

    updateTaskField(index, 'isAdding', true);
    try {
      let startIso: string;
      let endIso: string | null = null;

      if (task.isAllDay || !task.startTime) {
        // 終日予定
        startIso = `${task.date}T00:00:00+09:00`;
        endIso = null;
      } else {
        // 時間指定予定
        startIso = `${task.date}T${task.startTime}:00+09:00`;
        const [h, m] = task.startTime.split(':').map((v) => parseInt(v, 10) || 0);
        const endH = Math.min(23, h + 1).toString().padStart(2, '0');
        endIso = `${task.date}T${endH}:${m.toString().padStart(2, '0')}:00+09:00`;
      }

      await onAddSchedule(
        {
          title: task.title.trim(),
          startTime: startIso,
          endTime: endIso,
          isAllDay: task.isAllDay,
        },
        task.date
      );

      // 追加完了フラグをセット
      setDetectedTasks((prev) =>
        prev.map((t, idx) =>
          idx === index ? { ...t, isAdding: false, added: true } : t
        )
      );
    } catch (err: any) {
      updateTaskField(index, 'isAdding', false);
      alert(`カレンダー追加エラー: ${err.message || '追加に失敗しました'}`);
    }
  };

  // 元の文章に戻す機能
  const handleRestoreBackup = () => {
    if (backupText !== null) {
      setMemoText(backupText);
      setBackupText(null);
    }
  };

  // 対話型AI微修正（ユーザーの自由指示で再整形）
  const handleRefineMemo = async () => {
    if (isRefining || !refineInstruction.trim() || !memoText.trim()) return;
    try {
      setIsRefining(true);
      const res = await fetch('/api/ai/refine-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentText: memoText,
          instruction: refineInstruction.trim(),
          originalText: backupText || undefined,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || '微修正に失敗しました');
      }

      const data = await res.json();
      if (data.refinedText) {
        if (!backupText) {
          setBackupText(memoText);
        }
        setMemoText(data.refinedText);
        memoVoice.reset();
        refineVoice.reset();
        setRefineInstruction('');
      }
    } catch (err: any) {
      alert(`AI微修正エラー: ${err.message}`);
    } finally {
      setIsRefining(false);
    }
  };

  // 微修正用マイク入力トグル
  const toggleRefineVoice = () => {
    refineVoice.toggle(refineInstruction);
  };

  if (!isOpen || !schedule) return null;

  // 時間フォーマット
  const isAllDay = schedule.raw_payload?.isAllDay;
  let timeLabel = '終日';
  if (!isAllDay && schedule.start_time) {
    const sDate = new Date(schedule.start_time);
    const sTime = sDate.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (schedule.end_time) {
      const eDate = new Date(schedule.end_time);
      const eTime = eDate.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      timeLabel = `${sTime} 〜 ${eTime}`;
    } else {
      timeLabel = `${sTime} 〜`;
    }
  }

  // 既存メモが存在するか判定
  const existingMemo =
    schedule.raw_payload?.memo ?? schedule.description ?? '';
  const hasExistingMemo = Boolean(existingMemo && existingMemo.trim().length > 0);

  // 保存処理
  const handleSave = async () => {
    if (isSaving) return;
    try {
      setIsSaving(true);
      const finalMemoToSave = memoText.trim();
      memoVoice.stop();
      refineVoice.stop();
      memoVoice.reset();
      refineVoice.reset();
      await onSave(schedule.id, finalMemoToSave);
      onClose();
    } catch (err: any) {
      alert(`保存に失敗しました: ${err.message || '通信エラー'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 削除処理（確認ダイアログ必須）
  const handleDelete = async () => {
    if (isDeleting) return;
    if (!confirm('この予定メモを削除してもよろしいですか？')) {
      return;
    }
    try {
      setIsDeleting(true);
      memoVoice.stop(); refineVoice.stop();
      await onDelete(schedule.id);
      onClose();
    } catch (err: any) {
      alert(`削除に失敗しました: ${err.message || '通信エラー'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => {
        memoVoice.stop(); refineVoice.stop();
        onClose();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] animate-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50/40">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-slate-900 truncate">
                {schedule.title}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mt-0.5">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{timeLabel}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              memoVoice.stop(); refineVoice.stop();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition shrink-0 cursor-pointer"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* コンテンツ入力エリア */}
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>予定メモ・現場記録</span>
              {hasExistingMemo && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800">
                  記録あり
                </span>
              )}
            </label>

            {/* 上部ボタングループ（音声入力 ＆ AIで整える） */}
            <div className="flex items-center gap-1.5">
              {/* ✨ AIで整えるボタン */}
              <button
                type="button"
                onClick={handleAiFormat}
                disabled={isFormatting || !memoText.trim()}
                className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-2xs transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="音声メモの誤字・誤変換をAIで綺麗に清書します"
              >
                {isFormatting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>AI清書中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AIで整える</span>
                  </>
                )}
              </button>

              {/* やり直し・クリアボタン */}
              {(memoText.trim() || memoVoice.isListening) && (
                <button
                  type="button"
                  onClick={() => {
                    memoVoice.clear();
                    setMemoText('');
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition flex items-center gap-1 cursor-pointer"
                  title="メモを全消去して最初からやり直す"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>やり直す</span>
                </button>
              )}

              {/* 🎤 音声入力トグルボタン（タップで開始、タップで停止まで時間無制限自動継続） */}
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  memoVoice.isListening
                    ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                title={
                  memoVoice.isListening
                    ? 'タップして音声入力を停止'
                    : 'タップして音声入力を開始（話終わったら再度タップ）'
                }
              >
                {memoVoice.isListening ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" />
                    <span>録音中（タップで停止）</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-slate-500" />
                    <span>音声入力</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <textarea
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            rows={6}
            placeholder="現場に誰が来ていたか、経費、指示・決定事項などをメモ...（音声入力やAI清書も利用可能）"
            className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none transition resize-none placeholder:text-slate-400 leading-relaxed"
          />

          {/* 対話型AI微修正バー（ユーザーの自由な追加指示で再整形） */}
          {memoText.trim().length > 0 && (
            <div className="p-3 bg-violet-50/80 border border-violet-200/90 rounded-2xl space-y-2 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs font-bold text-violet-900">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                  <span>AIに微修正を指示（音声・文字）</span>
                </div>
                {backupText !== null && (
                  <button
                    type="button"
                    onClick={handleRestoreBackup}
                    className="text-[11px] text-violet-700 hover:text-violet-900 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                    title="整形前の文章に戻す"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>元に戻す</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleRefineMemo();
                    }
                  }}
                  placeholder="例: もっと短く、箇条書き増やして、金額を目立たせて..."
                  className="flex-1 p-2 text-xs bg-white border border-violet-200 rounded-xl focus:outline-none focus:border-violet-500 font-medium placeholder:text-slate-400"
                />

                {/* 音声入力ボタン */}
                <button
                  type="button"
                  onClick={toggleRefineVoice}
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    refineVoice.isListening
                      ? 'bg-rose-500 text-white animate-pulse shadow-xs'
                      : 'bg-white hover:bg-violet-100 text-violet-700 border border-violet-200'
                  }`}
                  title="音声で指示を話す"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>

                {/* 送信ボタン */}
                <button
                  type="button"
                  onClick={handleRefineMemo}
                  disabled={isRefining || !refineInstruction.trim()}
                  className="py-2 px-3 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition cursor-pointer"
                >
                  {isRefining ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>修正</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── AI検出タスクカード（修正可能 ＆ ワンタップでカレンダー予定追加） ── */}
          {detectedTasks.length > 0 && (
            <div className="space-y-2 p-3 bg-gradient-to-br from-amber-50/80 to-orange-50/60 border border-amber-200/90 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>AI検出タスク ({detectedTasks.length}件)</span>
                </div>
                <span className="text-[10px] text-amber-700">
                  ※修正可・タップした時のみ予定に追加
                </span>
              </div>

              <div className="space-y-2 pt-1">
                {detectedTasks.map((task, idx) => (
                  <div
                    key={task.id || idx}
                    className="bg-white p-2.5 rounded-xl border border-amber-200/60 shadow-2xs space-y-2"
                  >
                    {/* タスク内容入力（修正可能） */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={task.title}
                        onChange={(e) => updateTaskField(idx, 'title', e.target.value)}
                        placeholder="タスク内容を入力（修正可能）"
                        className="flex-1 text-xs font-bold text-slate-800 p-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-amber-400 transition"
                      />
                      <button
                        type="button"
                        onClick={() => removeTask(idx)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition shrink-0 cursor-pointer"
                        title="このタスクを追加しない"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 日時設定 ＆ カレンダー追加ボタン */}
                    <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <div className="flex items-center gap-1.5 text-xs flex-wrap">
                        {/* 日付入力 */}
                        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                          <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                          <input
                            type="date"
                            value={task.date}
                            onChange={(e) => updateTaskField(idx, 'date', e.target.value)}
                            className="text-xs bg-transparent text-slate-700 font-medium focus:outline-none"
                          />
                        </div>

                        {/* 時間 or 終日トグル */}
                        {task.isAllDay ? (
                          <button
                            type="button"
                            onClick={() => updateTaskField(idx, 'isAllDay', false)}
                            className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
                            title="クリックして時間を指定"
                          >
                            終日
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="time"
                              value={task.startTime || '09:00'}
                              onChange={(e) => updateTaskField(idx, 'startTime', e.target.value)}
                              className="text-xs p-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateTaskField(idx, 'isAllDay', true)}
                              className="text-[10px] text-slate-400 hover:text-slate-600 underline cursor-pointer"
                            >
                              終日
                            </button>
                          </div>
                        )}
                      </div>

                      {/* ワンタップでカレンダーに追加 */}
                      <div className="shrink-0 ml-auto sm:ml-0">
                        {task.added ? (
                          <div className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                            <Check className="w-3.5 h-3.5" />
                            <span>カレンダー追加済</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddScheduleFromTask(idx)}
                            disabled={task.isAdding || !task.title.trim() || !task.date}
                            className="px-2.5 py-1 text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:from-amber-700 active:to-orange-700 text-white rounded-lg shadow-2xs flex items-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="このタスクを予定としてカレンダーに登録します"
                          >
                            {task.isAdding ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>追加中...</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>＋ カレンダーに追加</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed">
            ※ 音声入力はタップして開始し、話し終わったらもう一度タップして停止します。話した内容は「AIで整える」でいつでも綺麗に清書できます。
          </p>
        </div>

        {/* フッター操作ボタン */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
          {/* 削除（ごみ箱）ボタン（メモがある場合のみ表示、削除前確認あり） */}
          <div>
            {hasExistingMemo ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || isSaving || isFormatting}
                className="py-2 px-3 rounded-xl border border-rose-200 hover:bg-rose-50 active:bg-rose-100 text-rose-600 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                title="この予定のメモを削除する"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>削除</span>
              </button>
            ) : (
              <div />
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                memoVoice.stop(); refineVoice.stop();
                onClose();
              }}
              disabled={isSaving || isDeleting || isFormatting}
              className="py-2.5 px-3.5 rounded-xl hover:bg-slate-200 text-slate-600 font-bold text-xs transition cursor-pointer"
            >
              キャンセル
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting || isFormatting}
              className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>メモを保存</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

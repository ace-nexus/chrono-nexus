'use client';

import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Send,
  X,
  Sparkles,
  Loader2,
  History,
  CheckCircle2,
  Calendar,
  CheckSquare,
  FileText,
  Clock,
  MapPin,
  Tag,
  AlertCircle,
  ArrowLeft,
  Check,
  Trash2,
  Sun,
  Moon,
  ArrowRightLeft,
} from 'lucide-react';
import AiInboxHistoryModal from './AiInboxHistoryModal';
import { useContinuousSpeechRecognition } from '@/lib/useContinuousSpeechRecognition';
import { getJstDateStr } from '@/lib/dateUtils';

interface UnifiedAiInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (targetDate?: string) => void;
  currentDate?: string;
}

interface ParsedResults {
  schedules: Array<{
    title: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    location: string | null;
  }>;
  tasks: Array<{
    title: string;
    genre: string;
    priority: 'S' | 'A' | 'B' | 'C';
    dueDate: string | null;
    dueTime?: string | null;
    endTime?: string | null;
    isNoDate: boolean;
    location: string | null;
  }>;
  memos: Array<{
    content: string;
    date: string;
  }>;
}

export default function UnifiedAiInputModal({
  isOpen,
  onClose,
  onSuccess,
  currentDate,
}: UnifiedAiInputModalProps) {
  const [inputText, setInputText] = useState<string>('');
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [parsedData, setParsedData] = useState<ParsedResults>({
    schedules: [],
    tasks: [],
    memos: [],
  });

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // AI修正指示用ステート
  const [refineText, setRefineText] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);

  // 保存完了結果詳細ステート（保存先日付・迷子防止用）
  const [commitResult, setCommitResult] = useState<{
    summaryMessage: string;
    primaryDate: string;
    targetDates: string[];
  } | null>(null);

  // 堅牢な音声認識フックの接続（入力画面とAI修正画面で完全分離し競合・誤判定を防止）
  const inputVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setInputText(text),
  });

  const refineVoice = useContinuousSpeechRecognition({
    onTranscriptChange: (text) => setRefineText(text),
  });

  useEffect(() => {
    if (!isOpen) {
      inputVoice.stop();
      refineVoice.stop();
      inputVoice.reset();
      refineVoice.reset();
      setInputText('');
      setRefineText('');
      setStep('input');
      setParsedData({ schedules: [], tasks: [], memos: [] });
      setToastMessage(null);
      setCommitResult(null);
    }
  }, [isOpen]);

  // 1. AI解析（プレビュー生成）
  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isAnalyzing) return;

    inputVoice.stop();
    setIsAnalyzing(true);

    try {
      const res = await fetch('/api/ai/unified-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          currentDate,
          mode: 'parse',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI解析に失敗しました');
      }

      const data = await res.json();
      const parsed: ParsedResults = data.parsed || { schedules: [], tasks: [], memos: [] };
      setParsedData(parsed);
      setStep('preview');
    } catch (err: any) {
      alert(err.message || 'AI解析中にエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 2. AI修正指示（プレビュー画面でAIに追加指示を出す）
  const handleRefine = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!refineText.trim() || isRefining) return;

    refineVoice.stop();
    setIsRefining(true);

    try {
      const res = await fetch('/api/ai/unified-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: refineText.trim(),
          currentDate,
          mode: 'refine',
          parsedData,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI修正に失敗しました');
      }

      const data = await res.json();
      if (data.parsed) {
        setParsedData(data.parsed);
        setRefineText('');
        setToastMessage('✨ AI修正を反映しました');
        setTimeout(() => setToastMessage(null), 2500);
      }
    } catch (err: any) {
      alert(err.message || 'AI修正中にエラーが発生しました');
    } finally {
      setIsRefining(false);
    }
  };

  // 3. 確定保存
  const handleCommit = async () => {
    if (isCommitting) return;
    setIsCommitting(true);

    try {
      const res = await fetch('/api/ai/unified-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          currentDate,
          mode: 'commit',
          parsedData,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '保存処理に失敗しました');
      }

      const data = await res.json();
      const primaryDate = data.primaryDate || currentDate || getJstDateStr();
      const targetDates = data.targetDates || [primaryDate];

      setCommitResult({
        summaryMessage: data.summaryMessage || '登録が完了しました',
        primaryDate,
        targetDates,
      });

      if (onSuccess) onSuccess(primaryDate);
    } catch (err: any) {
      alert(err.message || '保存中にエラーが発生しました');
    } finally {
      setIsCommitting(false);
    }
  };

  // 手動種別変換ヘルパー: スケジュール（予定）へ移動
  const handleConvertToSchedule = (from: 'tasks' | 'memos', index: number) => {
    setParsedData((prev) => {
      const nextSchedules = [...prev.schedules];
      const nextTasks = [...prev.tasks];
      const nextMemos = [...prev.memos];

      let title = '';
      let date = currentDate || getJstDateStr();
      let startTime = '09:00';
      let endTime: string | null = null;

      if (from === 'tasks') {
        const item = nextTasks[index];
        title = item.title;
        date = item.dueDate || date;
        startTime = item.dueTime || '09:00';
        endTime = item.endTime || null;
        nextTasks.splice(index, 1);
      } else {
        const item = nextMemos[index];
        title = item.content.slice(0, 30);
        date = item.date || date;
        nextMemos.splice(index, 1);
      }

      nextSchedules.push({
        title,
        date,
        startTime,
        endTime,
        isAllDay: false,
        location: null,
      });

      return { schedules: nextSchedules, tasks: nextTasks, memos: nextMemos };
    });
    setToastMessage('予定に移動しました');
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 手動種別変換ヘルパー: タスクへ移動
  const handleConvertToTask = (from: 'schedules' | 'memos', index: number) => {
    setParsedData((prev) => {
      const nextSchedules = [...prev.schedules];
      const nextTasks = [...prev.tasks];
      const nextMemos = [...prev.memos];

      let title = '';
      let dueDate: string | null = null;
      let dueTime: string | null = null;
      let endTime: string | null = null;

      if (from === 'schedules') {
        const item = nextSchedules[index];
        title = item.title;
        dueDate = item.date;
        dueTime = item.startTime;
        endTime = item.endTime;
        nextSchedules.splice(index, 1);
      } else {
        const item = nextMemos[index];
        title = item.content.slice(0, 30);
        dueDate = item.date;
        nextMemos.splice(index, 1);
      }

      nextTasks.push({
        title,
        genre: 'その他',
        priority: 'B',
        dueDate,
        dueTime,
        endTime,
        isNoDate: !dueDate,
        location: null,
      });

      return { schedules: nextSchedules, tasks: nextTasks, memos: nextMemos };
    });
    setToastMessage('タスクに移動しました');
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 手動種別変換ヘルパー: メモへ移動
  const handleConvertToMemo = (from: 'schedules' | 'tasks', index: number) => {
    setParsedData((prev) => {
      const nextSchedules = [...prev.schedules];
      const nextTasks = [...prev.tasks];
      const nextMemos = [...prev.memos];

      let content = '';
      let date = currentDate || getJstDateStr();

      if (from === 'schedules') {
        const item = nextSchedules[index];
        content = `${item.title} ${item.startTime ? `(${item.startTime})` : ''}`.trim();
        date = item.date;
        nextSchedules.splice(index, 1);
      } else {
        const item = nextTasks[index];
        content = item.title;
        date = item.dueDate || date;
        nextTasks.splice(index, 1);
      }

      nextMemos.push({ content, date });

      return { schedules: nextSchedules, tasks: nextTasks, memos: nextMemos };
    });
    setToastMessage('メモに移動しました');
    setTimeout(() => setToastMessage(null), 2000);
  };

  // プレビュー編集用ヘルパー
  const handleRemoveItem = (type: 'schedules' | 'tasks' | 'memos', index: number) => {
    setParsedData((prev) => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));
  };

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

  // スケジュールの午前 / 午後の設定・切り替え
  const handleSetAmPm = (
    type: 'startTime' | 'endTime',
    index: number,
    targetAmPm: 'AM' | 'PM'
  ) => {
    setParsedData((prev) => {
      const next = [...prev.schedules];
      const currentVal = next[index][type];

      if (!currentVal) {
        next[index][type] = targetAmPm === 'AM' ? '09:00' : '14:00';
        return { ...prev, schedules: next };
      }

      const parts = currentVal.split(':');
      let h = parseInt(parts[0], 10);
      const m = parts[1] || '00';
      if (isNaN(h)) return prev;

      const currentIsPm = h >= 12;
      if (targetAmPm === 'AM' && currentIsPm) {
        h = h - 12;
      } else if (targetAmPm === 'PM' && !currentIsPm) {
        h = h + 12;
      }

      next[index][type] = `${String(h).padStart(2, '0')}:${m}`;
      return { ...prev, schedules: next };
    });
  };

  // タスクの午前 / 午後の設定・切り替え
  const handleSetTaskAmPm = (
    type: 'dueTime' | 'endTime',
    index: number,
    targetAmPm: 'AM' | 'PM'
  ) => {
    setParsedData((prev) => {
      const next = [...prev.tasks];
      const currentVal = next[index][type];

      if (!currentVal) {
        next[index][type] = targetAmPm === 'AM' ? '09:00' : '14:00';
        return { ...prev, tasks: next };
      }

      const parts = currentVal.split(':');
      let h = parseInt(parts[0], 10);
      const m = parts[1] || '00';
      if (isNaN(h)) return prev;

      const currentIsPm = h >= 12;
      if (targetAmPm === 'AM' && currentIsPm) {
        h = h - 12;
      } else if (targetAmPm === 'PM' && !currentIsPm) {
        h = h + 12;
      }

      next[index][type] = `${String(h).padStart(2, '0')}:${m}`;
      return { ...prev, tasks: next };
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
        <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
          {/* ヘッダー */}
          <div className="px-5 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-100" />
              </div>
              <div>
                <h3 className="font-bold text-base leading-tight">
                  {commitResult
                    ? '手帳への登録完了'
                    : step === 'input'
                    ? '一括AI窓口（なんでも話す）'
                    : 'AI仕分け結果の確認・登録'}
                </h3>
                <p className="text-[11px] text-amber-100/90">
                  {commitResult
                    ? '指定の日付へ確実に登録されました'
                    : step === 'input'
                    ? '予定・タスク・メモを話すだけでAIが自動判定'
                    : '内容を確認・微修正して登録できます'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/20 transition"
                title="AI仕分け履歴を見る"
              >
                <History className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/20 transition"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* トースト表示 */}
          {toastMessage && (
            <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-bold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* ── STEP 1: 入力画面 ── */}
          {step === 'input' && (
            <form onSubmit={handleAnalyze} className="p-5 flex-1 flex flex-col space-y-4 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    話したこと・メモしたいこと
                  </label>
                  {inputVoice.isListening && (
                    <span className="text-[11px] font-bold text-rose-600 flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      音声をリアルタイム認識中...
                    </span>
                  )}
                </div>

                <div className="relative">
                  <textarea
                    rows={5}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="例:「明後日14時に山田商事へ行く。帰りにコーナンで釘を買う。現場の鍵番号は8892番だった。」"
                    className="w-full p-3.5 pb-12 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-normal text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white transition leading-relaxed shadow-inner resize-none"
                    autoFocus
                  />

                  {/* アクションボタン群（やり直し全消去 ＆ 音声入力） */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                    {/* 一括全消去・やり直しボタン */}
                    {(inputText.trim() || inputVoice.isListening) && (
                      <button
                        type="button"
                        onClick={() => {
                          inputVoice.clear();
                          setInputText('');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-200/90 hover:bg-rose-100 hover:text-rose-700 text-slate-600 text-xs font-bold transition flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer"
                        title="入力内容を一括消去して最初からやり直す"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>やり直す</span>
                      </button>
                    )}

                    {/* 音声入力トグルボタン */}
                    <button
                      type="button"
                      onClick={() => inputVoice.toggle(inputText)}
                      className={`p-2.5 rounded-xl flex items-center gap-1.5 text-xs font-bold transition shadow-sm cursor-pointer ${
                        inputVoice.isListening
                          ? 'bg-rose-500 text-white animate-bounce'
                          : 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95'
                      }`}
                      title={inputVoice.isListening ? '音声認識を停止' : '音声で入力'}
                    >
                      {inputVoice.isListening ? (
                        <>
                          <MicOff className="w-4 h-4" />
                          <span>停止</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4" />
                          <span>音声で話す</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* ヒント */}
              <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100/80 text-[11px] text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  AIが3つに自動仕分けします:
                </p>
                <p className="text-slate-600">
                  ・「日時・約束」➔ <strong>カレンダー予定</strong>
                  <br />
                  ・「買い出し・準備・見積」➔ <strong>重要度付きタスク</strong>
                  <br />
                  ・「気づき・数値・メモ」➔ <strong>一日手帳メモ</strong>
                </p>
              </div>

              {/* 履歴確認リンクボタン */}
              <div className="flex justify-between items-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(true)}
                  className="text-xs text-slate-500 hover:text-amber-600 flex items-center gap-1 transition"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>過去のAI仕分け履歴を見る</span>
                </button>
              </div>

              {/* 解析ボタン */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!inputText.trim() || isAnalyzing}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-98 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      AIが仕分け解析中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      AIで解析して確認する
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 2: プレビュー＆確認画面 または 登録完了画面 ── */}
          {step === 'preview' && (
            commitResult ? (
              <div className="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in zoom-in-95">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-xs">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-base font-extrabold text-slate-900">手帳への登録が完了しました！</h4>
                  <p className="text-xs font-medium text-slate-600 max-w-sm">{commitResult.summaryMessage}</p>
                  <div className="pt-2">
                    <span className="text-xs font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3.5 py-1.5 rounded-xl inline-flex items-center gap-1.5 shadow-2xs">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      保存先: {commitResult.primaryDate} の手帳
                    </span>
                  </div>
                </div>

                <div className="pt-4 flex flex-col sm:flex-row items-center gap-2.5 w-full max-w-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (onSuccess) onSuccess(commitResult.primaryDate);
                      onClose();
                    }}
                    className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 active:scale-98 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                  >
                    <span>👉 {commitResult.primaryDate} の手帳を開く</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 flex-1 flex flex-col space-y-4 overflow-y-auto">
              <div className="space-y-3">
                {/* 予定リスト */}
                {parsedData.schedules.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
                      <Calendar className="w-4 h-4" />
                      <span>カレンダー予定（{parsedData.schedules.length}件）</span>
                    </div>
                    {parsedData.schedules.map((sch, i) => (
                      <div key={i} className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={sch.title}
                            onChange={(e) => {
                              const val = e.target.value;
                              setParsedData((prev) => {
                                const next = [...prev.schedules];
                                next[i].title = val;
                                return { ...prev, schedules: next };
                              });
                            }}
                            className="font-bold text-sm text-slate-900 bg-transparent border-b border-indigo-300 focus:outline-none focus:border-indigo-600 flex-1 mr-1"
                            placeholder="予定タイトル"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="inline-flex rounded-md border border-indigo-200 overflow-hidden text-[10px] font-bold bg-white shadow-2xs">
                              <button
                                type="button"
                                onClick={() => handleConvertToTask('schedules', i)}
                                className="px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50 border-r border-indigo-100 flex items-center gap-0.5 cursor-pointer"
                                title="タスクに変換"
                              >
                                <CheckSquare className="w-2.5 h-2.5" />
                                タスクへ
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConvertToMemo('schedules', i)}
                                className="px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50 flex items-center gap-0.5 cursor-pointer"
                                title="メモに変換"
                              >
                                <FileText className="w-2.5 h-2.5" />
                                メモへ
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem('schedules', i)}
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2 pt-1 text-xs">
                          {/* 日付設定 */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 font-semibold shrink-0">日付:</span>
                            <input
                              type="date"
                              value={sch.date}
                              onChange={(e) => {
                                const val = e.target.value;
                                setParsedData((prev) => {
                                  const next = [...prev.schedules];
                                  next[i].date = val;
                                  return { ...prev, schedules: next };
                                });
                              }}
                              className="bg-white border border-indigo-200 rounded-md px-2 py-0.5 text-xs font-bold text-slate-800 shadow-2xs"
                            />
                          </div>

                          {/* 時間設定カード（午前/午後が明瞭で切り替えやすいUI） */}
                          <div className="bg-white/95 border border-indigo-100 rounded-xl p-2.5 space-y-2 shadow-2xs">
                            {/* 開始時間 */}
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-indigo-950 font-bold text-xs shrink-0 flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                  開始:
                                </span>
                                <input
                                  type="time"
                                  value={sch.startTime || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setParsedData((prev) => {
                                      const next = [...prev.schedules];
                                      next[i].startTime = val || null;
                                      return { ...prev, schedules: next };
                                    });
                                  }}
                                  className="bg-slate-50 border border-indigo-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                                  title="開始時間"
                                />
                                {sch.startTime && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setParsedData((prev) => {
                                        const next = [...prev.schedules];
                                        next[i].startTime = null;
                                        return { ...prev, schedules: next };
                                      });
                                    }}
                                    className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                    title="開始時間をクリア"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              {sch.startTime ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    {formatAmPmDisplay(sch.startTime)}
                                  </span>
                                  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                    <button
                                      type="button"
                                      onClick={() => handleSetAmPm('startTime', i, 'AM')}
                                      className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                        !isPmTime(sch.startTime)
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
                                      onClick={() => handleSetAmPm('startTime', i, 'PM')}
                                      className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                        isPmTime(sch.startTime)
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
                                <span className="text-[11px] text-slate-400">未設定</span>
                              )}
                            </div>

                            {/* 終了時間 */}
                            <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-indigo-950 font-bold text-xs shrink-0 flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
                                  終了:
                                </span>
                                <input
                                  type="time"
                                  value={sch.endTime || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setParsedData((prev) => {
                                      const next = [...prev.schedules];
                                      next[i].endTime = val || null;
                                      return { ...prev, schedules: next };
                                    });
                                  }}
                                  className="bg-slate-50 border border-indigo-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                                  title="終了時間"
                                />
                                {sch.endTime && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setParsedData((prev) => {
                                        const next = [...prev.schedules];
                                        next[i].endTime = null;
                                        return { ...prev, schedules: next };
                                      });
                                    }}
                                    className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                    title="終了時間をクリア"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              {sch.endTime ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    {formatAmPmDisplay(sch.endTime)}
                                  </span>
                                  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                    <button
                                      type="button"
                                      onClick={() => handleSetAmPm('endTime', i, 'AM')}
                                      className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                        !isPmTime(sch.endTime)
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
                                      onClick={() => handleSetAmPm('endTime', i, 'PM')}
                                      className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                        isPmTime(sch.endTime)
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
                                    setParsedData((prev) => {
                                      const next = [...prev.schedules];
                                      if (next[i].startTime) {
                                        const parts = next[i].startTime!.split(':');
                                        const nextH = Math.min(23, (parseInt(parts[0], 10) || 0) + 1);
                                        next[i].endTime = `${String(nextH).padStart(2, '0')}:${parts[1] || '00'}`;
                                      } else {
                                        next[i].endTime = '18:00';
                                      }
                                      return { ...prev, schedules: next };
                                    });
                                  }}
                                  className="text-[11px] text-indigo-600 font-semibold hover:underline cursor-pointer"
                                >
                                  + 終了時間を設定
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* タスクリスト */}
                {parsedData.tasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                      <CheckSquare className="w-4 h-4" />
                      <span>タスク（{parsedData.tasks.length}件）</span>
                    </div>
                    {parsedData.tasks.map((task, i) => (
                      <div key={i} className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={task.title}
                            onChange={(e) => {
                              const val = e.target.value;
                              setParsedData((prev) => {
                                const next = [...prev.tasks];
                                next[i].title = val;
                                return { ...prev, tasks: next };
                              });
                            }}
                            className="font-bold text-sm text-slate-900 bg-transparent border-b border-amber-300 focus:outline-none focus:border-amber-600 flex-1 mr-1"
                            placeholder="タスク名"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="inline-flex rounded-md border border-amber-200 overflow-hidden text-[10px] font-bold bg-white shadow-2xs">
                              <button
                                type="button"
                                onClick={() => handleConvertToSchedule('tasks', i)}
                                className="px-1.5 py-0.5 text-amber-700 hover:bg-amber-50 border-r border-amber-100 flex items-center gap-0.5 cursor-pointer"
                                title="予定に変換"
                              >
                                <Calendar className="w-2.5 h-2.5" />
                                予定へ
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConvertToMemo('tasks', i)}
                                className="px-1.5 py-0.5 text-amber-700 hover:bg-amber-50 flex items-center gap-0.5 cursor-pointer"
                                title="メモに変換"
                              >
                                <FileText className="w-2.5 h-2.5" />
                                メモへ
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem('tasks', i)}
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* 重要度・ジャンル */}
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-semibold">重要度:</span>
                            <select
                              value={task.priority}
                              onChange={(e) => {
                                const val = e.target.value as any;
                                setParsedData((prev) => {
                                  const next = [...prev.tasks];
                                  next[i].priority = val;
                                  return { ...prev, tasks: next };
                                });
                              }}
                              className="bg-white border border-amber-200 rounded px-1.5 py-0.5 text-xs font-bold"
                            >
                              <option value="S">重要度 S（至急）</option>
                              <option value="A">重要度 A（重要）</option>
                              <option value="B">重要度 B（普通）</option>
                              <option value="C">重要度 C（後で）</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-semibold">ジャンル:</span>
                            <input
                              type="text"
                              value={task.genre}
                              onChange={(e) => {
                                const val = e.target.value;
                                setParsedData((prev) => {
                                  const next = [...prev.tasks];
                                  next[i].genre = val;
                                  return { ...prev, tasks: next };
                                });
                              }}
                              className="bg-white border border-amber-200 rounded px-1.5 py-0.5 text-xs font-bold w-20"
                            />
                          </div>
                        </div>

                        {/* 日付・時間設定カード（午前/午後が明瞭で切り替えやすいUI） */}
                        <div className="bg-white/95 border border-amber-100 rounded-xl p-2.5 space-y-2 shadow-2xs text-xs">
                          {/* 期日設定 */}
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-600 font-semibold shrink-0">期日:</span>
                              {!task.isNoDate ? (
                                <input
                                  type="date"
                                  value={task.dueDate || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setParsedData((prev) => {
                                      const next = [...prev.tasks];
                                      next[i].dueDate = val || null;
                                      return { ...prev, tasks: next };
                                    });
                                  }}
                                  className="bg-white border border-amber-200 rounded-md px-2 py-0.5 text-xs font-bold text-slate-800 shadow-2xs"
                                />
                              ) : (
                                <span className="text-[11px] text-slate-400 font-bold">指定なし</span>
                              )}
                            </div>
                            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(task.isNoDate)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setParsedData((prev) => {
                                    const next = [...prev.tasks];
                                    next[i].isNoDate = checked;
                                    if (checked) {
                                      next[i].dueDate = null;
                                      next[i].dueTime = null;
                                      next[i].endTime = null;
                                    } else {
                                      next[i].dueDate = currentDate || getJstDateStr();
                                    }
                                    return { ...prev, tasks: next };
                                  });
                                }}
                                className="rounded text-amber-500"
                              />
                              <span>期日なし</span>
                            </label>
                          </div>

                          {!task.isNoDate && (
                            <>
                              {/* 開始時間 */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-amber-950 font-bold text-xs shrink-0 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                                    開始:
                                  </span>
                                  <input
                                    type="time"
                                    value={task.dueTime || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setParsedData((prev) => {
                                        const next = [...prev.tasks];
                                        next[i].dueTime = val || null;
                                        return { ...prev, tasks: next };
                                      });
                                    }}
                                    className="bg-slate-50 border border-amber-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                                    title="開始時間"
                                  />
                                  {task.dueTime && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setParsedData((prev) => {
                                          const next = [...prev.tasks];
                                          next[i].dueTime = null;
                                          return { ...prev, tasks: next };
                                        });
                                      }}
                                      className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                      title="開始時間をクリア"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>

                                {task.dueTime ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100">
                                      {formatAmPmDisplay(task.dueTime)}
                                    </span>
                                    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                      <button
                                        type="button"
                                        onClick={() => handleSetTaskAmPm('dueTime', i, 'AM')}
                                        className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                          !isPmTime(task.dueTime)
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
                                        onClick={() => handleSetTaskAmPm('dueTime', i, 'PM')}
                                        className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                          isPmTime(task.dueTime)
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
                                  <span className="text-[11px] text-slate-400">終日（未指定）</span>
                                )}
                              </div>

                              {/* 終了時間 */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-amber-950 font-bold text-xs shrink-0 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                                    終了:
                                  </span>
                                  <input
                                    type="time"
                                    value={task.endTime || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setParsedData((prev) => {
                                        const next = [...prev.tasks];
                                        next[i].endTime = val || null;
                                        return { ...prev, tasks: next };
                                      });
                                    }}
                                    className="bg-slate-50 border border-amber-200 rounded-md px-1.5 py-0.5 text-xs font-bold text-slate-800"
                                    title="終了時間"
                                  />
                                  {task.endTime && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setParsedData((prev) => {
                                          const next = [...prev.tasks];
                                          next[i].endTime = null;
                                          return { ...prev, tasks: next };
                                        });
                                      }}
                                      className="text-slate-400 hover:text-rose-500 p-0.5 text-[10px]"
                                      title="終了時間をクリア"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>

                                {task.endTime ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100">
                                      {formatAmPmDisplay(task.endTime)}
                                    </span>
                                    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold shadow-2xs">
                                      <button
                                        type="button"
                                        onClick={() => handleSetTaskAmPm('endTime', i, 'AM')}
                                        className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                          !isPmTime(task.endTime)
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
                                        onClick={() => handleSetTaskAmPm('endTime', i, 'PM')}
                                        className={`px-2 py-0.5 transition-colors flex items-center gap-0.5 cursor-pointer ${
                                          isPmTime(task.endTime)
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
                                      setParsedData((prev) => {
                                        const next = [...prev.tasks];
                                        if (next[i].dueTime) {
                                          const parts = next[i].dueTime!.split(':');
                                          const nextH = Math.min(23, (parseInt(parts[0], 10) || 0) + 1);
                                          next[i].endTime = `${String(nextH).padStart(2, '0')}:${parts[1] || '00'}`;
                                        } else {
                                          next[i].endTime = '18:00';
                                        }
                                        return { ...prev, tasks: next };
                                      });
                                    }}
                                    className="text-[11px] text-amber-700 font-semibold hover:underline cursor-pointer"
                                  >
                                    + 終了時間を設定
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* メモリスト */}
                {parsedData.memos.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <FileText className="w-4 h-4" />
                      <span>一日手帳メモ（{parsedData.memos.length}件）</span>
                    </div>
                    {parsedData.memos.map((memo, i) => (
                      <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <textarea
                            rows={2}
                            value={memo.content}
                            onChange={(e) => {
                              const val = e.target.value;
                              setParsedData((prev) => {
                                const next = [...prev.memos];
                                next[i].content = val;
                                return { ...prev, memos: next };
                              });
                            }}
                            className="font-normal text-xs text-slate-800 bg-transparent border border-slate-200 focus:bg-white rounded p-1.5 flex-1 mr-1"
                          />
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[10px] font-bold bg-white shadow-2xs">
                              <button
                                type="button"
                                onClick={() => handleConvertToSchedule('memos', i)}
                                className="px-1.5 py-0.5 text-slate-700 hover:bg-slate-50 border-r border-slate-100 flex items-center gap-0.5 cursor-pointer"
                                title="予定に変換"
                              >
                                <Calendar className="w-2.5 h-2.5" />
                                予定へ
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConvertToTask('memos', i)}
                                className="px-1.5 py-0.5 text-slate-700 hover:bg-slate-50 flex items-center gap-0.5 cursor-pointer"
                                title="タスクに変換"
                              >
                                <CheckSquare className="w-2.5 h-2.5" />
                                タスクへ
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem('memos', i)}
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
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

                {/* ✨ AI修正指示バー */}
                <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/90 to-amber-50/90 p-3 rounded-2xl border border-indigo-200/80 space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                      <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                      <span>AIに指示して修正する</span>
                    </div>
                    <span className="text-[10px] text-slate-500">声または文字で指示OK</span>
                  </div>

                  <form onSubmit={handleRefine} className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        placeholder="例: 「メモじゃなくて予定にして」「時間は夜7時にして」"
                        className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 pr-10 shadow-2xs"
                        disabled={isRefining}
                      />
                      {/* クリアボタン（入力がある場合） */}
                      {refineText.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            refineVoice.clear();
                            setRefineText('');
                          }}
                          className="absolute right-9 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500 rounded-md transition cursor-pointer"
                          title="修正指示をクリア"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => refineVoice.toggle(refineText)}
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors cursor-pointer ${
                          refineVoice.isListening
                            ? 'bg-rose-500 text-white animate-pulse'
                            : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
                        }`}
                        title={refineVoice.isListening ? '音声入力を停止' : '音声で修正指示を入力'}
                      >
                        {refineVoice.isListening ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={isRefining || !refineText.trim()}
                      className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition flex items-center gap-1 shrink-0 shadow-xs cursor-pointer"
                    >
                      {isRefining ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>修正中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>AI修正</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </div>

              {/* 確定操作フッター */}
              <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  吹き込みに戻る
                </button>

                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={isCommitting}
                  className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-98 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm disabled:opacity-50"
                >
                  {isCommitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      登録中...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      この内容で確定登録する
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        )}
        </div>
      </div>

      {/* AI仕分け履歴モーダル */}
      <AiInboxHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
      />
    </>
  );
}
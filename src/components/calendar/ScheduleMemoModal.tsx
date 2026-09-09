'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Mic,
  MicOff,
  Trash2,
  Save,
  Clock,
  FileText,
  Loader2,
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

interface ScheduleMemoModalProps {
  isOpen: boolean;
  schedule: ScheduleMemoTarget | null;
  onClose: () => void;
  onSave: (scheduleId: string, memo: string) => Promise<void>;
  onDelete: (scheduleId: string) => Promise<void>;
}

export default function ScheduleMemoModal({
  isOpen,
  schedule,
  onClose,
  onSave,
  onDelete,
}: ScheduleMemoModalProps) {
  const [memoText, setMemoText] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isVoiceListening, setIsVoiceListening] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // 初期値セット
  useEffect(() => {
    if (schedule && isOpen) {
      const initialMemo =
        schedule.raw_payload?.memo ?? schedule.description ?? '';
      setMemoText(initialMemo);
    } else {
      setMemoText('');
    }
    setIsVoiceListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
  }, [schedule, isOpen]);

  // 音声入力のトグル
  const toggleVoiceInput = () => {
    if (isVoiceListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
      setIsVoiceListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('お使いのブラウザは音声認識に対応していません。');
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.continuous = true;

    recog.onstart = () => setIsVoiceListening(true);
    recog.onend = () => setIsVoiceListening(false);
    recog.onerror = () => setIsVoiceListening(false);
    recog.onresult = (event: any) => {
      const results = event.results;
      const latest = results[results.length - 1]?.[0]?.transcript;
      if (latest) {
        setMemoText((prev) => (prev ? `${prev}\n${latest}` : latest));
      }
    };

    recognitionRef.current = recog;
    recog.start();
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
      if (isVoiceListening && recognitionRef.current) {
        recognitionRef.current.stop();
      }
      await onSave(schedule.id, memoText.trim());
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
      if (isVoiceListening && recognitionRef.current) {
        recognitionRef.current.stop();
      }
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
        if (isVoiceListening && recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (_) {}
        }
        onClose();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-4 duration-200"
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
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition shrink-0"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* コンテンツ入力エリア */}
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>予定メモ・現場記録</span>
              {hasExistingMemo && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800">
                  記録あり
                </span>
              )}
            </label>

            {/* 音声入力トグルボタン */}
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                isVoiceListening
                  ? 'bg-rose-500 text-white animate-pulse shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={isVoiceListening ? '音声入力を停止' : '音声でメモを入力'}
            >
              {isVoiceListening ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span>聞いています...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-slate-500" />
                  <span>音声入力</span>
                </>
              )}
            </button>
          </div>

          <textarea
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            rows={5}
            placeholder="現場に誰が来ていたか、経費、指示・決定事項などをメモ..."
            className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none transition resize-none placeholder:text-slate-400"
          />

          <p className="text-[11px] text-slate-400 leading-relaxed">
            ※ このメモは予定（スケジュール）に紐づいて保存されます。
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
                disabled={isDeleting || isSaving}
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
              onClick={onClose}
              disabled={isSaving || isDeleting}
              className="py-2.5 px-3.5 rounded-xl hover:bg-slate-200 text-slate-600 font-bold text-xs transition cursor-pointer"
            >
              キャンセル
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting}
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

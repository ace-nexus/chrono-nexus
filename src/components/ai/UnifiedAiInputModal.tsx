'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Send,
  X,
  Sparkles,
  Loader2,
  History,
  CheckCircle2,
} from 'lucide-react';
import AiInboxHistoryModal from './AiInboxHistoryModal';

interface UnifiedAiInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  currentDate?: string;
}

export default function UnifiedAiInputModal({
  isOpen,
  onClose,
  onSuccess,
  currentDate,
}: UnifiedAiInputModalProps) {
  const [inputText, setInputText] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);
  const isVoiceActiveRef = useRef<boolean>(false);
  const baseTextRef = useRef<string>('');

  const stopVoice = () => {
    isVoiceActiveRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopVoice();
      setInputText('');
      setToastMessage(null);
    }
  }, [isOpen]);

  const toggleVoice = () => {
    if (isVoiceActiveRef.current) {
      stopVoice();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('お使いのブラウザは音声認識に対応していません。');
      return;
    }

    baseTextRef.current = inputText ? inputText.trim() + ' ' : '';
    isVoiceActiveRef.current = true;
    setIsListening(true);

    const recog = new SpeechRecognition();
    recog.lang = 'ja-JP';
    recog.continuous = true;
    recog.interimResults = false;

    recog.onresult = (event: any) => {
      let full = '';
      for (let i = 0; i < event.results.length; ++i) {
        full += event.results[i][0]?.transcript || '';
      }
      if (full.trim()) {
        setInputText((baseTextRef.current + full).trim());
      }
    };

    recog.onerror = () => {
      stopVoice();
    };

    recog.onend = () => {
      if (isVoiceActiveRef.current) {
        baseTextRef.current = inputText ? inputText.trim() + ' ' : '';
        try {
          recog.start();
          return;
        } catch (_) {}
      }
      stopVoice();
    };

    recognitionRef.current = recog;
    try {
      recog.start();
    } catch (_) {
      stopVoice();
    }
  };

  // 送信（AIによる即時自動仕分け＆登録）
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isProcessing) return;

    stopVoice();
    setIsProcessing(true);

    try {
      const res = await fetch('/api/ai/unified-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          currentDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '仕分け処理に失敗しました');
      }

      const data = await res.json();
      setToastMessage(data.summaryMessage || '登録が完了しました');
      setInputText('');

      if (onSuccess) onSuccess();

      // 1.5秒後に自動で閉じる（スピード重視）
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      alert(`エラー: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={() => {
          stopVoice();
          onClose();
        }}
      >
        <div
          className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ヘッダー */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 text-white">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-black">一括AI窓口（なんでも話すだけ）</h3>
                <p className="text-[10px] text-white/80">
                  予定・タスク・買い物・現場メモをAIが自動判別して即時登録
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                title="AI振り分け履歴を確認"
              >
                <History className="w-4 h-4" />
                <span className="hidden sm:inline">履歴</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopVoice();
                  onClose();
                }}
                className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 入力エリア */}
          <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <div className="relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={5}
                placeholder="話すか入力してください...&#10;例：「明後日14時に山田商事へ行く。帰りにホームセンターでコピー用紙を買う。お昼は田中さんと弁当1200円。」"
                className="w-full p-3.5 text-sm rounded-2xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none transition resize-none placeholder:text-slate-400 leading-relaxed"
                autoFocus
              />
            </div>

            {/* 成功トーストメッセージ */}
            {toastMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{toastMessage}</span>
              </div>
            )}

            {/* 下部ボタングループ */}
            <div className="flex items-center justify-between gap-2 pt-1">
              {/* マイクボタン */}
              <button
                type="button"
                onClick={toggleVoice}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                  isListening
                    ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    <span>録音中（タップで停止）</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-slate-500" />
                    <span>音声で話す</span>
                  </>
                )}
              </button>

              {/* 送信ボタン */}
              <button
                type="submit"
                disabled={!inputText.trim() || isProcessing}
                className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:from-amber-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>自動仕分け中...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>AIに任せる</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 振り分け履歴モーダル */}
      <AiInboxHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
      />
    </>
  );
}
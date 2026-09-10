'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseContinuousSpeechRecognitionOptions {
  onTranscriptChange?: (text: string) => void;
  lang?: string;
}

// スマートマージ関数（完全一致、末尾・先頭の重なり重複を安全に排除し、文章中の正当な単語を誤判定で消さない）
function mergeWithoutDuplication(base: string, addition: string): string {
  const b = (base || '').trim();
  const a = (addition || '').trim();
  if (!b) return a;
  if (!a) return b;
  if (b === a || b.endsWith(a)) return b;
  if (a.startsWith(b)) return a;

  // 末尾と先頭のオーバーラップ検出（最大一致長を探して重複を削る）
  const maxOverlap = Math.min(b.length, a.length);
  for (let len = maxOverlap; len >= 2; len--) {
    if (b.slice(-len) === a.slice(0, len)) {
      return b + a.slice(len);
    }
  }

  // 日本語の文区切りを考慮して自然に連結
  return `${b} ${a}`;
}

export function useContinuousSpeechRecognition(options?: UseContinuousSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');

  // 状態管理用のRef（再レンダリングやクロージャに影響されない最新値を保持）
  const isActiveRef = useRef(false);
  const baseTextRef = useRef(''); // 録音開始前の元テキスト
  const committedTextRef = useRef(''); // 今回のセッションで確定した音声テキスト
  const currentInterimRef = useRef(''); // 現在発話中の中間テキスト
  const lastCommittedIndexRef = useRef<number>(-1); // 現在のrecogインスタンスでコミット済みの最大index
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);
  const onTranscriptChangeRef = useRef(options?.onTranscriptChange);

  useEffect(() => {
    onTranscriptChangeRef.current = options?.onTranscriptChange;
  }, [options?.onTranscriptChange]);

  // 合算テキストを画面に通知
  const emitCurrentText = useCallback(() => {
    let result = baseTextRef.current.trim();
    if (committedTextRef.current.trim()) {
      result = mergeWithoutDuplication(result, committedTextRef.current.trim());
    }
    if (currentInterimRef.current.trim()) {
      result = mergeWithoutDuplication(result, currentInterimRef.current.trim());
    }
    if (onTranscriptChangeRef.current) {
      onTranscriptChangeRef.current(result);
    }
  }, []);

  // 停止処理（マイクが稼働中の場合のみ安全に確定して終了）
  const stop = useCallback(() => {
    if (!isActiveRef.current) {
      // すでに停止している場合は絶対に古いバッファを再送出しない（保存時上書きバグの完全防止）
      return;
    }
    isActiveRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }

    // ユーザー明示停止時のみ、残存中間テキストがあれば安全に重複排除マージ
    if (currentInterimRef.current.trim()) {
      committedTextRef.current = mergeWithoutDuplication(
        committedTextRef.current,
        currentInterimRef.current.trim()
      );
      currentInterimRef.current = '';
    }

    lastCommittedIndexRef.current = -1;
    setInterimText('');
    setIsListening(false);
    emitCurrentText();
  }, [emitCurrentText]);

  // 内部バッファの完全初期化（AI清書完了時やモーダル開閉時に呼ぶ）
  const reset = useCallback(() => {
    isActiveRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
    baseTextRef.current = '';
    committedTextRef.current = '';
    currentInterimRef.current = '';
    lastCommittedIndexRef.current = -1;
    setInterimText('');
    setIsListening(false);
  }, []);

  const startListeningInstance = useCallback(() => {
    if (!isActiveRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }

      const recog = new SpeechRecognition();
      recog.lang = options?.lang || 'ja-JP';
      recog.continuous = true;
      recog.interimResults = true; // リアルタイム中間表示を有効化

      // 新インスタンス用にインデックスリセット
      lastCommittedIndexRef.current = -1;

      recog.onstart = () => {
        if (isActiveRef.current) {
          setIsListening(true);
        }
      };

      recog.onresult = (event: any) => {
        if (!isActiveRef.current) return;

        let newFinalText = '';
        let liveInterim = '';

        // event.results全体から未コミット分のみを順次処理（インデックス逆行ハウリングを完全遮断）
        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = (item[0]?.transcript || '').trim();
          if (!transcript) continue;

          if (item.isFinal) {
            // 既にコミット済みのインデックスは絶対に重複処理しない
            if (i > lastCommittedIndexRef.current) {
              newFinalText = newFinalText ? `${newFinalText} ${transcript}` : transcript;
              lastCommittedIndexRef.current = i;
            }
          } else {
            // 未確定の中間結果
            if (i > lastCommittedIndexRef.current) {
              liveInterim = liveInterim ? `${liveInterim} ${transcript}` : transcript;
            }
          }
        }

        if (newFinalText) {
          committedTextRef.current = mergeWithoutDuplication(
            committedTextRef.current,
            newFinalText
          );
        }

        currentInterimRef.current = liveInterim;
        setInterimText(liveInterim);
        emitCurrentText();
      };

      recog.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          console.error('マイクアクセスが拒否されました:', event.error);
          isActiveRef.current = false;
          setIsListening(false);
          alert('マイクへのアクセスが許可されていません。ブラウザ設定でマイクの使用を許可してください。');
          return;
        }
        if (event.error !== 'no-speech') {
          console.warn('SpeechRecognition error:', event.error);
        }
      };

      recog.onend = () => {
        // 残存の中間テキストがあれば安全に確定へ昇格（短文発話時の消滅バグを根絶）
        if (currentInterimRef.current.trim()) {
          committedTextRef.current = mergeWithoutDuplication(
            committedTextRef.current,
            currentInterimRef.current.trim()
          );
          currentInterimRef.current = '';
        }
        setInterimText('');
        lastCommittedIndexRef.current = -1;

        // ユーザーが手動停止していない場合（無音タイムアウト等）、自動でスムーズに再開
        if (isActiveRef.current) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (isActiveRef.current) {
              startListeningInstance();
            }
          }, 300);
        } else {
          setIsListening(false);
          emitCurrentText();
        }
      };

      recognitionRef.current = recog;
      recog.start();
    } catch (err) {
      console.error('Failed to start SpeechRecognition:', err);
      setIsListening(false);
      isActiveRef.current = false;
    }
  }, [emitCurrentText, options?.lang]);

  const start = useCallback(
    (initialText: string = '') => {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert('お使いのブラウザは音声認識に対応していません。（ChromeまたはSafari推奨）');
        return;
      }

      baseTextRef.current = (initialText || '').trim();
      committedTextRef.current = '';
      currentInterimRef.current = '';
      lastCommittedIndexRef.current = -1;
      setInterimText('');
      isActiveRef.current = true;
      setIsListening(true);

      startListeningInstance();
    },
    [startListeningInstance]
  );

  const toggle = useCallback(
    (currentText: string = '') => {
      if (isActiveRef.current) {
        stop();
      } else {
        start(currentText);
      }
    },
    [start, stop]
  );

  // 一括消去・やり直し（マイクを安全にリセットし、テキストを空にして通知）
  const clear = useCallback(() => {
    reset();
    if (onTranscriptChangeRef.current) {
      onTranscriptChangeRef.current('');
    }
  }, [reset]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, []);

  return {
    isListening,
    interimText,
    start,
    stop,
    toggle,
    reset,
    clear,
  };
}

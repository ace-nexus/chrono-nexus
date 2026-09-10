'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseContinuousSpeechRecognitionOptions {
  onTranscriptChange?: (text: string) => void;
  lang?: string;
}

export function useContinuousSpeechRecognition(options?: UseContinuousSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');

  // 状態管理用のRef（Reactの再レンダリングやクロージャに影響されない最新値を保持）
  const isActiveRef = useRef(false);
  const baseTextRef = useRef(''); // 録音開始前に既に入力されていたテキスト
  const committedTextRef = useRef(''); // 今回の録音セッションで確定した音声テキスト累計
  const currentInterimRef = useRef(''); // 現在話している最中の中間テキスト
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);
  const onTranscriptChangeRef = useRef(options?.onTranscriptChange);

  useEffect(() => {
    onTranscriptChangeRef.current = options?.onTranscriptChange;
  }, [options?.onTranscriptChange]);

  // 全体の合算テキストを通知
  const emitCurrentText = useCallback(() => {
    const parts = [
      baseTextRef.current.trim(),
      committedTextRef.current.trim(),
      currentInterimRef.current.trim(),
    ].filter(Boolean);
    const combined = parts.join(' ');
    if (onTranscriptChangeRef.current) {
      onTranscriptChangeRef.current(combined);
    }
  }, []);

  const stop = useCallback(() => {
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
    // 中間テキストが残っていれば確定分へマージ
    if (currentInterimRef.current.trim()) {
      committedTextRef.current = (
        committedTextRef.current + ' ' + currentInterimRef.current.trim()
      ).trim();
      currentInterimRef.current = '';
    }
    setInterimText('');
    setIsListening(false);
    emitCurrentText();
  }, [emitCurrentText]);

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
      recog.interimResults = true; // リアルタイム表示を有効化

      recog.onstart = () => {
        if (isActiveRef.current) {
          setIsListening(true);
        }
      };

      recog.onresult = (event: any) => {
        if (!isActiveRef.current) return;

        let finalPart = '';
        let interimPart = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || '';
          if (item.isFinal) {
            finalPart += transcript;
          } else {
            interimPart += transcript;
          }
        }

        if (finalPart) {
          committedTextRef.current = (
            committedTextRef.current + ' ' + finalPart.trim()
          ).trim();
        }

        currentInterimRef.current = interimPart;
        setInterimText(interimPart);
        emitCurrentText();
      };

      recog.onerror = (event: any) => {
        // no-speech は静音タイムアウトなので、アクティブ状態なら終了処理（onend）で再開させる
        if (event.error !== 'no-speech') {
          console.warn('SpeechRecognition error:', event.error);
        }
      };

      recog.onend = () => {
        // 中間テキストがあれば確定へ逃がす
        if (currentInterimRef.current.trim()) {
          committedTextRef.current = (
            committedTextRef.current + ' ' + currentInterimRef.current.trim()
          ).trim();
          currentInterimRef.current = '';
          setInterimText('');
          emitCurrentText();
        }

        // ユーザーが停止していない場合、スマホ（特にAndroid Chrome）の無音タイムアウトからスムーズに復帰
        if (isActiveRef.current) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (isActiveRef.current) {
              startListeningInstance();
            }
          }, 300);
        } else {
          setIsListening(false);
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

  // アンマウント時の安全な破棄
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
  };
}

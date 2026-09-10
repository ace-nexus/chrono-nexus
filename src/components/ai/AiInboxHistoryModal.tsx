'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  History,
  Calendar,
  CheckSquare,
  FileText,
  Trash2,
  Loader2,
} from 'lucide-react';

interface AiInboxHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AiInboxHistoryModal({
  isOpen,
  onClose,
}: AiInboxHistoryModalProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchLogs = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/ai/inbox-history');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('この履歴を削除しますか？')) return;
    setLogs((prev) => prev.filter((l) => l.id !== logId));
    try {
      await fetch(`/api/ai/inbox-history?id=${logId}`, { method: 'DELETE' });
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">AI振り分け履歴（最新50件）</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
              <p className="text-xs">履歴を読み込み中...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p className="text-xs">振り分け履歴はまだありません</p>
            </div>
          ) : (
            logs.map((log) => {
              const act = log.actions || {};
              const schCount = act.schedules?.length || 0;
              const taskCount = act.tasks?.length || 0;
              const memoCount = act.memos?.length || 0;

              return (
                <div
                  key={log.id}
                  className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-slate-800 break-words flex-1">
                      「{log.rawText}」
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeleteLog(log.id)}
                      className="p-1 text-slate-300 hover:text-rose-600 transition shrink-0"
                      title="履歴から削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 振り分け先バッジ */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {schCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold flex items-center gap-1 text-[10px]">
                        <Calendar className="w-3 h-3" />
                        <span>予定 {schCount}件</span>
                      </span>
                    )}
                    {taskCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold flex items-center gap-1 text-[10px]">
                        <CheckSquare className="w-3 h-3" />
                        <span>タスク {taskCount}件</span>
                      </span>
                    )}
                    {memoCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1 text-[10px]">
                        <FileText className="w-3 h-3" />
                        <span>メモ {memoCount}件</span>
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 ml-auto">
                      {new Date(log.createdAt).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
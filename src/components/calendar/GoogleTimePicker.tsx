'use client';

import React, { useState } from 'react';
import { Clock, Keyboard, X } from 'lucide-react';

interface GoogleTimePickerProps {
  initialTime?: string; // "HH:MM" (24h)
  onConfirm: (timeStr: string) => void;
  onClose: () => void;
}

export default function GoogleTimePicker({
  initialTime = '12:00',
  onConfirm,
  onClose,
}: GoogleTimePickerProps) {
  // 初期値の解析
  const [initH, initM] = initialTime.split(':').map((v) => parseInt(v, 10) || 0);

  const [hour, setHour] = useState<number>(initH >= 0 && initH <= 23 ? initH : 12);
  const [minute, setMinute] = useState<number>(initM >= 0 && initM <= 59 ? initM : 0);
  const [pickerStage, setPickerStage] = useState<'hour' | 'minute'>('hour');
  const [inputMode, setInputMode] = useState<'clock' | 'keyboard'>('clock');

  // AM/PM判定
  const isPM = hour >= 12;
  const display12Hour = hour % 12 === 0 ? 12 : hour % 12;

  const handleSetAMPM = (targetPM: boolean) => {
    if (targetPM && !isPM) {
      setHour((h) => h + 12);
    } else if (!targetPM && isPM) {
      setHour((h) => h - 12);
    }
  };

  const handleSelect12Hour = (h12: number) => {
    const actualHour = isPM ? (h12 === 12 ? 12 : h12 + 12) : h12 === 12 ? 0 : h12;
    setHour(actualHour);
    setPickerStage('minute'); // 時を選んだら自動で分へ進むGoogle仕様
  };

  const handleSelectMinute = (m: number) => {
    setMinute(m);
  };

  const formattedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 flex flex-col items-center space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="w-full flex items-center justify-between pb-1 border-b border-slate-100">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            時刻を選択
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 時刻表示部（Googleスタイル：時と分の切り替えタブ） */}
        <div className="flex items-center gap-2 select-none">
          <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
            <button
              onClick={() => setPickerStage('hour')}
              className={`px-3 py-2 rounded-xl text-3xl font-black font-mono transition ${
                pickerStage === 'hour'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200/60'
              }`}
            >
              {display12Hour.toString().padStart(2, '0')}
            </button>
            <span className="text-2xl font-black text-slate-400 px-1">:</span>
            <button
              onClick={() => setPickerStage('minute')}
              className={`px-3 py-2 rounded-xl text-3xl font-black font-mono transition ${
                pickerStage === 'minute'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200/60'
              }`}
            >
              {minute.toString().padStart(2, '0')}
            </button>
          </div>

          {/* AM / PM 切替ボタン */}
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleSetAMPM(false)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                !isPM ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              午前
            </button>
            <button
              onClick={() => handleSetAMPM(true)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                isPM ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              午後
            </button>
          </div>
        </div>

        {/* ── アナログ時計モード ── */}
        {inputMode === 'clock' && (
          <div className="relative w-64 h-64 rounded-full bg-slate-100/90 border border-slate-200/80 flex items-center justify-center select-none shadow-inner">
            {/* 中心点 */}
            <div className="w-3 h-3 rounded-full bg-indigo-600 absolute z-10" />

            {/* 針（時または分） */}
            {(() => {
              const deg =
                pickerStage === 'hour'
                  ? ((display12Hour % 12) / 12) * 360
                  : (minute / 60) * 360;
              return (
                <div
                  className="absolute w-1 bg-indigo-600 origin-bottom rounded-full"
                  style={{
                    height: '84px',
                    top: '44px',
                    transform: `rotate(${deg}deg)`,
                    transformOrigin: 'bottom center',
                  }}
                >
                  <div className="w-7 h-7 rounded-full bg-indigo-600 absolute -top-3.5 -left-3 flex items-center justify-center text-white text-xs font-bold shadow-xs">
                    {pickerStage === 'hour' ? display12Hour : minute}
                  </div>
                </div>
              );
            })()}

            {/* 時の文字盤 (1〜12) */}
            {pickerStage === 'hour' &&
              [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((val, idx) => {
                const angle = (idx * 30 * Math.PI) / 180;
                const radius = 96; // 中心からの距離
                const x = radius * Math.sin(angle);
                const y = -radius * Math.cos(angle);
                const isSelected = display12Hour === val;

                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleSelect12Hour(val)}
                    style={{
                      transform: `translate(${x}px, ${y}px)`,
                    }}
                    className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${
                      isSelected
                        ? 'text-white'
                        : 'text-slate-700 hover:bg-indigo-100 hover:text-indigo-600'
                    }`}
                  >
                    {val}
                  </button>
                );
              })}

            {/* 分の文字盤 (00, 05, 10, ... 55) */}
            {pickerStage === 'minute' &&
              [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((val, idx) => {
                const angle = (idx * 30 * Math.PI) / 180;
                const radius = 96;
                const x = radius * Math.sin(angle);
                const y = -radius * Math.cos(angle);
                const isSelected = minute === val;

                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleSelectMinute(val)}
                    style={{
                      transform: `translate(${x}px, ${y}px)`,
                    }}
                    className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition ${
                      isSelected
                        ? 'text-white'
                        : 'text-slate-700 hover:bg-indigo-100 hover:text-indigo-600'
                    }`}
                  >
                    {val.toString().padStart(2, '0')}
                  </button>
                );
              })}
          </div>
        )}

        {/* ── デジタルキーボード入力モード ── */}
        {inputMode === 'keyboard' && (
          <div className="py-8 space-y-4 w-full flex flex-col items-center">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hour}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 0 && val <= 23) setHour(val);
                  }}
                  className="w-20 p-3 text-center text-3xl font-black font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-600 text-slate-800"
                />
                <span className="text-[11px] font-bold text-slate-400 mt-1">時 (0〜23)</span>
              </div>
              <span className="text-3xl font-black text-slate-400">:</span>
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 0 && val <= 59) setMinute(val);
                  }}
                  className="w-20 p-3 text-center text-3xl font-black font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-600 text-slate-800"
                />
                <span className="text-[11px] font-bold text-slate-400 mt-1">分 (0〜59)</span>
              </div>
            </div>
          </div>
        )}

        {/* 下部ツールバー（モード切替 ＆ キャンセル・OK） */}
        <div className="w-full flex items-center justify-between pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setInputMode((m) => (m === 'clock' ? 'keyboard' : 'clock'))}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition flex items-center gap-1.5 text-xs font-bold"
            title={inputMode === 'clock' ? 'キーボードで直接入力' : '時計盤で選択'}
          >
            {inputMode === 'clock' ? (
              <>
                <Keyboard className="w-4 h-4 text-indigo-600" />
                <span>キー入力</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-indigo-600" />
                <span>時計盤</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm(formattedTime);
                onClose();
              }}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Googleカレンダー公式11色（Event colorId 1〜11 準拠）
export interface GoogleColorItem {
  id: string;
  name: string;
  hex: string;
  textHex: string;
  badgeClass: string;
}

// Googleカレンダー公式イベントカラーマスタ（1〜11）
export const GOOGLE_EVENT_COLORS: Record<string, { background: string; foreground: string; name: string }> = {
  '1': { background: '#a4bdfc', foreground: '#1d1d1d', name: 'ラベンダー' },
  '2': { background: '#7ae7bf', foreground: '#1d1d1d', name: 'セージ' },
  '3': { background: '#dbadff', foreground: '#1d1d1d', name: 'ぶどう' },
  '4': { background: '#ff887c', foreground: '#1d1d1d', name: 'フラミンゴ' },
  '5': { background: '#fbd75b', foreground: '#1d1d1d', name: 'バナナ' },
  '6': { background: '#ffb878', foreground: '#1d1d1d', name: 'みかん' },
  '7': { background: '#46d6db', foreground: '#1d1d1d', name: 'ピーコック' },
  '8': { background: '#e1e1e1', foreground: '#1d1d1d', name: 'グラファイト' },
  '9': { background: '#5484ed', foreground: '#ffffff', name: 'ブルーベリー' },
  '10': { background: '#51b749', foreground: '#ffffff', name: 'バジル' },
  '11': { background: '#dc2127', foreground: '#ffffff', name: 'トマト' },
};

export const GOOGLE_CALENDAR_COLORS: GoogleColorItem[] = [
  { id: 'peacock', name: 'ピーコック', hex: '#46d6db', textHex: '#1d1d1d', badgeClass: 'bg-[#46d6db] text-slate-900' },
  { id: 'tomato', name: 'トマト', hex: '#dc2127', textHex: '#ffffff', badgeClass: 'bg-[#dc2127] text-white' },
  { id: 'flamingo', name: 'フラミンゴ', hex: '#ff887c', textHex: '#1d1d1d', badgeClass: 'bg-[#ff887c] text-slate-900' },
  { id: 'tangerine', name: 'みかん', hex: '#ffb878', textHex: '#1d1d1d', badgeClass: 'bg-[#ffb878] text-slate-900' },
  { id: 'banana', name: 'バナナ', hex: '#fbd75b', textHex: '#1d1d1d', badgeClass: 'bg-[#fbd75b] text-slate-900' },
  { id: 'sage', name: 'セージ', hex: '#7ae7bf', textHex: '#1d1d1d', badgeClass: 'bg-[#7ae7bf] text-slate-900' },
  { id: 'basil', name: 'バジル', hex: '#51b749', textHex: '#ffffff', badgeClass: 'bg-[#51b749] text-white' },
  { id: 'blueberry', name: 'ブルーベリー', hex: '#5484ed', textHex: '#ffffff', badgeClass: 'bg-[#5484ed] text-white' },
  { id: 'lavender', name: 'ラベンダー', hex: '#a4bdfc', textHex: '#1d1d1d', badgeClass: 'bg-[#a4bdfc] text-slate-900' },
  { id: 'grape', name: 'ぶどう', hex: '#dbadff', textHex: '#1d1d1d', badgeClass: 'bg-[#dbadff] text-slate-900' },
  { id: 'graphite', name: 'グラファイト', hex: '#e1e1e1', textHex: '#1d1d1d', badgeClass: 'bg-[#e1e1e1] text-slate-900' },
];

export function getGoogleColor(colorIdOrHex?: string | null): GoogleColorItem {
  if (!colorIdOrHex) {
    // デフォルトはリビンユニティのGoogleカレンダー色（ライトシアン）
    return {
      id: '#9fe1e7',
      name: 'リビンユニティ',
      hex: '#9fe1e7',
      textHex: '#1d1d1d',
      badgeClass: 'bg-[#9fe1e7] text-slate-900',
    };
  }

  // 1. 16進数カラー（例: #9fe1e7, #cabdbf, #42d692）の場合
  if (colorIdOrHex.startsWith('#')) {
    const hex = colorIdOrHex;
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    // YIQ輝度計算で視認性の高い文字色（濃い黒/純白）を自動決定
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    const textHex = yiq >= 165 ? '#1d1d1d' : '#ffffff';
    return {
      id: hex,
      name: hex,
      hex,
      textHex,
      badgeClass: yiq >= 165 ? `bg-[${hex}] text-slate-900` : `bg-[${hex}] text-white`,
    };
  }

  // 2. Google Event colorId（'1'〜'11'）の場合
  if (GOOGLE_EVENT_COLORS[colorIdOrHex]) {
    const item = GOOGLE_EVENT_COLORS[colorIdOrHex];
    return {
      id: colorIdOrHex,
      name: item.name,
      hex: item.background,
      textHex: item.foreground,
      badgeClass: item.foreground === '#ffffff' ? `bg-[${item.background}] text-white` : `bg-[${item.background}] text-slate-900`,
    };
  }

  // 3. 従来のカラーID名（'peacock', 'basil'等）の場合
  const found = GOOGLE_CALENDAR_COLORS.find((c) => c.id === colorIdOrHex);
  if (found) return found;

  return {
    id: '#9fe1e7',
    name: 'リビンユニティ',
    hex: '#9fe1e7',
    textHex: '#1d1d1d',
    badgeClass: 'bg-[#9fe1e7] text-slate-900',
  };
}

// Googleカレンダー公式11色（Event colorId 1〜11 準拠）
export interface GoogleColorItem {
  id: string;
  name: string;
  hex: string;
  textHex: string;
  badgeClass: string;
}

export const GOOGLE_CALENDAR_COLORS: GoogleColorItem[] = [
  { id: 'peacock', name: 'ピーコック', hex: '#039be5', textHex: '#ffffff', badgeClass: 'bg-[#039be5] text-white' },
  { id: 'tomato', name: 'トマト', hex: '#d50000', textHex: '#ffffff', badgeClass: 'bg-[#d50000] text-white' },
  { id: 'flamingo', name: 'フラミンゴ', hex: '#e67c73', textHex: '#ffffff', badgeClass: 'bg-[#e67c73] text-white' },
  { id: 'tangerine', name: 'みかん', hex: '#f4511e', textHex: '#ffffff', badgeClass: 'bg-[#f4511e] text-white' },
  { id: 'banana', name: 'バナナ', hex: '#f6bf26', textHex: '#202124', badgeClass: 'bg-[#f6bf26] text-slate-900' },
  { id: 'sage', name: 'セージ', hex: '#33b679', textHex: '#ffffff', badgeClass: 'bg-[#33b679] text-white' },
  { id: 'basil', name: 'バジル', hex: '#0b8043', textHex: '#ffffff', badgeClass: 'bg-[#0b8043] text-white' },
  { id: 'blueberry', name: 'ブルーベリー', hex: '#3f51b5', textHex: '#ffffff', badgeClass: 'bg-[#3f51b5] text-white' },
  { id: 'lavender', name: 'ラベンダー', hex: '#7986cb', textHex: '#ffffff', badgeClass: 'bg-[#7986cb] text-white' },
  { id: 'grape', name: 'ぶどう', hex: '#8e24aa', textHex: '#ffffff', badgeClass: 'bg-[#8e24aa] text-white' },
  { id: 'graphite', name: 'グラファイト', hex: '#616161', textHex: '#ffffff', badgeClass: 'bg-[#616161] text-white' },
];

export function getGoogleColor(colorId?: string | null): GoogleColorItem {
  const found = GOOGLE_CALENDAR_COLORS.find((c) => c.id === colorId);
  return found || GOOGLE_CALENDAR_COLORS[0]; // デフォルトはピーコック（Googleブルー）
}

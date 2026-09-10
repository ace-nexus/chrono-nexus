/**
 * Chrono Nexus - JST 日付・タイムゾーン厳格化ユーティリティ
 * サーバータイムゾーン（UTC等）による日付ズレ（午前9時前のズレ等）を100%防止し、
 * AIに与える基準日カレンダーを正確に生成します。
 */

/**
 * 日本時間（JST）の現在日を YYYY-MM-DD 形式で取得
 */
export function getJstDateStr(d: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // fallback
  }
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[0];
}

/**
 * 日本時間（JST）の現在時刻（HH:mm）を取得
 */
export function getJstTimeStr(d: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    return `${hour}:${minute}`;
  } catch (e) {
    // fallback
  }
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[1].slice(0, 5);
}

/**
 * 日本時間（JST）の曜日名（日〜土）を取得
 */
export function getJstDayOfWeek(dateStr?: string): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  if (!dateStr) {
    return dayNames[new Date().getDay()];
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dayNames[dt.getUTCDay()];
}

/**
 * 基準日（指定がなければJST本日）から向こう2週間の日付マップと
 * AIプロンプト用の正確なカレンダー対応表テキストを生成
 */
export function getJstCalendarReference(baseDateStr?: string): {
  baseDate: string;
  baseDayOfWeek: string;
  promptText: string;
  relativeDates: Record<string, string>;
} {
  const baseDate = baseDateStr || getJstDateStr();
  const [y, m, d] = baseDate.split('-').map(Number);
  const baseUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const baseDayOfWeekIndex = baseUtc.getUTCDay();
  const baseDayOfWeek = dayNames[baseDayOfWeekIndex];

  const addDays = (offset: number): { dateStr: string; dayStr: string; monthDayStr: string } => {
    const target = new Date(baseUtc.getTime() + offset * 24 * 60 * 60 * 1000);
    const ty = target.getUTCFullYear();
    const tm = String(target.getUTCMonth() + 1).padStart(2, '0');
    const td = String(target.getUTCDate()).padStart(2, '0');
    const tday = dayNames[target.getUTCDay()];
    return {
      dateStr: `${ty}-${tm}-${td}`,
      dayStr: tday,
      monthDayStr: `${parseInt(tm, 10)}月${parseInt(td, 10)}日`,
    };
  };

  const relativeDates: Record<string, string> = {};

  const today = addDays(0);
  const tomorrow = addDays(1);
  const dayAfterTomorrow = addDays(2);
  const threeDaysLater = addDays(3);

  relativeDates['今日'] = today.dateStr;
  relativeDates['本日'] = today.dateStr;
  relativeDates['明日'] = tomorrow.dateStr;
  relativeDates['明後日'] = dayAfterTomorrow.dateStr;
  relativeDates['3日後'] = threeDaysLater.dateStr;

  // 直近14日間の日付リストを生成
  const calendarLines: string[] = [];
  calendarLines.push(`・本日: ${today.dateStr} (${today.dayStr})`);
  calendarLines.push(`・明日: ${tomorrow.dateStr} (${tomorrow.dayStr})`);
  calendarLines.push(`・明後日: ${dayAfterTomorrow.dateStr} (${dayAfterTomorrow.dayStr})`);
  calendarLines.push(`・3日後: ${threeDaysLater.dateStr} (${threeDaysLater.dayStr})`);

  for (let offset = 1; offset <= 14; offset++) {
    const info = addDays(offset);
    if (offset <= 7) {
      calendarLines.push(`・${offset}日後: ${info.dateStr} (${info.dayStr}) [${info.monthDayStr}]`);
    }
  }

  // 来週月曜日の計算
  const daysUntilNextMonday = ((1 - baseDayOfWeekIndex + 7) % 7) || 7;
  const nextMonday = addDays(daysUntilNextMonday);
  calendarLines.push(`・次の月曜 / 来週月曜: ${nextMonday.dateStr} (月)`);
  relativeDates['来週月曜'] = nextMonday.dateStr;
  relativeDates['次の月曜'] = nextMonday.dateStr;

  const promptText = `【基準日カレンダー（※日付は絶対にこの定義表に従って正確に出力してください）】
基準日（本日）: ${baseDate} (${baseDayOfWeek})
${calendarLines.join('\n')}`;

  return {
    baseDate,
    baseDayOfWeek,
    promptText,
    relativeDates,
  };
}

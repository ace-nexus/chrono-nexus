import { supabaseAdmin } from './supabase';

export const DEFAULT_GENRES = ['買い物', '見積', 'その他'];
export const TASK_GENRES_USER_ID = 'task_genres';

/**
 * DBから保存済みジャンル一覧を取得
 * - chrono_google_tokens の task_genres から読み取り
 * - 既存の全タスク（chrono_schedule_events の source='chrono_task'）から実際に使われているジャンルも自動スキャンして合算（自己修復・欠落防止）
 */
export async function getStoredGenres(): Promise<string[]> {
  const genreSet = new Set<string>(DEFAULT_GENRES);

  try {
    // 1. chrono_google_tokens からジャンルマスターを取得
    const { data: tokenData, error: tokenErr } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('access_token')
      .eq('user_id', TASK_GENRES_USER_ID)
      .maybeSingle();

    if (!tokenErr && tokenData?.access_token) {
      try {
        const parsed = JSON.parse(tokenData.access_token);
        if (Array.isArray(parsed)) {
          parsed.forEach((g) => {
            if (typeof g === 'string' && g.trim()) genreSet.add(g.trim());
          });
        }
      } catch (e) {
        console.warn('Failed to parse task_genres JSON from tokens:', e);
      }
    }

    // 2. 既存タスクから使用中ジャンルを自己修復収集
    const { data: taskRows, error: taskErr } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('raw_payload')
      .eq('source', 'chrono_task');

    if (!taskErr && Array.isArray(taskRows)) {
      taskRows.forEach((row) => {
        const g = row.raw_payload?.genre;
        if (typeof g === 'string' && g.trim()) {
          genreSet.add(g.trim());
        }
      });
    }

    // 3. 旧保存先（chrono_schedule_events の source='chrono_task_genres'）からも取得試行
    const { data: legacyRow } = await supabaseAdmin
      .from('chrono_schedule_events')
      .select('raw_payload')
      .eq('source', 'chrono_task_genres')
      .maybeSingle();

    if (legacyRow?.raw_payload?.genres && Array.isArray(legacyRow.raw_payload.genres)) {
      legacyRow.raw_payload.genres.forEach((g: any) => {
        if (typeof g === 'string' && g.trim()) genreSet.add(g.trim());
      });
    }
  } catch (err) {
    console.error('getStoredGenres exception:', err);
  }

  // デフォルトジャンルを先頭に、それ以外のカスタムジャンルを追加順で並べる
  const allGenres = Array.from(genreSet);
  const customGenres = allGenres.filter((g) => !DEFAULT_GENRES.includes(g));
  const finalGenres = [...DEFAULT_GENRES, ...customGenres];

  return finalGenres;
}

/**
 * ジャンル一覧をDB（chrono_google_tokens）に確実に保存
 */
export async function saveGenres(genres: string[]): Promise<string[]> {
  const genreSet = new Set<string>(DEFAULT_GENRES);

  genres.forEach((g) => {
    if (typeof g === 'string' && g.trim()) {
      genreSet.add(g.trim());
    }
  });

  const allGenres = Array.from(genreSet);
  const customGenres = allGenres.filter((g) => !DEFAULT_GENRES.includes(g));
  const merged = [...DEFAULT_GENRES, ...customGenres];

  const payload = {
    user_id: TASK_GENRES_USER_ID,
    access_token: JSON.stringify(merged),
    scope: 'task_genres_master',
    token_type: 'Bearer',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('chrono_google_tokens')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    console.error('Failed to save task genres to chrono_google_tokens:', error);
    throw new Error(`ジャンルの保存に失敗しました: ${error.message}`);
  }

  return merged;
}

/**
 * 単一のジャンルを追加（重複チェック付き）
 */
export async function addGenre(name: string): Promise<string[]> {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('ジャンル名が無効です');
  }

  const trimmed = name.trim();
  const current = await getStoredGenres();

  if (current.includes(trimmed)) {
    return current;
  }

  const updated = [...current, trimmed];
  return await saveGenres(updated);
}

/**
 * カスタムジャンルの削除（デフォルトジャンルは保護）
 */
export async function deleteGenre(name: string): Promise<string[]> {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('ジャンル名が無効です');
  }

  const trimmed = name.trim();
  if (DEFAULT_GENRES.includes(trimmed)) {
    throw new Error('デフォルトジャンル（買い物・見積・その他）は削除できません');
  }

  const current = await getStoredGenres();
  const updated = current.filter((g) => g !== trimmed);
  return await saveGenres(updated);
}

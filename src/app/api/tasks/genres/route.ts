import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const DEFAULT_GENRES = ['買い物', '見積', 'その他'];
const GENRES_STORAGE_KEY = 'chrono_task_genres';

// DBから保存済みジャンルを取得（なければデフォルト）
async function getStoredGenres(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('raw_payload')
      .eq('user_id', GENRES_STORAGE_KEY)
      .maybeSingle();

    if (data?.raw_payload?.genres && Array.isArray(data.raw_payload.genres)) {
      // 重複排除してマージ
      const merged = Array.from(new Set([...DEFAULT_GENRES, ...data.raw_payload.genres]));
      return merged;
    }
  } catch (e) {
    console.warn('Failed to load stored genres:', e);
  }
  return DEFAULT_GENRES;
}

// DBにジャンル一覧を保存
async function saveGenres(genres: string[]): Promise<void> {
  const merged = Array.from(new Set([...DEFAULT_GENRES, ...genres]));
  await supabaseAdmin
    .from('chrono_google_tokens')
    .upsert({
      user_id: GENRES_STORAGE_KEY,
      raw_payload: { genres: merged },
      access_token: 'dummy',
      refresh_token: 'dummy',
    });
}

// GET: ジャンル一覧取得
export async function GET() {
  try {
    const genres = await getStoredGenres();
    return NextResponse.json({ success: true, genres });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 新規ジャンル追加
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'ジャンル名が必要です' }, { status: 400 });
    }

    const trimmed = name.trim();
    const current = await getStoredGenres();

    if (current.includes(trimmed)) {
      return NextResponse.json({ success: true, genres: current });
    }

    const updated = [...current, trimmed];
    await saveGenres(updated);

    return NextResponse.json({ success: true, genres: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: カスタムジャンル削除（デフォルトジャンルは削除不可）
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name')?.trim();

    if (!name) {
      return NextResponse.json({ error: 'ジャンル名が必要です' }, { status: 400 });
    }

    if (DEFAULT_GENRES.includes(name)) {
      return NextResponse.json({ error: 'デフォルトジャンルは削除できません' }, { status: 400 });
    }

    const current = await getStoredGenres();
    const updated = current.filter((g) => g !== name);
    await saveGenres(updated);

    return NextResponse.json({ success: true, genres: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
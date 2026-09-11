import { NextResponse } from 'next/server';
import { getStoredGenres, addGenre, deleteGenre } from '@/lib/taskGenres';

// GET: 保存済みジャンル一覧取得
export async function GET() {
  try {
    const genres = await getStoredGenres();
    return NextResponse.json({ success: true, genres });
  } catch (err: any) {
    console.error('GET /api/tasks/genres error:', err);
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

    const updated = await addGenre(name.trim());
    return NextResponse.json({ success: true, genres: updated });
  } catch (err: any) {
    console.error('POST /api/tasks/genres error:', err);
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

    const updated = await deleteGenre(name);
    return NextResponse.json({ success: true, genres: updated });
  } catch (err: any) {
    console.error('DELETE /api/tasks/genres error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
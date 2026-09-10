import { NextResponse } from 'next/server';
import {
  getRegisteredSpots,
  saveRegisteredSpot,
  deleteRegisteredSpot,
} from '@/lib/registeredSpots';

// GET: 登録スポット一覧の取得
export async function GET() {
  try {
    const spots = await getRegisteredSpots();
    return NextResponse.json({ success: true, spots });
  } catch (err: any) {
    console.error('GET /api/location/spots error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: スポットの新規登録または更新（過去ログへも自動遡及反映）
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, name, address, latitude, longitude, radiusMeters, category } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: '登録名（現場名等）は必須です' }, { status: 400 });
    }
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ error: '緯度・経度が必要です' }, { status: 400 });
    }

    const saved = await saveRegisteredSpot({
      id,
      name: name.trim(),
      address: (address || '').trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusMeters: radiusMeters ? Number(radiusMeters) : 150,
      category: category || 'site',
    });

    return NextResponse.json({
      success: true,
      spot: saved,
      message: `「${saved.name}」を登録しました。今後の滞在および過去ログに反映されます。`,
    });
  } catch (err: any) {
    console.error('POST /api/location/spots error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: スポットの削除
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '削除対象のIDが必要です' }, { status: 400 });
    }

    const success = await deleteRegisteredSpot(id);
    if (!success) {
      return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'スポットを削除しました' });
  } catch (err: any) {
    console.error('DELETE /api/location/spots error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

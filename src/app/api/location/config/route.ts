import { NextResponse } from 'next/server';

// クライアント側Google Maps読み込み用のキー配信エンドポイント
export async function GET() {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
    return NextResponse.json({
      success: true,
      apiKey,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

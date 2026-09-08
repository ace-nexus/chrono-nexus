import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, latitude, longitude, accuracy, recordedAt, placeName } = body;

    if (!latitude || !longitude) {
      return NextResponse.json({ error: '緯度・経度が必要です' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('chrono_location_tracks')
      .insert({
        user_id: userId || 'owner',
        latitude,
        longitude,
        accuracy,
        recorded_at: recordedAt || new Date().toISOString(),
        place_name: placeName,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase location insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, record: data });
  } catch (err: any) {
    console.error('Location API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date'); // YYYY-MM-DD

    let query = supabaseAdmin
      .from('chrono_location_tracks')
      .select('*')
      .order('recorded_at', { ascending: true });

    if (date) {
      const start = `${date}T00:00:00.000Z`;
      const end = `${date}T23:59:59.999Z`;
      query = query.gte('recorded_at', start).lte('recorded_at', end);
    } else {
      query = query.limit(50);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ records: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
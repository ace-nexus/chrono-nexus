import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getMunicipalityName(lat: number, lon: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const hrRes = await fetch(
      `https://geoapi.heartrails.com/api/json?method=getTowns&x=${lon}&y=${lat}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (hrRes.ok) {
      const hrData = await hrRes.json();
      const loc = hrData?.response?.location?.[0];
      if (loc) {
        return loc.city || `${loc.prefecture} ${loc.city}`;
      }
    }
  } catch (e) {
    // fallback
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=ja`,
      {
        headers: { 'User-Agent': 'ChronoNexus/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      const addr = nomData?.address;
      if (addr) {
        return addr.city_district || addr.suburb || addr.city || addr.town || addr.village || null;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, latitude, longitude, accuracy, recordedAt, placeName } = body;

    if (!latitude || !longitude) {
      return NextResponse.json({ error: '緯度・経度が必要です' }, { status: 400 });
    }

    let resolvedPlace = placeName;
    if (!resolvedPlace) {
      resolvedPlace = await getMunicipalityName(latitude, longitude);
    }

    const { data, error } = await supabaseAdmin
      .from('chrono_location_tracks')
      .insert({
        user_id: userId || 'owner',
        latitude,
        longitude,
        accuracy,
        recorded_at: recordedAt || new Date().toISOString(),
        place_name: resolvedPlace || null,
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
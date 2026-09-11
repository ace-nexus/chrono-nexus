import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address');

    if (!address || !address.trim()) {
      return NextResponse.json({ error: '住所が必要です' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address.trim()
        )}&key=${apiKey}&language=ja`;

        const res = await fetch(googleUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'OK' && data.results && data.results.length > 0) {
            const first = data.results[0];
            return NextResponse.json({
              success: true,
              latitude: first.geometry.location.lat,
              longitude: first.geometry.location.lng,
              formattedAddress: first.formatted_address,
              placeId: first.place_id,
            });
          }
        }
      } catch (e) {
        console.error('Google Geocode error, falling back to GSI:', e);
      }
    }

    // フォールバック: 国土地理院 API
    try {
      const gsiUrl = `https://msearch.gsi.go.jp/address-search/queryString?q=${encodeURIComponent(
        address.trim()
      )}`;
      const res = await fetch(gsiUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const first = data[0];
          return NextResponse.json({
            success: true,
            latitude: first.geometry.coordinates[1],
            longitude: first.geometry.coordinates[0],
            formattedAddress: first.properties?.title || address,
          });
        }
      }
    } catch (e) {
      console.error('GSI Geocode error:', e);
    }

    return NextResponse.json({ error: '住所の座標が見つかりませんでした' }, { status: 404 });
  } catch (err: any) {
    console.error('GET /api/location/geocode error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

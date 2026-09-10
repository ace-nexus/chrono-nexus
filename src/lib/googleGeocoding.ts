/**
 * Google Geocoding API ヘルパー
 * 緯度経度から日本の正確な番地付き住所・建物名・市区町村名を解決する
 */

export interface GoogleGeocodeResult {
  fullAddress: string;
  wardOrCity: string;
  buildingName: string | null;
  postalCode?: string | null;
}

// "日本、〒221-0863 " または "日本、" または "〒... " を除去して自然な日本語住所にする
export function cleanJapaneseAddress(formattedAddress: string): string {
  if (!formattedAddress) return '';
  return formattedAddress
    .replace(/^日本[、,]\s*/, '')
    .replace(/^〒\d{3}-\d{4}\s*/, '')
    .trim();
}

/**
 * 緯度経度からGoogle Geocoding APIで住所を解決
 */
export async function reverseGeocodeGoogle(
  lat: number,
  lon: number,
  apiKey?: string
): Promise<GoogleGeocodeResult | null> {
  const key = apiKey || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=ja&key=${encodeURIComponent(
      key
    )}`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Geocoding] HTTP error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      if (data.status !== 'ZERO_RESULTS') {
        console.warn(`[Geocoding] API error status: ${data.status}`, data.error_message);
      }
      return null;
    }

    const topResult = data.results[0];
    const fullAddress = cleanJapaneseAddress(topResult.formatted_address);

    // 区または市区町村名の抽出（手帳時間軸の短縮表示用）
    let wardOrCity = '';
    let postalCode: string | null = null;

    if (topResult.address_components) {
      for (const comp of topResult.address_components) {
        if (comp.types.includes('postal_code')) {
          postalCode = comp.long_name;
        }
        if (comp.types.includes('sublocality_level_1') && comp.long_name.endsWith('区')) {
          wardOrCity = comp.long_name;
        } else if (!wardOrCity && comp.types.includes('locality')) {
          wardOrCity = comp.long_name;
        }
      }
    }

    // 建物名・施設名（point_of_interest / establishment）の抽出
    let buildingName: string | null = null;
    for (const r of data.results) {
      if (r.types.includes('point_of_interest') || r.types.includes('establishment')) {
        const name = r.address_components?.[0]?.long_name;
        if (
          name &&
          !name.match(/^\d+/) &&
          !name.endsWith('丁目') &&
          !name.endsWith('町') &&
          !name.endsWith('区') &&
          !name.endsWith('市')
        ) {
          buildingName = name;
          break;
        }
      }
    }

    return {
      fullAddress,
      wardOrCity: wardOrCity || fullAddress,
      buildingName,
      postalCode,
    };
  } catch (err: any) {
    console.warn('[Geocoding] Fetch failed:', err.message);
    return null;
  }
}

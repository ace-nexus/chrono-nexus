import { supabaseAdmin } from './supabase';

/**
 * Gemini APIキーを安全に取得するヘルパー
 * 1. process.env.GEMINI_API_KEY（Vercel等の環境変数）を最優先
 * 2. 未設定の場合は Supabase DB（chrono_google_tokens: user_id='gemini_api_key'）から自動取得
 */
export async function getGeminiApiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('chrono_google_tokens')
      .select('access_token')
      .eq('user_id', 'gemini_api_key')
      .maybeSingle();

    if (error) {
      console.warn('Failed to fetch GEMINI_API_KEY from Supabase:', error.message);
      return null;
    }

    return data?.access_token || null;
  } catch (err) {
    console.error('getGeminiApiKey exception:', err);
    return null;
  }
}

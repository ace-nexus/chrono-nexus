import { createClient } from '@supabase/supabase-js';

// 環境変数から取得（トリムして余計な空白や改行を除去）
const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseUrl = (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))
  ? rawUrl
  : 'https://iuvwceltqshulefysvru.supabase.co';

// キーが空の場合でもビルド時（SSG）にクラッシュしないようフォールバックを用意
const supabaseServiceKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_secret_dummy_for_build_time'
).trim();

const supabaseAnonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  supabaseServiceKey
).trim();

// クライアント用
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// サーバーAPI用
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
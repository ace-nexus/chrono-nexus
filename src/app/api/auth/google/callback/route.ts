import { NextResponse } from 'next/server';
import { exchangeCodeForTokens, getRedirectUri } from '@/lib/googleCalendar';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    console.error('Google OAuth error:', error);
    return NextResponse.redirect(new URL('/?gcal_error=' + encodeURIComponent(error), req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?gcal_error=no_code', req.url));
  }

  try {
    const redirectUri = getRedirectUri();
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    const userId = 'owner';
    const expiryDate = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;

    // Supabaseにトークンを保存（upsert）
    const updateData: any = {
      user_id: userId,
      access_token: tokens.access_token,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || null,
      updated_at: new Date().toISOString(),
    };

    if (tokens.refresh_token) {
      updateData.refresh_token = tokens.refresh_token;
    }
    if (expiryDate) {
      updateData.expiry_date = expiryDate;
    }

    const { error: dbErr } = await supabaseAdmin
      .from('chrono_google_tokens')
      .upsert(updateData, { onConflict: 'user_id' });

    if (dbErr) {
      console.error('Failed to save Google token to DB:', dbErr);
      return NextResponse.redirect(new URL('/?gcal_error=db_save_failed', req.url));
    }

    // 成功したら連携完了フラグ付きでトップページへリダイレクト
    return NextResponse.redirect(new URL('/?gcal_connected=1', req.url));
  } catch (err: any) {
    console.error('Callback error:', err);
    return NextResponse.redirect(new URL('/?gcal_error=' + encodeURIComponent(err.message || 'unknown'), req.url));
  }
}

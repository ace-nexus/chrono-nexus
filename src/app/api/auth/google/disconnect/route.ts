import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST: Google連携の解除（DBからトークンを削除）
export async function POST(req: Request) {
  try {
    const userId = 'owner';

    const { error } = await supabaseAdmin
      .from('chrono_google_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to delete Google token:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Googleカレンダーとの連携を正常に解除しました',
    });
  } catch (err: any) {
    console.error('Disconnect error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

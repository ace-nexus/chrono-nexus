import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const noteId = formData.get('noteId') as string;

    if (!file || !noteId) {
      return NextResponse.json({ error: 'ファイルとnoteIdが必要です' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'jpg';
    const filePath = `notes/${noteId}/${timestamp}.${ext}`;

    // Supabase Storage にアップロード
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('chrono-photos')
      .upload(filePath, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // 公開URLを取得
    const { data: urlData } = supabaseAdmin.storage
      .from('chrono-photos')
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // chrono_raw_inputs に元データとして登録（非破壊）
    const { data: rawInput, error: rawError } = await supabaseAdmin
      .from('chrono_raw_inputs')
      .insert({
        note_id: noteId,
        input_type: 'photo',
        content: publicUrl,
        file_size_bytes: file.size,
      })
      .select()
      .single();

    if (rawError) throw rawError;

    return NextResponse.json({ success: true, url: publicUrl, rawInput });
  } catch (err: any) {
    console.error('Photo Upload API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
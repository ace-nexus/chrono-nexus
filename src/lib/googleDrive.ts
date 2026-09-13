import { getValidGoogleAccessToken } from './googleCalendar';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// フォルダの取得または作成
export async function getOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string | null> {
  try {
    let query = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const searchRes = await fetch(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
    }

    // フォルダが存在しない場合は新規作成
    const meta: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      meta.parents = [parentId];
    }

    const createRes = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meta),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      return created.id;
    } else {
      console.error('Failed to create Drive folder:', await createRes.text());
      return null;
    }
  } catch (err) {
    console.error('getOrCreateFolder error:', err);
    return null;
  }
}

// ChronoNexus/LocationHistory フォルダ階層の確保
export async function ensureLocationHistoryFolder(accessToken: string): Promise<string | null> {
  const rootAppFolderId = await getOrCreateFolder(accessToken, 'ChronoNexus');
  if (!rootAppFolderId) return null;
  return await getOrCreateFolder(accessToken, 'LocationHistory', rootAppFolderId);
}

// 1日分の位置ログ配列を Google Drive へアップロード（YYYY-MM-DD.json）
export async function uploadDailyLocationArchive(
  accessToken: string,
  dateStr: string,
  tracks: any[]
): Promise<{ success: boolean; fileId?: string; error?: string }> {
  try {
    const folderId = await ensureLocationHistoryFolder(accessToken);
    if (!folderId) {
      return { success: false, error: 'Google Driveのアーカイブフォルダを取得できませんでした' };
    }

    const fileName = `${dateStr}.json`;
    const jsonContent = JSON.stringify(
      {
        date: dateStr,
        archivedAt: new Date().toISOString(),
        trackCount: tracks.length,
        tracks,
      },
      null,
      2
    );

    // 既存ファイルが存在するか検索
    const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
    const searchRes = await fetch(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    let existingFileId: string | null = null;
    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        existingFileId = data.files[0].id;
      }
    }

    if (existingFileId) {
      // 既存ファイルの上書き更新
      const updateRes = await fetch(
        `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: jsonContent,
        }
      );

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        return { success: false, error: `Drive update failed: ${errText}` };
      }
      return { success: true, fileId: existingFileId };
    }

    // 新規ファイルのマルチパート作成
    const boundary = '-------ChronoNexusBoundary' + Date.now();
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json',
    };

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${jsonContent}\r\n` +
      `--${boundary}--\r\n`;

    const createRes = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { success: false, error: `Drive create failed: ${errText}` };
    }

    const created = await createRes.json();
    return { success: true, fileId: created.id };
  } catch (err: any) {
    console.error('uploadDailyLocationArchive error:', err);
    return { success: false, error: err.message };
  }
}

// Google Drive から指定日のアーカイブ（YYYY-MM-DD.json）を検索・取得
export async function fetchDailyLocationArchive(
  accessToken: string,
  dateStr: string
): Promise<any[] | null> {
  try {
    const fileName = `${dateStr}.json`;
    // ChronoNexus 内の該当ファイル名で検索
    const query = `name='${fileName}' and trashed=false`;
    const searchRes = await fetch(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    if (!data.files || data.files.length === 0) return null;

    const fileId = data.files[0].id;
    // ファイル内容のダウンロード
    const downloadRes = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!downloadRes.ok) return null;
    const fileJson = await downloadRes.json();
    return Array.isArray(fileJson.tracks) ? fileJson.tracks : (Array.isArray(fileJson) ? fileJson : null);
  } catch (err) {
    console.error('fetchDailyLocationArchive error:', err);
    return null;
  }
}

export { getValidGoogleAccessToken };

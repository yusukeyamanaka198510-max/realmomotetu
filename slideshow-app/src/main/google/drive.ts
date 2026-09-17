import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { OAuth2Client } from 'google-auth-library'
import { google, type drive_v3 } from 'googleapis'
import type { DriveLoadResult, MediaItem, MediaKind } from '@shared/types'

const SUPPORTED_MIME_TYPES: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video'
}

/** Accepts a raw Drive folder ID, or a full folder URL such as
 * `https://drive.google.com/drive/folders/<id>` or `...?id=<id>`. */
export function parseFolderId(input: string): string {
  const trimmed = input.trim()
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(trimmed)
  if (folderMatch) return folderMatch[1]
  const idParamMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(trimmed)
  if (idParamMatch) return idParamMatch[1]
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  throw new Error(`Could not parse a Google Drive folder ID from: ${input}`)
}

function driveClient(auth: OAuth2Client): drive_v3.Drive {
  return google.drive({ version: 'v3', auth })
}

export async function listFolderMedia(auth: OAuth2Client, folderInput: string): Promise<DriveLoadResult> {
  const folderId = parseFolderId(folderInput)
  const drive = driveClient(auth)

  const folderInfo = await drive.files.get({ fileId: folderId, fields: 'id,name,mimeType' })
  if (folderInfo.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('指定されたIDはGoogle Driveのフォルダではありません')
  }

  const items: MediaItem[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,size,createdTime)',
      pageSize: 1000,
      pageToken
    })
    for (const file of res.data.files ?? []) {
      const kind = file.mimeType ? SUPPORTED_MIME_TYPES[file.mimeType] : undefined
      if (!kind || !file.id) continue
      items.push({
        id: randomUUID(),
        driveFileId: file.id,
        name: file.name ?? file.id,
        mimeType: file.mimeType!,
        kind,
        sizeBytes: file.size ? Number(file.size) : 0,
        createdTime: file.createdTime ?? null,
        status: 'listed'
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return {
    items,
    imageCount: items.filter((i) => i.kind === 'image').length,
    videoCount: items.filter((i) => i.kind === 'video').length,
    folderName: folderInfo.data.name ?? folderId
  }
}

export async function downloadDriveFile(auth: OAuth2Client, fileId: string, destPath: string): Promise<void> {
  const drive = driveClient(auth)
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
  await pipeline(res.data, createWriteStream(destPath))
}

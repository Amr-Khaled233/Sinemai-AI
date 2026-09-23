import { put, del } from '@vercel/blob';
import { isAllowedUpload, type UploadKind } from '@/lib/security';

const MAX_BYTES = 8 * 1024 * 1024;

export class UploadError extends Error {}

/**
 * Uploads to Vercel Blob; falls back to no stored file when no token is set.
 *
 * The type check is not cosmetic: blobs are served from a public URL and opened
 * directly by browsers, so an uploaded .svg or .html would execute in that
 * origin. Callers declare what kind of file they expect.
 */
export async function uploadFile(file: File, prefix: string, kind: UploadKind = 'script') {
  if (file.size > MAX_BYTES) throw new UploadError('FILE_TOO_LARGE');
  if (!isAllowedUpload(kind, file.name, file.type)) throw new UploadError('UNSUPPORTED_FILE_TYPE');
  const safeName = file.name.replace(/[^\w.\-\u0600-\u06FF]+/g, '_').slice(-120);
  const key = `${prefix}/${Date.now()}-${safeName}`;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { url: null as string | null, pathname: key, storedInline: true };
  }

  const blob = await put(key, file, { access: 'public', addRandomSuffix: true });
  return { url: blob.url, pathname: blob.pathname, storedInline: false };
}

export async function deleteFile(url: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch {
    // A missing blob is not worth failing the caller for.
  }
}

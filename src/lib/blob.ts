import { put, del } from '@vercel/blob';

const MAX_BYTES = 8 * 1024 * 1024;

export const SCRIPT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/xml',
  'text/xml',
  'application/octet-stream', // .fountain / .fdx often arrive untyped
];

export class UploadError extends Error {}

/** Uploads to Vercel Blob; falls back to an inline data URL when no token is configured. */
export async function uploadFile(file: File, prefix: string) {
  if (file.size > MAX_BYTES) throw new UploadError('FILE_TOO_LARGE');
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

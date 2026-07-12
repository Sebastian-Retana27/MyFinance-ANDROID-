import TextRecognition from '@react-native-ml-kit/text-recognition';
import { getDb } from '../db/database';

export type OcrResult = { text: string; confidence: number; warnings: string[] };
export type OcrImageMeta = {
  width?: number;
  height?: number;
  fileSize?: number;
  fileName?: string;
  assetId?: string | null;
};
export type CachedOcrResult = OcrResult & { fromCache: boolean; cacheKey: string };
type OcrCacheEntry = OcrResult & { createdAt: string; lastAccessAt: string; signature: string };

const OCR_CACHE_PREFIX = 'ocr_cache:';
const OCR_CACHE_MAX_ITEMS = 120;
const OCR_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function buildImageSignature(imageUri: string, meta?: OcrImageMeta): string {
  return fnv1aHash([imageUri, meta?.width ?? '', meta?.height ?? '', meta?.fileSize ?? '', meta?.fileName ?? '', meta?.assetId ?? ''].join('|'));
}

function getImageWarnings(meta?: OcrImageMeta): string[] {
  if (!meta?.width || !meta.height) return [];
  const smallestSide = Math.min(meta.width, meta.height);
  if (smallestSide >= 720) return [];
  return ['La imagen tiene poca resolución. Para mejorar el OCR, usa una captura nítida y asegúrate de que el recibo ocupe la mayor parte de la imagen.'];
}

function cacheKey(signature: string): string {
  return `${OCR_CACHE_PREFIX}${signature}`;
}

async function cleanupOcrCache(): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM app_meta WHERE key LIKE 'ocr_cache:%'");
  const parsed = rows.flatMap((row) => {
    try {
      return [{ key: row.key, entry: JSON.parse(row.value) as OcrCacheEntry }];
    } catch {
      return [];
    }
  });
  for (const row of parsed) {
    const lastAccess = new Date(row.entry.lastAccessAt).getTime();
    if (!Number.isFinite(lastAccess) || now - lastAccess > OCR_CACHE_TTL_MS) await db.runAsync('DELETE FROM app_meta WHERE key = ?', row.key);
  }
  const alive = await db.getAllAsync<{ key: string }>("SELECT key FROM app_meta WHERE key LIKE 'ocr_cache:%' ORDER BY key ASC");
  for (const row of alive.slice(0, Math.max(0, alive.length - OCR_CACHE_MAX_ITEMS))) await db.runAsync('DELETE FROM app_meta WHERE key = ?', row.key);
}

async function readCached(signature: string): Promise<{ key: string; entry: OcrCacheEntry } | null> {
  const db = await getDb();
  const key = cacheKey(signature);
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', key);
  if (!row?.value) return null;
  try {
    const entry = JSON.parse(row.value) as OcrCacheEntry;
    if (!entry.text || !entry.lastAccessAt) return null;
    return { key, entry: { ...entry, warnings: entry.warnings ?? [] } };
  } catch {
    return null;
  }
}

async function writeCached(signature: string, result: OcrResult): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const entry: OcrCacheEntry = { ...result, createdAt: now, lastAccessAt: now, signature };
  await db.runAsync("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", cacheKey(signature), JSON.stringify(entry));
}

export async function readTextFromImageLocal(imageUri: string, meta?: OcrImageMeta): Promise<OcrResult> {
  if (!imageUri) throw new Error('No se recibió una imagen para procesar.');
  try {
    const result = await TextRecognition.recognize(imageUri);
    const text = result.text?.trim() ?? '';
    if (!text) throw new Error('No se detectó texto en la imagen.');
    return { text, confidence: 1, warnings: getImageWarnings(meta) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("doesn't seem to be linked") || message.includes('Expo managed workflow')) {
      throw new Error('OCR automático requiere una build Android nativa (Dev Client o APK/AAB). No está disponible en Expo Go.');
    }
    throw new Error(`Falló el OCR local: ${message}`);
  }
}

export async function readTextFromImageLocalCached(params: { imageUri: string; meta?: OcrImageMeta; forceRefresh?: boolean }): Promise<CachedOcrResult> {
  const signature = buildImageSignature(params.imageUri, params.meta);
  const key = cacheKey(signature);
  if (!params.forceRefresh) {
    const cached = await readCached(signature);
    if (cached) {
      const db = await getDb();
      const entry = { ...cached.entry, lastAccessAt: new Date().toISOString() };
      await db.runAsync('UPDATE app_meta SET value = ? WHERE key = ?', JSON.stringify(entry), cached.key);
      return { text: entry.text, confidence: entry.confidence, warnings: [...entry.warnings, ...getImageWarnings(params.meta)], fromCache: true, cacheKey: key };
    }
  }
  const result = await readTextFromImageLocal(params.imageUri, params.meta);
  await writeCached(signature, result);
  await cleanupOcrCache();
  return { ...result, fromCache: false, cacheKey: key };
}

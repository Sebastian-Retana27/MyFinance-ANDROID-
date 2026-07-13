import { getDb } from '../db/database';
import { roundCurrencyAmount } from '../constants/currencies';

export type ExchangeRateQuote = {
  base: string;
  quote: string;
  rate: number;
  date: string;
  fetchedAt: string;
  fromCache: boolean;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const REQUEST_TIMEOUT_MS = 12_000;

function cacheKey(base: string, quote: string): string {
  return `fx_rate:${base.toUpperCase()}:${quote.toUpperCase()}`;
}

function isValidQuote(value: unknown): value is Omit<ExchangeRateQuote, 'fromCache'> {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.base === 'string' && typeof item.quote === 'string' && typeof item.rate === 'number' && Number.isFinite(item.rate) && item.rate > 0 && typeof item.date === 'string' && typeof item.fetchedAt === 'string';
}

async function readCachedRate(base: string, quote: string): Promise<Omit<ExchangeRateQuote, 'fromCache'> | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', cacheKey(base, quote));
  if (!row?.value) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return isValidQuote(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveRate(value: Omit<ExchangeRateQuote, 'fromCache'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    cacheKey(value.base, value.quote),
    JSON.stringify(value)
  );
}

/** Gets a daily reference rate from the public, no-key Frankfurter API and caches it locally. */
export async function getExchangeRate(base: string, quote: string, forceRefresh = false): Promise<ExchangeRateQuote> {
  const normalizedBase = base.toUpperCase();
  const normalizedQuote = quote.toUpperCase();
  if (normalizedBase === normalizedQuote) {
    return { base: normalizedBase, quote: normalizedQuote, rate: 1, date: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), fromCache: true };
  }
  const cached = await readCachedRate(normalizedBase, normalizedQuote);
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
  if (cached && !forceRefresh && Number.isFinite(age) && age < CACHE_TTL_MS) return { ...cached, fromCache: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(normalizedBase)}/${encodeURIComponent(normalizedQuote)}`,
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('Invalid rate response');
    const data = payload as Record<string, unknown>;
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid rate');
    const fresh = {
      base: normalizedBase,
      quote: normalizedQuote,
      rate,
      date: typeof data.date === 'string' ? data.date : new Date().toISOString().slice(0, 10),
      fetchedAt: new Date().toISOString(),
    };
    await saveRate(fresh);
    return { ...fresh, fromCache: false };
  } catch (error) {
    if (cached) return { ...cached, fromCache: true };
    throw new Error('No se pudo obtener una tasa de cambio. Conéctate a Internet e inténtalo de nuevo.');
  } finally {
    clearTimeout(timeout);
  }
}

export function convertWithRate(amount: number, rate: number, quoteCurrencyCode = 'CRC'): number {
  return roundCurrencyAmount(amount * rate, quoteCurrencyCode);
}

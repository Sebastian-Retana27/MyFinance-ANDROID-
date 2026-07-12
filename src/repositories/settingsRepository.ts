import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE, isSupportedCurrencyCode, type AppCurrencyCode } from '../constants/currencies';

export type AppLanguage = 'es' | 'en' | 'it' | 'ja';
export type AppThemeMode = 'dark' | 'light' | 'original';
export type AppNumberFormat = 'none' | 'comma' | 'dot_comma' | 'space_dot' | 'space_comma';

const LANGUAGE_KEY = 'app_language';
const THEME_MODE_KEY = 'app_theme_mode';
const NUMBER_FORMAT_KEY = 'app_number_format';
const DEFAULT_CURRENCY_KEY = 'default_currency_code';
const HIDE_AMOUNTS_KEY = 'hide_amounts';
const APP_PIN_KEY = 'app_pin';
const APP_LOCK_ENABLED_KEY = 'app_lock_enabled';
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

export async function getSavedLanguage(): Promise<AppLanguage> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', LANGUAGE_KEY);
  if (!row?.value) {
    return 'es';
  }

  if (row.value === 'en' || row.value === 'it' || row.value === 'ja') {
    return row.value;
  }
  return 'es';
}

export async function saveLanguage(language: AppLanguage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    LANGUAGE_KEY,
    language
  );
}

export async function getSavedThemeMode(): Promise<AppThemeMode> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', THEME_MODE_KEY);
  if (!row?.value) {
    return 'original';
  }

  if (row.value === 'light') {
    return 'light';
  }
  if (row.value === 'original') {
    return 'original';
  }
  return 'original';
}

export async function saveThemeMode(mode: AppThemeMode): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    THEME_MODE_KEY,
    mode
  );
}

export async function getSavedNumberFormat(): Promise<AppNumberFormat> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', NUMBER_FORMAT_KEY);
  if (!row?.value) {
    return 'comma';
  }

  const value = row.value.trim().toLowerCase();
  if (value === 'none' || value === 'comma' || value === 'dot_comma' || value === 'space_dot' || value === 'space_comma') {
    return value;
  }

  // Backward compatibility with previous builds.
  if (value === 'latam') {
    return 'dot_comma';
  }

  return 'comma';
}

export async function saveNumberFormat(format: AppNumberFormat): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    NUMBER_FORMAT_KEY,
    format
  );
}

export async function getHideAmounts(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', HIDE_AMOUNTS_KEY);
  return row?.value === '1';
}

export async function saveHideAmounts(value: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    HIDE_AMOUNTS_KEY,
    value ? '1' : '0'
  );
}

export async function getAppLockEnabled(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    APP_LOCK_ENABLED_KEY
  );
  return row?.value === '1';
}

export async function saveAppLockEnabled(value: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    APP_LOCK_ENABLED_KEY,
    value ? '1' : '0'
  );
}

export async function getSavedAppPin(): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', APP_PIN_KEY);
  return row?.value ?? '';
}

export async function saveAppPin(pin: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    APP_PIN_KEY,
    pin
  );
}

export async function getDefaultCurrencyCode(): Promise<AppCurrencyCode> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', DEFAULT_CURRENCY_KEY);
  return row?.value && isSupportedCurrencyCode(row.value) ? row.value : DEFAULT_CURRENCY_CODE;
}

export async function saveDefaultCurrencyCode(currencyCode: AppCurrencyCode): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    DEFAULT_CURRENCY_KEY,
    currencyCode
  );
}

export async function getOnboardingCompleted(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    ONBOARDING_COMPLETED_KEY
  );
  return row?.value === '1';
}

export async function saveOnboardingCompleted(value: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ONBOARDING_COMPLETED_KEY,
    value ? '1' : '0'
  );
}

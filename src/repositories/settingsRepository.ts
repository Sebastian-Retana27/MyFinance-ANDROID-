import { getDb } from '../db/database';

export type AppLanguage = 'es' | 'en';
export type AppThemeMode = 'dark' | 'light' | 'original';
export type AppNumberFormat = 'none' | 'comma' | 'dot_comma' | 'space_dot' | 'space_comma';

const LANGUAGE_KEY = 'app_language';
const THEME_MODE_KEY = 'app_theme_mode';
const NUMBER_FORMAT_KEY = 'app_number_format';
const HIDE_AMOUNTS_KEY = 'hide_amounts';
const APP_PIN_KEY = 'app_pin';
const APP_LOCK_ENABLED_KEY = 'app_lock_enabled';

export async function getSavedLanguage(): Promise<AppLanguage> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', LANGUAGE_KEY);
  if (!row?.value) {
    return 'es';
  }

  return row.value === 'en' ? 'en' : 'es';
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
    return 'dark';
  }

  if (row.value === 'light') {
    return 'light';
  }
  if (row.value === 'original') {
    return 'original';
  }
  return 'dark';
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

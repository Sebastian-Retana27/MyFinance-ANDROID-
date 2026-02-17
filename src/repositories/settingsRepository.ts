import { getDb } from '../db/database';

export type AppLanguage = 'es' | 'en';
export type AppThemeMode = 'dark' | 'light' | 'original';
export type AppNumberFormat = 'none' | 'comma' | 'dot_comma' | 'space_dot' | 'space_comma';

const LANGUAGE_KEY = 'app_language';
const THEME_MODE_KEY = 'app_theme_mode';
const NUMBER_FORMAT_KEY = 'app_number_format';

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

import { getDb } from '../db/database';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_CURRENCY_CODE, isSupportedCurrencyCode, type AppCurrencyCode } from '../constants/currencies';

export type AppLanguage = 'es' | 'en' | 'it' | 'ja';
export type AppThemeMode = 'dark' | 'light' | 'original';
export type AppNumberFormat = 'none' | 'comma' | 'dot_comma' | 'space_dot' | 'space_comma';
export type AppChartType = 'pie' | 'circle' | 'line' | 'bar';

const LANGUAGE_KEY = 'app_language';
const THEME_MODE_KEY = 'app_theme_mode';
const NUMBER_FORMAT_KEY = 'app_number_format';
const CHART_TYPE_KEY = 'app_chart_type';
const DEFAULT_CURRENCY_KEY = 'default_currency_code';
const HIDE_AMOUNTS_KEY = 'hide_amounts';
const APP_PIN_KEY = 'app_pin';
const SECURE_APP_PIN_KEY = 'myfinance_app_pin_v1';
const SECURE_PIN_ATTEMPTS_KEY = 'myfinance_app_pin_attempts_v1';
const APP_LOCK_ENABLED_KEY = 'app_lock_enabled';
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCKOUT_AFTER_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 30 * 1000;

type PinAttemptState = {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number;
};

function parsePinAttemptState(raw: string | null): PinAttemptState {
  if (!raw) {
    return { count: 0, lastAttemptAt: 0, lockedUntil: 0 };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') {
      return { count: 0, lastAttemptAt: 0, lockedUntil: 0 };
    }
    const state = value as Partial<PinAttemptState>;
    return {
      count: Number.isFinite(state.count) ? Math.max(0, Math.floor(state.count ?? 0)) : 0,
      lastAttemptAt: Number.isFinite(state.lastAttemptAt) ? state.lastAttemptAt ?? 0 : 0,
      lockedUntil: Number.isFinite(state.lockedUntil) ? state.lockedUntil ?? 0 : 0,
    };
  } catch {
    return { count: 0, lastAttemptAt: 0, lockedUntil: 0 };
  }
}

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
  if (row.value === 'dark') {
    return 'dark';
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
  const securedPin = await SecureStore.getItemAsync(SECURE_APP_PIN_KEY);
  if (securedPin) {
    return securedPin;
  }

  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', APP_PIN_KEY);
  const legacyPin = row?.value ?? '';
  if (!legacyPin) {
    return '';
  }

  // One-time migration from the legacy SQLite preference to Android/iOS secure storage.
  await SecureStore.setItemAsync(SECURE_APP_PIN_KEY, legacyPin);
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', APP_PIN_KEY);
  return legacyPin;
}

export async function getSavedChartType(): Promise<AppChartType> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', CHART_TYPE_KEY);
  if (row?.value === 'circle' || row?.value === 'line' || row?.value === 'bar') {
    return row.value;
  }
  return 'pie';
}

export async function saveChartType(type: AppChartType): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    CHART_TYPE_KEY,
    type
  );
}

export async function saveAppPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_APP_PIN_KEY, pin);
  const db = await getDb();
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', APP_PIN_KEY);
}

export async function getPinLockoutRemainingMs(): Promise<number> {
  const state = parsePinAttemptState(await SecureStore.getItemAsync(SECURE_PIN_ATTEMPTS_KEY));
  return Math.max(0, state.lockedUntil - Date.now());
}

export async function registerFailedPinAttempt(): Promise<number> {
  const now = Date.now();
  const previous = parsePinAttemptState(await SecureStore.getItemAsync(SECURE_PIN_ATTEMPTS_KEY));
  if (previous.lockedUntil > now) {
    return previous.lockedUntil - now;
  }

  const count = now - previous.lastAttemptAt > PIN_ATTEMPT_WINDOW_MS ? 1 : previous.count + 1;
  const lockedUntil = count >= PIN_LOCKOUT_AFTER_ATTEMPTS ? now + PIN_LOCKOUT_MS : 0;
  const next: PinAttemptState = {
    count: lockedUntil ? 0 : count,
    lastAttemptAt: now,
    lockedUntil,
  };
  await SecureStore.setItemAsync(SECURE_PIN_ATTEMPTS_KEY, JSON.stringify(next));
  return Math.max(0, lockedUntil - now);
}

export async function clearPinFailedAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_PIN_ATTEMPTS_KEY);
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

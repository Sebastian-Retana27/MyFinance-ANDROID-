import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  AppState,
  Animated,
  Image,
  InteractionManager,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Rect } from 'react-native-svg';
import { SkeletonBlock, SkeletonRows } from './src/components/Skeleton';
import { initDb } from './src/db/database';
import type { Account } from './src/models/account';
import type { Expense } from './src/models/expense';
import type { IncomeEntry } from './src/models/incomeEntry';
import type { Payable } from './src/models/payable';
import type { StoredProduct } from './src/models/product';
import type {
  MonthlyFinancialSummary,
  AnnualMonthlySummary,
  SortDirection as RepoSortDirection,
  Transaction,
  TransactionCursor,
  TransactionQueryFilters,
  TransactionSortField as RepoTransactionSortField,
} from './src/models/transaction';
import {
  createAccount,
  deleteAccountById,
  listAccounts,
  updateAccountBalance,
  updateAccountColor,
  updateAccountCurrency,
} from './src/repositories/accountRepository';
import { listBudgets, type CategoryBudget, upsertBudget, changeBudgetAmount, deleteBudget } from './src/repositories/budgetRepository';
import { addCategory, deleteCategory, listCategories } from './src/repositories/categoryRepository';
import {
  listCategoryColors,
  upsertCategoryColor,
  type CategoryColor,
} from './src/repositories/categoryColorRepository';
import { createExpense, listExpenses } from './src/repositories/expenseRepository';
import { createIncomeEntry, listIncomeEntries } from './src/repositories/incomeRepository';
import { createAccountMovement } from './src/repositories/accountMovementRepository';
import { createPayable, deletePayable, listPayables, markPayablePaid } from './src/repositories/payableRepository';
import {
  createTransaction,
  getAnnualFinancialSummary,
  getMonthlyFinancialSummary,
  listAnnualCategoryTotals,
  listAnnualMonthlySummary,
  listMonthlyAccountMovementTotals,
  listTransactionsPage,
} from './src/repositories/transactionRepository';
import {
  getSavedLanguage,
  getSavedAppPin,
  getAppLockEnabled,
  getHideAmounts,
  getSavedChartType,
  clearPinFailedAttempts,
  getPinLockoutRemainingMs,
  registerFailedPinAttempt,
  getSavedNumberFormat,
  getSavedThemeMode,
  getOnboardingCompleted,
  getDefaultCurrencyCode,
  saveAppLockEnabled,
  saveAppPin,
  saveChartType,
  saveDefaultCurrencyCode,
  saveHideAmounts,
  saveNumberFormat,
  saveLanguage,
  saveOnboardingCompleted,
  saveThemeMode,
  type AppLanguage,
  type AppChartType,
  type AppNumberFormat,
  type AppThemeMode,
} from './src/repositories/settingsRepository';
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY_CODE,
  getCurrencyOption,
  roundCurrencyAmount,
  type AppCurrencyCode,
} from './src/constants/currencies';
import {
  createProduct,
  createProducts,
  deleteProductById,
  listProducts,
} from './src/repositories/productRepository';
import { DEFAULT_PRODUCT_CATEGORIES, FALLBACK_CATEGORY } from './src/services/categoryService';
import { readTextFromImageLocalCached, type OcrImageMeta } from './src/services/ocrService';
import {
  analyzeReceiptText,
  detectReceiptDocumentType,
  detectReceiptTotalWithOptions,
  parseMoneyToken,
  type ReceiptAnalysis,
  type ReceiptItem,
} from './src/services/receiptAnalyzer';
import {
  createBackupPayload,
  restoreBackupPayload,
  validateBackupIntegrity,
  validateBackupPayload,
  type BackupPayload,
} from './src/services/backupService';

import { uiElevation, uiHeight, uiRadius, uiSpacing, uiTypography } from './src/ui/tokens';
import {
  getLanguageLabel,
  getSectionLabel,
  getSelectLabel,
  localize as translate,
  localizeLegacy,
} from './src/i18n/localization';
import { convertWithRate, getExchangeRate } from './src/services/exchangeRateService';

const PRIVACY_POLICY_URL = 'https://sebastian-retana27.github.io/MyFinance-ANDROID-/privacy.html';

// Keep the native splash visible while local settings and SQLite initialize.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type AppSection = 'inicio' | 'gastos' | 'transacciones' | 'graficoAnual' | 'cuentas' | 'presupuesto' | 'configuracion';
type TransferMode = 'received' | 'sent';
type QuickActionMode = 'expense' | 'income' | null;
type QuickRadialOption = 'income' | 'expense' | 'transfer' | null;
type QuickDateFilter = 'all' | 'today' | '7d' | 'month';
type TransactionSortField = 'date' | 'amount';
type SortDirection = 'desc' | 'asc';
type ReceiptPipelineStage =
  | 'idle'
  | 'processing_image'
  | 'analyzing_text'
  | 'total_detected'
  | 'total_not_detected'
  | 'error';

const SECTION_SYMBOLS: Record<AppSection, string> = {
  inicio: '\u2302',
  gastos: '\u20A1',
  transacciones: '\u2263',
  graficoAnual: '\u2197',
  cuentas: '\u25A4',
  presupuesto: '\u25D4',
  configuracion: '\u2699',
};

const DEV_OCR_DEBUG = false;
const DEV_PERF_LOG = false;
const BUTTON_ACTIVE_OPACITY = 0.78;

type CategorySlice = {
  category: string;
  total: number;
  percentage: number;
};

type OnboardingStep = {
  titleEs: string;
  titleEn: string;
  titleIt: string;
  titleJa: string;
  bodyEs: string;
  bodyEn: string;
  bodyIt: string;
  bodyJa: string;
};

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    titleEs: 'Bienvenido a MyFinance',
    titleEn: 'Welcome to MyFinance',
    titleIt: 'Benvenuto in MyFinance',
    titleJa: '\u3088\u3046\u3053\u305d MyFinance\u3078',
    bodyEs: 'Controla gastos, ingresos y metas financieras desde una sola aplicación.',
    bodyEn: 'Control expenses, income, and financial goals from one app.',
    bodyIt: 'Gestisci spese, entrate e obiettivi finanziari da un\u2019unica app.',
    bodyJa: '1\u3064\u306e\u30a2\u30d7\u30ea\u3067\u652f\u51fa\u3001\u53ce\u5165\u3001\u8ca1\u52d9\u76ee\u6a19\u3092\u7ba1\u7406\u3057\u307e\u3059\u3002',
  },
  {
    titleEs: 'Crea tu primera cuenta',
    titleEn: 'Create your first account',
    titleIt: 'Crea il tuo primo conto',
    titleJa: '\u6700\u521d\u306e\u53e3\u5ea7\u3092\u4f5c\u6210',
    bodyEs: 'Organiza efectivo, bancos y billeteras digitales.',
    bodyEn: 'Organize cash, banks, and digital wallets.',
    bodyIt: 'Organizza contanti, banche e portafogli digitali.',
    bodyJa: '\u73fe\u91d1\u3001\u9280\u884c\u3001\u30c7\u30b8\u30bf\u30eb\u30a6\u30a9\u30ec\u30c3\u30c8\u3092\u6574\u7406\u3057\u307e\u3059\u3002',
  },
  {
    titleEs: 'Registra tu primer ingreso',
    titleEn: 'Register your first income',
    titleIt: 'Registra la tua prima entrata',
    titleJa: '\u6700\u521d\u306e\u53ce\u5165\u3092\u767b\u9332',
    bodyEs: 'Comienza a construir tu historial financiero.',
    bodyEn: 'Start building your financial history.',
    bodyIt: 'Inizia a costruire la tua cronologia finanziaria.',
    bodyJa: '\u8ca1\u52d9\u5c65\u6b74\u3092\u4f5c\u308a\u59cb\u3081\u307e\u3057\u3087\u3046\u3002',
  },
  {
    titleEs: 'Analiza tus finanzas',
    titleEn: 'Analyze your finances',
    titleIt: 'Analizza le tue finanze',
    titleJa: '\u8ca1\u52d9\u3092\u5206\u6790',
    bodyEs: 'Obtén estadísticas, presupuestos y reportes inteligentes.',
    bodyEn: 'Get statistics, budgets, and smart reports.',
    bodyIt: 'Ottieni statistiche, budget e report intelligenti.',
    bodyJa: '\u7d71\u8a08\u3001\u4e88\u7b97\u3001\u30b9\u30de\u30fc\u30c8\u30ec\u30dd\u30fc\u30c8\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002',
  },
];

type TopVariosProduct = {
  name: string;
  totalAmount: number;
  totalUnits: number;
};

type BudgetWarningLevel = '50' | '25' | '10' | '0' | 'over';

type AppTheme = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSoft: string;
  inputBg: string;
  accent: string;
  accentStrong: string;
  accentText: string;
  dangerBg: string;
  dangerBorder: string;
  dangerText: string;
  navBg: string;
  navActiveBg: string;
  navActiveText: string;
  amountColor: string;
  placeholder: string;
  modalBackdrop: string;
};

const DARK_THEME: AppTheme = {
  background: '#191919',
  surface: '#191919',
  surfaceAlt: '#1c1c1c',
  border: '#374151',
  borderStrong: '#191919',
  text: '#f3f4f6',
  textMuted: '#9ca3af',
  textSoft: '#d1d5db',
  inputBg: '#111827',
  accent: '#0f766e',
  accentStrong: '#14b8a6',
  accentText: '#99f6e4',
  dangerBg: '#3b0a0a',
  dangerBorder: '#ef4444',
  dangerText: '#fecaca',
  navBg: '#1c1c1c',
  navActiveBg: '#0f2f33',
  navActiveText: '#99f6e4',
  amountColor: '#2dd4bf',
  placeholder: '#6b7280',
  modalBackdrop: 'rgba(0, 0, 0, 0.55)',
};

const ORIGINAL_THEME: AppTheme = {
  background: '#111827',
  surface: '#1f2937',
  surfaceAlt: '#0f172a',
  border: '#374151',
  borderStrong: '#334155',
  text: '#f3f4f6',
  textMuted: '#9ca3af',
  textSoft: '#d1d5db',
  inputBg: '#111827',
  accent: '#0f766e',
  accentStrong: '#14b8a6',
  accentText: '#99f6e4',
  dangerBg: '#3b0a0a',
  dangerBorder: '#ef4444',
  dangerText: '#fecaca',
  navBg: '#0f172a',
  navActiveBg: '#0f2f33',
  navActiveText: '#99f6e4',
  amountColor: '#2dd4bf',
  placeholder: '#6b7280',
  modalBackdrop: 'rgba(0, 0, 0, 0.55)',
};

const LIGHT_THEME: AppTheme = {
  background: '#e9eef5',
  surface: '#f4f7fb',
  surfaceAlt: '#e2e8f0',
  border: '#b7c3d4',
  borderStrong: '#9fb0c8',
  text: '#000000',
  textMuted: '#000000',
  textSoft: '#000000',
  inputBg: '#f8fafc',
  accent: '#ea580c',
  accentStrong: '#f97316',
  accentText: '#000000',
  dangerBg: '#fee2e2',
  dangerBorder: '#ef4444',
  dangerText: '#991b1b',
  navBg: '#dbe4f0',
  navActiveBg: '#ffedd5',
  navActiveText: '#000000',
  amountColor: '#000000',
  placeholder: '#64748b',
  modalBackdrop: 'rgba(15, 23, 42, 0.32)',
};

function formatDate(dateIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(dateIso));
}

function formatDateTime(dateIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(dateIso));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatCurrency(
  value: number,
  language: AppLanguage,
  numberFormat: AppNumberFormat,
  currencyCode: string = DEFAULT_CURRENCY_CODE
): string {
  const currency = getCurrencyOption(currencyCode);
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue < 0 ? '-' : '';
  const absolute = Math.abs(safeValue);
  const fixed = absolute.toFixed(currency.decimals);
  const [integerPartRaw, decimalPart] = fixed.split('.');
  const separators: Record<AppNumberFormat, { thousand: string; decimal: string }> = {
    none: { thousand: '', decimal: '.' },
    comma: { thousand: ',', decimal: '.' },
    dot_comma: { thousand: '.', decimal: ',' },
    space_dot: { thousand: ' ', decimal: '.' },
    space_comma: { thousand: ' ', decimal: ',' },
  };
  const selected = separators[numberFormat];
  const integerWithThousands = selected.thousand
    ? integerPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, selected.thousand)
    : integerPartRaw;

  const amount = currency.decimals > 0
    ? `${integerWithThousands}${selected.decimal}${decimalPart}`
    : integerWithThousands;

  if (currency.code === 'CRC' && language !== 'en') {
    return `${sign}${currency.symbol}${amount}`;
  }

  return `${sign}${currency.symbol} ${amount}`;
}

function parseAmountInput(raw: string): number {
  if (!raw || raw.trim().length === 0) {
    return Number.NaN;
  }
  return parseMoneyToken(raw);
}

function formatAmountInput(raw: string, numberFormat: AppNumberFormat, decimals = 2): string {
  const separators: Record<AppNumberFormat, { thousand: string; decimal: string }> = {
    none: { thousand: '', decimal: '.' },
    comma: { thousand: ',', decimal: '.' },
    dot_comma: { thousand: '.', decimal: ',' },
    space_dot: { thousand: ' ', decimal: '.' },
    space_comma: { thousand: ' ', decimal: ',' },
  };
  const selected = separators[numberFormat];
  const negative = raw.trim().startsWith('-') ? '-' : '';
  const normalized = raw.replace(/[^\d.,\s-]/g, '').replace(/\s/g, '');
  const lastDecimal = normalized.lastIndexOf(selected.decimal);
  const hasDecimal = lastDecimal >= 0;
  const integerRaw = (hasDecimal ? normalized.slice(0, lastDecimal) : normalized).replace(/[^\d]/g, '');
  const fractionRaw = hasDecimal ? normalized.slice(lastDecimal + 1).replace(/[^\d]/g, '').slice(0, decimals) : '';
  if (!integerRaw && !fractionRaw) return negative;
  const integer = integerRaw || '0';
  const grouped = selected.thousand ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, selected.thousand) : integer;
  if (!hasDecimal || decimals === 0) return `${negative}${grouped}`;
  return `${negative}${grouped}${selected.decimal}${fractionRaw}`;
}

function formatAmountValueForInput(value: number, numberFormat: AppNumberFormat, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const normalized = Math.abs(safe).toFixed(decimals);
  const [integer, fraction] = normalized.split('.');
  const separators: Record<AppNumberFormat, { thousand: string; decimal: string }> = {
    none: { thousand: '', decimal: '.' },
    comma: { thousand: ',', decimal: '.' },
    dot_comma: { thousand: '.', decimal: ',' },
    space_dot: { thousand: ' ', decimal: '.' },
    space_comma: { thousand: ' ', decimal: ',' },
  };
  const selected = separators[numberFormat];
  const grouped = selected.thousand ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, selected.thousand) : integer;
  const sign = safe < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${grouped}${selected.decimal}${fraction}` : `${sign}${grouped}`;
}

function getInsufficientFundsMessage(
  language: AppLanguage,
  accountName: string,
  balance: string,
  attempted: string,
  operation: 'charge' | 'deduction'
): string {
  const spanishOperation = operation === 'charge' ? 'Intento de cobro' : 'Intento de rebajo';
  const englishOperation = operation === 'charge' ? 'Attempted charge' : 'Attempted deduction';
  const italianOperation = operation === 'charge' ? 'Addebito tentato' : 'Detrazione tentata';
  const japaneseOperation = operation === 'charge' ? '\u8acb\u6c42\u984d' : '\u5dee\u3057\u5f15\u304d\u984d';

  return translate(
    language,
    `La cuenta "${accountName}" no tiene saldo suficiente.\nSaldo actual: ${balance}\n${spanishOperation}: ${attempted}`,
    `Account "${accountName}" has insufficient funds.\nCurrent balance: ${balance}\n${englishOperation}: ${attempted}`,
    `Il conto "${accountName}" non dispone di fondi sufficienti.\nSaldo attuale: ${balance}\n${italianOperation}: ${attempted}`,
    `\u53e3\u5ea7\u300c${accountName}\u300d\u306e\u6b8b\u9ad8\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002\n\u73fe\u5728\u306e\u6b8b\u9ad8: ${balance}\n${japaneseOperation}: ${attempted}`
  );
}

function getSimpleInsufficientFundsMessage(language: AppLanguage, accountName: string): string {
  return translate(
    language,
    `La cuenta "${accountName}" no tiene saldo suficiente.`,
    `Account "${accountName}" has insufficient funds.`,
    `Il conto "${accountName}" non dispone di fondi sufficienti.`,
    `\u53e3\u5ea7\u300c${accountName}\u300d\u306e\u6b8b\u9ad8\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002`
  );
}

function getGalleryPermissionMessage(language: AppLanguage, canAskAgain: boolean): string {
  return canAskAgain
    ? translate(
        language,
        'Activa permisos de galeria para cargar la captura.',
        'Enable gallery permissions to load the screenshot.',
        'Abilita i permessi della galleria per caricare la schermata.',
        '\u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8\u3092\u8aad\u307f\u8fbc\u3080\u306b\u306f\u30ae\u30e3\u30e9\u30ea\u30fc\u3078\u306e\u30a2\u30af\u30bb\u30b9\u3092\u8a31\u53ef\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
      )
    : translate(
        language,
        'Debes habilitar el permiso de galeria desde Ajustes del telefono.',
        'You must enable gallery permission from your phone settings.',
        'Devi abilitare il permesso della galleria dalle impostazioni del telefono.',
        '\u7aef\u672b\u306e\u8a2d\u5b9a\u304b\u3089\u30ae\u30e3\u30e9\u30ea\u30fc\u306e\u6a29\u9650\u3092\u6709\u52b9\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
      );
}

function getOcrContinuationMessage(
  language: AppLanguage,
  errorMessage: string,
  actionLabel: string,
  kind: 'receipt' | 'transfer'
): string {
  const guidance = kind === 'receipt'
    ? translate(
        language,
        `Puedes continuar: pega el texto detectado y presiona "${actionLabel}".`,
        `You can continue: paste the detected text and press "${actionLabel}".`,
        `Puoi continuare: incolla il testo rilevato e premi "${actionLabel}".`,
        `\u7d9a\u884c\u3067\u304d\u307e\u3059\u3002\u691c\u51fa\u3055\u308c\u305f\u30c6\u30ad\u30b9\u30c8\u3092\u8cbc\u308a\u4ed8\u3051\u3001\u300c${actionLabel}\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002`
      )
    : translate(
        language,
        'Puedes continuar: pega el texto detectado y presiona "Detectar monto total".',
        'You can continue: paste detected text and press "Detect total amount".',
        'Puoi continuare: incolla il testo rilevato e premi "Rileva importo totale".',
        '\u7d9a\u884c\u3067\u304d\u307e\u3059\u3002\u691c\u51fa\u3055\u308c\u305f\u30c6\u30ad\u30b9\u30c8\u3092\u8cbc\u308a\u4ed8\u3051\u3001\u300c\u5408\u8a08\u91d1\u984d\u3092\u691c\u51fa\u300d\u3092\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
      );
  return `${errorMessage}\n\n${guidance}`;
}

async function confirmProceedLowConfidence(params: {
  language: AppLanguage;
  messageEs: string;
  messageEn: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      localizeLegacy(params.language, 'Revisión obligatoria', 'Review required'),
      localizeLegacy(params.language, params.messageEs, params.messageEn),
      [
        {
          text: localizeLegacy(params.language, 'Cancelar', 'Cancel'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: localizeLegacy(params.language, 'Guardar de todos modos', 'Save anyway'),
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ]
    );
  });
}

function shouldUseUnnamedReceiptFallback(rawText: string, analysis: ReceiptAnalysis): boolean {
  if (analysis.items.length === 0) {
    return true;
  }

  const docType = detectReceiptDocumentType(rawText);
  if (docType === 'invoice' && analysis.items.length > 0) {
    return false;
  }

  const normalizedText = normalizeText(rawText);
  const metadataSignals = [
    'autorizacion',
    'referencia',
    'numero de cuenta',
    'tipo de transaccion',
    'comercio',
    'ciudad y pais',
    'tarjeta',
    'visa',
    'master',
    'comision',
    'sinpe',
  ];
  const hasMetadataSignals = metadataSignals.some((signal) => normalizedText.includes(signal));
  if (!hasMetadataSignals) {
    return false;
  }

  const nonProductTokens = [
    'monto',
    'total',
    'factura',
    'receipt',
    'crc',
    'visa',
    'master',
    'tarjeta',
    'referencia',
    'autorizacion',
    'fecha',
    'hora',
    'transaccion',
    'comision',
    'cuenta',
    'celular',
    'identificacion',
    'comercio',
    'ciudad',
    'pais',
    'producto',
  ];

  const hasNamedProduct = analysis.items.some((item) => {
    const normalizedName = normalizeText(item.name);
    if (!normalizedName) {
      return false;
    }

    if (nonProductTokens.some((token) => normalizedName.includes(token))) {
      return false;
    }

    return /[a-z]{3,}/.test(normalizedName);
  });

  return !hasNamedProduct;
}

function normalizeHexColor(value: string): string {
  const input = value.trim().toUpperCase();
  if (!input) {
    return '';
  }

  const withHash = input.startsWith('#') ? input : `#${input}`;
  const hexPattern = /^#[0-9A-F]{6}$/;
  return hexPattern.test(withHash) ? withHash : '';
}

function getBudgetWarningLevel(budgetAmount: number, spent: number): BudgetWarningLevel | null {
  const remaining = Number((budgetAmount - spent).toFixed(2));
  if (budgetAmount <= 0) {
    return spent > 0 ? 'over' : null;
  }

  if (remaining < 0) {
    return 'over';
  }

  if (remaining === 0) {
    return '0';
  }

  const remainingPct = (remaining / budgetAmount) * 100;
  if (remainingPct <= 10) {
    return '10';
  }
  if (remainingPct <= 25) {
    return '25';
  }
  if (remainingPct <= 50) {
    return '50';
  }

  return null;
}

function hasValidCategory(selectedCategory: string | null | undefined, categories: string[]): selectedCategory is string {
  return Boolean(selectedCategory && selectedCategory.trim().length > 0 && categories.includes(selectedCategory));
}

function parseDateInputToIso(raw: string): string | null {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function isSuspiciousDetectedAmount(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) {
    return true;
  }
  return value < 10 || value > 10000000;
}

function buildMailtoUrl(
  recipient: string,
  subject: string,
  body: string
): string {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${recipient}?${query}`;
}

function showDangerConfirm(params: {
  title: string;
  message: string;
  cancelText: string;
  confirmText: string;
  onConfirm: () => void;
}) {
  Alert.alert(params.title, params.message, [
    { text: params.cancelText, style: 'cancel' },
    {
      text: params.confirmText,
      style: 'destructive',
      onPress: params.onConfirm,
    },
  ]);
}

function isGenericProductName(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }

  return (
    /^producto(\s+\d+)?$/i.test(normalized) ||
    /^product(\s+\d+)?$/i.test(normalized) ||
    normalized === 'recibo sin nombre' ||
    normalized === 'receipt without name' ||
    normalized === 'item' ||
    normalized === 'articulo'
  );
}

const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  varios: '#94a3b8',
  celular: '#38bdf8',
  comida: '#34d399',
  hogar: '#f59e0b',
  transporte: '#f97316',
};

const COLOR_GROUPS = [
  {
    key: 'neutral',
    labelEs: 'Neutros',
    labelEn: 'Neutrals',
    colors: ['#FFFFFF', '#F8FAFC', '#E5E7EB', '#9CA3AF', '#4B5563', '#111827'],
  },
  {
    key: 'red',
    labelEs: 'Rojos',
    labelEn: 'Reds',
    colors: ['#FEE2E2', '#EF4444', '#7F1D1D'],
  },
  {
    key: 'orange',
    labelEs: 'Naranjas',
    labelEn: 'Oranges',
    colors: ['#FFEDD5', '#F97316', '#7C2D12'],
  },
  {
    key: 'yellow',
    labelEs: 'Amarillos',
    labelEn: 'Yellows',
    colors: ['#FEF9C3', '#EAB308', '#713F12'],
  },
  {
    key: 'green',
    labelEs: 'Verdes',
    labelEn: 'Greens',
    colors: ['#DCFCE7', '#22C55E', '#14532D'],
  },
  {
    key: 'cyan',
    labelEs: 'Cianes',
    labelEn: 'Cyans',
    colors: ['#CCFBF1', '#14B8A6', '#134E4A'],
  },
  {
    key: 'blue',
    labelEs: 'Azules',
    labelEn: 'Blues',
    colors: ['#DBEAFE', '#3B82F6', '#1E3A8A'],
  },
  {
    key: 'purple',
    labelEs: 'Morados',
    labelEn: 'Purples',
    colors: ['#F3E8FF', '#A855F7', '#581C87'],
  },
  {
    key: 'pink',
    labelEs: 'Rosas',
    labelEn: 'Pinks',
    colors: ['#FFE4E6', '#EC4899', '#831843'],
  },
] as const;

const ALL_COLOR_OPTIONS = COLOR_GROUPS.flatMap((group) => group.colors);

const TEXTS = {
  es: {
    navInicio: 'Inicio',
    navGastos: 'Gastos',
    navTransacciones: 'Transacciones',
    navCuentas: 'Cuentas',
    navPresupuesto: 'Presupuesto',
    navConfig: 'Configuración',
    subtitleGastos: 'Registro y consulta de gastos',
    subtitleTransacciones: 'Movimientos y productos por mes',
    subtitleCuentas: 'Gestión de cuentas',
    subtitleConfig: 'Configuración de la app',
    totalAccounts: 'Total cuentas',
    antExpense: 'Gasto hormiga (Varios)',
    noData: 'Sin datos',
    transport: 'Transporte',
    spendingStructure: 'Estructura de Gastos',
    productsByMonth: 'Productos por mes',
    filterYear: 'A\u00f1o',
    filterMonth: 'Mes',
    filterSearch: 'Buscar producto',
    searchPlaceholder: 'Escribe el nombre del producto',
    clearFilters: 'Limpiar filtros',
    loadingData: 'Cargando datos...',
    noProductsForFilters: 'No hay productos para los filtros seleccionados.',
    total: 'Total:',
    qty: 'Cantidad',
    account: 'Cuenta',
    noAccount: 'Sin cuenta',
    delete: 'Eliminar',
    uploadReceipt: 'Cargar captura de factura',
    pickScreenshot: 'Seleccionar captura',
    removeScreenshot: 'Quitar captura',
    receiptHelp: 'Pega o corrige el texto de la factura aquí. La app extrae: nombre, precio, unidades y total.',
    analyzeReceipt: 'Analizar factura',
    totalProducts: 'Total productos:',
    purchasedUnits: 'Unidades compradas:',
    totalMoney: 'Total de dinero:',
    saveDetectedProducts: 'Guardar productos detectados',
    manualExpense: 'Gasto manual',
    tabManualExpense: 'Gasto Manual',
    tabUploadReceipt: 'Subir Recibo',
    tabTransfer: 'Transferencia',
    tabTotal: 'Gastos Totales',
    tabIncomeAdded: 'Ingresos A\u00f1adidos',
    transferReceived: 'Recibí una Transferencia',
    transferMade: 'Hice una Transferencia',
    productName: 'Nombre de Producto',
    quantity: 'Cantidad',
    category: 'Categoría',
    newCategory: 'Nueva categoría',
    addCategory: 'Añadir categoría',
    deleteCategory: 'Eliminar categoría',
    amount: 'Monto',
    saveExpense: 'Guardar gasto',
    budgetByCategory: 'Presupuesto por categoría',
    maxBudget: 'Presupuesto máximo',
    saveBudget: 'Guardar presupuesto',
    adjustBudget: 'Ajustar presupuesto',
    increase: 'Aumentar',
    decrease: 'Disminuir',
    monthlySpent: 'Gastado del mes',
    remainingBudget: 'Restante',
    noBudgets: 'Aún no hay presupuestos configurados.',
    noAvailableBudgetCategories: 'Todas las categorías ya tienen presupuesto asignado.',
    budgetCategoryInUse: 'Esta categoría ya tiene un presupuesto asignado.',
    deleteBudget: 'Eliminar presupuesto',
    chartCategoryColors: 'Colores de categorías (gráfica)',
    saveCategoryColor: 'Guardar color',
    selectCategoryFirst: 'Selecciona una categoria primero.',
    accountActions: 'Acciones de cuenta',
    editColor: 'Editar color',
    changeColor: 'Cambiar color',
    hideColors: 'Ocultar colores',
    deleteAccount: 'Eliminar cuenta',
    accountDeleted: 'Cuenta eliminada.',
    noExpenses: 'Aún no hay gastos guardados.',
    noIncomeEntries: 'Aún no hay ingresos agregados.',
    createAccountFirst: 'Primero crea una cuenta en la seccion Cuentas.',
    bugNotice: '',
    ocrInProgress: '',
    buildNumber: 'Build 10 Estable',
    language: 'Idioma',
    theme: 'Tema',
    numberFormat: 'Formato numerico',
    numberFormatNone: 'Ninguna',
    numberFormatComma: '1,234,568',
    numberFormatDotComma: '1.234.567,89',
    numberFormatSpaceDot: '1 234 567.89',
    numberFormatSpaceComma: '1 234 567,89',
    darkMode: 'Oscuro',
    originalMode: 'Original',
    lightMode: 'Claro',
    originalThemePending: 'El tema Original aun no esta disponible.',
    reportError: 'Informar error',
    contact: 'Contacto',
    spanish: 'Español',
    english: 'English',
  },
  en: {
    navInicio: 'Home',
    navGastos: 'Expenses',
    navTransacciones: 'Transactions',
    navCuentas: 'Accounts',
    navPresupuesto: 'Budget',
    navConfig: 'Settings',
    subtitleGastos: 'Expense tracking and review',
    subtitleTransacciones: 'Monthly movements and products',
    subtitleCuentas: 'Account management',
    subtitleConfig: 'App settings',
    totalAccounts: 'Total accounts',
    antExpense: 'Small spend (Misc)',
    noData: 'No data',
    transport: 'Transport',
    spendingStructure: 'Spending Structure',
    productsByMonth: 'Products by month',
    filterYear: 'Year',
    filterMonth: 'Month',
    filterSearch: 'Search product',
    searchPlaceholder: 'Type product name',
    clearFilters: 'Clear filters',
    loadingData: 'Loading data...',
    noProductsForFilters: 'No products for selected filters.',
    total: 'Total:',
    qty: 'Qty',
    account: 'Account',
    noAccount: 'No account',
    delete: 'Delete',
    uploadReceipt: 'Load receipt screenshot',
    pickScreenshot: 'Choose screenshot',
    removeScreenshot: 'Remove screenshot',
    receiptHelp: 'Paste or fix receipt text here. The app extracts: name, price, units and total.',
    analyzeReceipt: 'Analyze receipt',
    totalProducts: 'Total products:',
    purchasedUnits: 'Purchased units:',
    totalMoney: 'Total amount:',
    saveDetectedProducts: 'Save detected products',
    manualExpense: 'Manual expense',
    tabManualExpense: 'Manual expense',
    tabUploadReceipt: 'Upload receipt',
    tabTransfer: 'Transfer',
    tabTotal: 'Total Expenses',
    tabIncomeAdded: 'Added Income',
    transferReceived: 'I received a transfer',
    transferMade: 'I made a transfer',
    productName: 'Product name',
    quantity: 'Quantity',
    category: 'Category',
    newCategory: 'New category',
    addCategory: 'Add category',
    deleteCategory: 'Delete category',
    amount: 'Amount',
    saveExpense: 'Save expense',
    budgetByCategory: 'Budget by category',
    maxBudget: 'Maximum budget',
    saveBudget: 'Save budget',
    adjustBudget: 'Adjust budget',
    increase: 'Increase',
    decrease: 'Decrease',
    monthlySpent: 'Spent this month',
    remainingBudget: 'Remaining',
    noBudgets: 'No budgets configured yet.',
    noAvailableBudgetCategories: 'All categories already have an assigned budget.',
    budgetCategoryInUse: 'This category already has an assigned budget.',
    deleteBudget: 'Delete budget',
    chartCategoryColors: 'Category colors (chart)',
    saveCategoryColor: 'Save color',
    selectCategoryFirst: 'Select a category first.',
    accountActions: 'Account actions',
    editColor: 'Edit color',
    changeColor: 'Change color',
    hideColors: 'Hide colors',
    deleteAccount: 'Delete account',
    accountDeleted: 'Account deleted.',
    noExpenses: 'No saved expenses yet.',
    noIncomeEntries: 'No added income yet.',
    createAccountFirst: 'Create an account first in Accounts section.',
    bugNotice: '',
    ocrInProgress: '',
    buildNumber: 'Build 10 Stable',
    language: 'Language',
    theme: 'Theme',
    numberFormat: 'Number format',
    numberFormatNone: 'None',
    numberFormatComma: '1,234,568',
    numberFormatDotComma: '1.234.567,89',
    numberFormatSpaceDot: '1 234 567.89',
    numberFormatSpaceComma: '1 234 567,89',
    darkMode: 'Dark',
    originalMode: 'Original',
    lightMode: 'Light',
    originalThemePending: 'The Original theme is not available yet.',
    reportError: 'Report error',
    contact: 'Contact',
    spanish: 'Spanish',
    english: 'English',
  },
  it: {
    navInicio: 'Home',
    navGastos: 'Spese',
    navTransacciones: 'Transazioni',
    navCuentas: 'Conti',
    navPresupuesto: 'Budget',
    navConfig: 'Impostazioni',
    subtitleGastos: 'Registrazione e revisione delle spese',
    subtitleTransacciones: 'Movimenti e prodotti mensili',
    subtitleCuentas: 'Gestione dei conti',
    subtitleConfig: 'Impostazioni dell’app',
    totalAccounts: 'Totale conti',
    antExpense: 'Piccole spese (Varie)',
    noData: 'Nessun dato',
    transport: 'Trasporto',
    spendingStructure: 'Struttura delle spese',
    productsByMonth: 'Prodotti per mese',
    filterYear: 'Anno',
    filterMonth: 'Mese',
    filterSearch: 'Cerca prodotto',
    searchPlaceholder: 'Scrivi il nome del prodotto',
    clearFilters: 'Cancella filtri',
    loadingData: 'Caricamento dati...',
    noProductsForFilters: 'Nessun prodotto per i filtri selezionati.',
    total: 'Totale:',
    qty: 'Qtà',
    account: 'Conto',
    noAccount: 'Nessun conto',
    delete: 'Elimina',
    uploadReceipt: 'Carica schermata della ricevuta',
    pickScreenshot: 'Scegli schermata',
    removeScreenshot: 'Rimuovi schermata',
    receiptHelp: 'Incolla o correggi qui il testo della ricevuta. L’app estrae: nome, prezzo, unità e totale.',
    analyzeReceipt: 'Analizza ricevuta',
    totalProducts: 'Totale prodotti:',
    purchasedUnits: 'Unità acquistate:',
    totalMoney: 'Importo totale:',
    saveDetectedProducts: 'Salva prodotti rilevati',
    manualExpense: 'Spesa manuale',
    tabManualExpense: 'Spesa manuale',
    tabUploadReceipt: 'Carica ricevuta',
    tabTransfer: 'Trasferimento',
    tabTotal: 'Spese totali',
    tabIncomeAdded: 'Entrate aggiunte',
    transferReceived: 'Ho ricevuto un trasferimento',
    transferMade: 'Ho effettuato un trasferimento',
    productName: 'Nome prodotto',
    quantity: 'Quantità',
    category: 'Categoria',
    newCategory: 'Nuova categoria',
    addCategory: 'Aggiungi categoria',
    deleteCategory: 'Elimina categoria',
    amount: 'Importo',
    saveExpense: 'Salva spesa',
    budgetByCategory: 'Budget per categoria',
    maxBudget: 'Budget massimo',
    saveBudget: 'Salva budget',
    adjustBudget: 'Modifica budget',
    increase: 'Aumenta',
    decrease: 'Diminuisci',
    monthlySpent: 'Speso questo mese',
    remainingBudget: 'Rimanente',
    noBudgets: 'Nessun budget configurato.',
    noAvailableBudgetCategories: 'Tutte le categorie hanno già un budget assegnato.',
    budgetCategoryInUse: 'Questa categoria ha già un budget assegnato.',
    deleteBudget: 'Elimina budget',
    chartCategoryColors: 'Colori categorie (grafico)',
    saveCategoryColor: 'Salva colore',
    selectCategoryFirst: 'Seleziona prima una categoria.',
    accountActions: 'Azioni conto',
    editColor: 'Modifica colore',
    changeColor: 'Cambia colore',
    hideColors: 'Nascondi colori',
    deleteAccount: 'Elimina conto',
    accountDeleted: 'Conto eliminato.',
    noExpenses: 'Nessuna spesa salvata.',
    noIncomeEntries: 'Nessuna entrata aggiunta.',
    createAccountFirst: 'Crea prima un conto nella sezione Conti.',
    bugNotice: '',
    ocrInProgress: '',
    buildNumber: 'Build 10 Stabile',
    language: 'Lingua',
    theme: 'Tema',
    numberFormat: 'Formato numerico',
    numberFormatNone: 'Nessuno',
    numberFormatComma: '1,234,568',
    numberFormatDotComma: '1.234.567,89',
    numberFormatSpaceDot: '1 234 567.89',
    numberFormatSpaceComma: '1 234 567,89',
    darkMode: 'Scuro',
    originalMode: 'Originale',
    lightMode: 'Chiaro',
    originalThemePending: 'Il tema Originale non è ancora disponibile.',
    reportError: 'Segnala errore',
    contact: 'Contatto',
    spanish: 'Spagnolo',
    english: 'Inglese',
  },
  ja: {
    navInicio: 'ホーム',
    navGastos: '支出',
    navTransacciones: '取引',
    navCuentas: '口座',
    navPresupuesto: '予算',
    navConfig: '設定',
    subtitleGastos: '支出の登録と確認',
    subtitleTransacciones: '月別の取引と商品',
    subtitleCuentas: '口座管理',
    subtitleConfig: 'アプリ設定',
    totalAccounts: '口座合計',
    antExpense: '小さな支出（その他）',
    noData: 'データなし',
    transport: '交通',
    spendingStructure: '支出構成',
    productsByMonth: '月別の商品',
    filterYear: '年',
    filterMonth: '月',
    filterSearch: '商品を検索',
    searchPlaceholder: '商品名を入力',
    clearFilters: 'フィルターをクリア',
    loadingData: 'データを読み込み中...',
    noProductsForFilters: '選択したフィルターの商品はありません。',
    total: '合計:',
    qty: '数量',
    account: '口座',
    noAccount: '口座なし',
    delete: '削除',
    uploadReceipt: 'レシート画像を読み込む',
    pickScreenshot: '画像を選択',
    removeScreenshot: '画像を削除',
    receiptHelp: 'レシートのテキストを貼り付けるか修正してください。アプリは名前、価格、数量、合計を抽出します。',
    analyzeReceipt: 'レシートを分析',
    totalProducts: '商品合計:',
    purchasedUnits: '購入数量:',
    totalMoney: '合計金額:',
    saveDetectedProducts: '検出した商品を保存',
    manualExpense: '手動支出',
    tabManualExpense: '手動支出',
    tabUploadReceipt: 'レシート読込',
    tabTransfer: '送金',
    tabTotal: '支出合計',
    tabIncomeAdded: '追加収入',
    transferReceived: '送金を受け取った',
    transferMade: '送金した',
    productName: '商品名',
    quantity: '数量',
    category: 'カテゴリ',
    newCategory: '新しいカテゴリ',
    addCategory: 'カテゴリを追加',
    deleteCategory: 'カテゴリを削除',
    amount: '金額',
    saveExpense: '支出を保存',
    budgetByCategory: 'カテゴリ別予算',
    maxBudget: '最大予算',
    saveBudget: '予算を保存',
    adjustBudget: '予算を調整',
    increase: '増やす',
    decrease: '減らす',
    monthlySpent: '今月の支出',
    remainingBudget: '残り',
    noBudgets: 'まだ予算は設定されていません。',
    noAvailableBudgetCategories: 'すべてのカテゴリに予算が割り当てられています。',
    budgetCategoryInUse: 'このカテゴリにはすでに予算があります。',
    deleteBudget: '予算を削除',
    chartCategoryColors: 'カテゴリ色（グラフ）',
    saveCategoryColor: '色を保存',
    selectCategoryFirst: '先にカテゴリを選択してください。',
    accountActions: '口座操作',
    editColor: '色を編集',
    changeColor: '色を変更',
    hideColors: '色を非表示',
    deleteAccount: '口座を削除',
    accountDeleted: '口座を削除しました。',
    noExpenses: '保存された支出はありません。',
    noIncomeEntries: '追加された収入はありません。',
    createAccountFirst: '先に「口座」セクションで口座を作成してください。',
    bugNotice: '',
    ocrInProgress: '',
    buildNumber: 'ビルド 10 安定版',
    language: '言語',
    theme: 'テーマ',
    numberFormat: '数値形式',
    numberFormatNone: 'なし',
    numberFormatComma: '1,234,568',
    numberFormatDotComma: '1.234.567,89',
    numberFormatSpaceDot: '1 234 567.89',
    numberFormatSpaceComma: '1 234 567,89',
    darkMode: 'ダーク',
    originalMode: 'オリジナル',
    lightMode: 'ライト',
    originalThemePending: 'オリジナルテーマはまだ利用できません。',
    reportError: 'エラーを報告',
    contact: '連絡先',
    spanish: 'スペイン語',
    english: '英語',
  },
} as const;

function getCategoryLabel(category: string, language: AppLanguage): string {
  const map: Record<string, Record<AppLanguage, string>> = {
    varios: { es: 'Varios', en: 'Misc', it: 'Varie', ja: 'その他' },
    celular: { es: 'Celular', en: 'Mobile', it: 'Telefono', ja: '携帯' },
    comida: { es: 'Comida', en: 'Food', it: 'Cibo', ja: '食費' },
    hogar: { es: 'Hogar', en: 'Home', it: 'Casa', ja: '住居' },
    transporte: { es: 'Transporte', en: 'Transport', it: 'Trasporto', ja: '交通' },
  };

  return map[category]?.[language] ?? capitalize(category);
}

function getIncomeSourceLabel(source: IncomeEntry['source'], language: AppLanguage): string {
  if (source === 'transfer_received') {
    return translate(language, 'Transferencia', 'Transfer', 'Trasferimento', '\u9001\u91d1');
  }
  return translate(language, 'Ingreso agregado', 'Added income', 'Entrata aggiunta', '\u8ffd\u52a0\u53ce\u5165');
}

function getTransactionSignedAmount(transaction: Transaction): number {
  if (transaction.type === 'expense' || transaction.type === 'transfer_out') {
    return -Math.abs(transaction.amount);
  }
  return Math.abs(transaction.amount);
}

function getTransactionTypeLabel(type: Transaction['type'], language: AppLanguage): string {
  if (type === 'income') {
    return translate(language, 'Ingreso', 'Income', 'Entrata', '\u53ce\u5165');
  }
  if (type === 'transfer_in') {
    return translate(language, 'Transferencia recibida', 'Transfer received', 'Trasferimento ricevuto', '\u53d7\u53d6\u9001\u91d1');
  }
  if (type === 'transfer_out') {
    return translate(language, 'Transferencia enviada', 'Transfer sent', 'Trasferimento inviato', '\u9001\u91d1\u6e08\u307f');
  }
  return translate(language, 'Gasto', 'Expense', 'Spesa', '\u652f\u51fa');
}

function getCurrencyLabel(currencyCode: string, language: AppLanguage): string {
  const currency = getCurrencyOption(currencyCode);
  if (language === 'it') {
    return currency.nameIt;
  }
  if (language === 'ja') {
    return currency.nameJa;
  }
  if (language === 'en') {
    return currency.nameEn;
  }
  return currency.nameEs;
}

function getReceiptWarningLabel(warning: string, language: AppLanguage): string {
  if (warning.startsWith('No pude detectar el total')) {
    return translate(language, 'No pude detectar el total del recibo con seguridad. Revísalo o ingrésalo manualmente.', 'I could not detect the receipt total with confidence. Review it or enter it manually.', 'Non ho rilevato con certezza il totale della ricevuta. Controllalo o inseriscilo manualmente.', 'レシートの合計を確実に検出できませんでした。確認するか、手動で入力してください。');
  }
  if (warning.startsWith('No pude detectar productos')) {
    return translate(language, 'No pude detectar productos claros. Puedes editar el texto o registrar solo el total.', 'I could not detect clear products. You can edit the text or save only the total.', 'Non ho rilevato prodotti chiari. Puoi modificare il testo o salvare solo il totale.', '明確な商品を検出できませんでした。テキストを編集するか、合計のみを保存できます。');
  }
  if (warning.startsWith('La suma de productos')) {
    return translate(language, 'La suma de productos no coincide con el total detectado. Revísalo antes de guardar.', 'The item total does not match the detected total. Review it before saving.', 'La somma dei prodotti non coincide con il totale rilevato. Controlla prima di salvare.', '商品の合計が検出した合計と一致しません。保存前に確認してください。');
  }
  return warning;
}

function getNumberFormatLabel(value: AppNumberFormat, texts: (typeof TEXTS)[AppLanguage]): string {
  if (value === 'none') return texts.numberFormatNone;
  if (value === 'dot_comma') return texts.numberFormatDotComma;
  if (value === 'space_dot') return texts.numberFormatSpaceDot;
  if (value === 'space_comma') return texts.numberFormatSpaceComma;
  return texts.numberFormatComma;
}

function getChartTypeLabel(value: AppChartType, language: AppLanguage): string {
  if (value === 'circle') return translate(language, 'Círculo', 'Circle', 'Cerchio', '\u5186');
  if (value === 'line') return translate(language, 'Líneas', 'Lines', 'Linee', '\u7dda');
  if (value === 'bar') return translate(language, 'Barras', 'Bars', 'Barre', '\u68d2');
  return translate(language, 'Pastel', 'Pie', 'Torta', '\u5186\u30b0\u30e9\u30d5');
}

function describePieSlice(
  center: number,
  radius: number,
  startRatio: number,
  endRatio: number
): string {
  const startAngle = startRatio * Math.PI * 2 - Math.PI / 2;
  const endAngle = endRatio * Math.PI * 2 - Math.PI / 2;
  const startX = center + radius * Math.cos(startAngle);
  const startY = center + radius * Math.sin(startAngle);
  const endX = center + radius * Math.cos(endAngle);
  const endY = center + radius * Math.sin(endAngle);
  const largeArc = endRatio - startRatio > 0.5 ? 1 : 0;
  return `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function App() {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<AppLanguage>('es');
  const [themeMode, setThemeMode] = useState<AppThemeMode>('original');
  const [numberFormat, setNumberFormat] = useState<AppNumberFormat>('comma');
  const [chartType, setChartType] = useState<AppChartType>('pie');
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState<AppCurrencyCode>(DEFAULT_CURRENCY_CODE);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appPin, setAppPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [amount, setAmount] = useState('');
  const [manualCategory, setManualCategory] = useState<string>(FALLBACK_CATEGORY);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [categoryColors, setCategoryColors] = useState<CategoryColor[]>([]);
  const [accountName, setAccountName] = useState('');
  const [accountBalanceInput, setAccountBalanceInput] = useState('');
  const [selectedAccountColor, setSelectedAccountColor] = useState<string>(ALL_COLOR_OPTIONS[0]);
  const [selectedAccountCurrencyCode, setSelectedAccountCurrencyCode] = useState<AppCurrencyCode>(DEFAULT_CURRENCY_CODE);
  const [budgetCategory, setBudgetCategory] = useState<string>(FALLBACK_CATEGORY);
  const [budgetAmountInput, setBudgetAmountInput] = useState('');
  const [budgetDeltaInput, setBudgetDeltaInput] = useState('');
  const [isBudgetModalVisible, setIsBudgetModalVisible] = useState(false);
  const [selectedBudgetCategoryForAdjust, setSelectedBudgetCategoryForAdjust] = useState<string | null>(null);
  const [isBudgetAdjustModalVisible, setIsBudgetAdjustModalVisible] = useState(false);
  const [colorCategory, setColorCategory] = useState<string>(FALLBACK_CATEGORY);
  const [isCategoryColorTableVisible, setIsCategoryColorTableVisible] = useState(false);
  const [selectedExpenseAccountId, setSelectedExpenseAccountId] = useState<number | null>(null);
  const [isNewAccountModalVisible, setIsNewAccountModalVisible] = useState(false);
  const [isNewAccountColorTableVisible, setIsNewAccountColorTableVisible] = useState(false);
  const [selectedAccountForAction, setSelectedAccountForAction] = useState<Account | null>(null);
  const [accountActionType, setAccountActionType] = useState<'add' | 'subtract' | null>(null);
  const [accountActionAmount, setAccountActionAmount] = useState('');
  const [isAccountActionModalVisible, setIsAccountActionModalVisible] = useState(false);
  const [isAccountEditColorTableVisible, setIsAccountEditColorTableVisible] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([]);
  const [products, setProducts] = useState<StoredProduct[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsCursor, setTransactionsCursor] = useState<TransactionCursor | null>(null);
  const [transactionsHasMore, setTransactionsHasMore] = useState(false);
  const [isTransactionsLoadingMore, setIsTransactionsLoadingMore] = useState(false);
  const [monthlyFinancialSummary, setMonthlyFinancialSummary] = useState<MonthlyFinancialSummary>({
    income: 0,
    expense: 0,
    balance: 0,
  });
  const [annualFinancialSummary, setAnnualFinancialSummary] = useState<MonthlyFinancialSummary>({
    income: 0,
    expense: 0,
    balance: 0,
  });
  const [annualMonthlySummary, setAnnualMonthlySummary] = useState<AnnualMonthlySummary[]>([]);
  const [annualCategoryTotals, setAnnualCategoryTotals] = useState<Array<{ category: string; total: number }>>([]);
  const [topMovementAccountThisMonth, setTopMovementAccountThisMonth] = useState<{
    accountName: string;
    amount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const [receiptImageUri, setReceiptImageUri] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [receiptAnalysis, setReceiptAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [receiptTotalInput, setReceiptTotalInput] = useState('');
  const [receiptPipelineStage, setReceiptPipelineStage] = useState<ReceiptPipelineStage>('idle');
  const [receiptPipelineDetail, setReceiptPipelineDetail] = useState('');
  const [isAnalyzingReceipt, setIsAnalyzingReceipt] = useState(false);
  const [isPickingInvoiceImage, setIsPickingInvoiceImage] = useState(false);
  const [receiptCategory, setReceiptCategory] = useState<string | null>(null);
  const [selectedReceiptAccountId, setSelectedReceiptAccountId] = useState<number | null>(null);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [transferImageUri, setTransferImageUri] = useState<string | null>(null);
  const [transferOcrText, setTransferOcrText] = useState('');
  const [transferTotalAmount, setTransferTotalAmount] = useState(0);
  const [transferTotalInput, setTransferTotalInput] = useState('');
  const [isPickingTransferImage, setIsPickingTransferImage] = useState(false);
  const [selectedTransferAccountId, setSelectedTransferAccountId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<AppSection>('inicio');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState(false);
  const [highlightedQuickOption, setHighlightedQuickOption] = useState<QuickRadialOption>(null);
  const [quickActionMode, setQuickActionMode] = useState<QuickActionMode>(null);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [isNumberFormatDropdownOpen, setIsNumberFormatDropdownOpen] = useState(false);
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [isNewAccountCurrencyDropdownOpen, setIsNewAccountCurrencyDropdownOpen] = useState(false);
  const [isAccountActionCurrencyDropdownOpen, setIsAccountActionCurrencyDropdownOpen] = useState(false);
  const [quickExpenseAccountId, setQuickExpenseAccountId] = useState<number | null>(null);
  const [quickExpenseCategory, setQuickExpenseCategory] = useState<string | null>(null);
  const [quickExpenseAmount, setQuickExpenseAmount] = useState('');
  const [quickExpenseNote, setQuickExpenseNote] = useState('');
  const [quickExpenseDate, setQuickExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quickIncomeAccountId, setQuickIncomeAccountId] = useState<number | null>(null);
  const [quickIncomeCategory, setQuickIncomeCategory] = useState<string | null>(null);
  const [quickIncomeAmount, setQuickIncomeAmount] = useState('');
  const [quickDateFilter, setQuickDateFilter] = useState<QuickDateFilter>('all');
  const [transactionSortField, setTransactionSortField] = useState<TransactionSortField>('date');
  const [transactionSortDirection, setTransactionSortDirection] = useState<SortDirection>('desc');
  const [internalTransferFromId, setInternalTransferFromId] = useState<number | null>(null);
  const [internalTransferToId, setInternalTransferToId] = useState<number | null>(null);
  const [internalTransferAmount, setInternalTransferAmount] = useState('');
  const [isInternalTransferModalVisible, setIsInternalTransferModalVisible] = useState(false);
  const [isPayableModalVisible, setIsPayableModalVisible] = useState(false);
  const [payableName, setPayableName] = useState('');
  const [payableAmountInput, setPayableAmountInput] = useState('');
  const [payableCategory, setPayableCategory] = useState<string>(FALLBACK_CATEGORY);
  const [payableDueDayInput, setPayableDueDayInput] = useState('1');
  const [selectedPayableForPayment, setSelectedPayableForPayment] = useState<Payable | null>(null);
  const [payablePaymentAccountId, setPayablePaymentAccountId] = useState<number | null>(null);
  const [isRestoreBackupModalVisible, setIsRestoreBackupModalVisible] = useState(false);
  const [backupJsonInput, setBackupJsonInput] = useState('');
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [csvExportProgressLabel, setCsvExportProgressLabel] = useState('');
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [backupExportProgressLabel, setBackupExportProgressLabel] = useState('');
  const themeOpacity = useRef(new Animated.Value(1)).current;
  const contentLoadOpacity = useRef(new Animated.Value(0)).current;
  const drawerTranslateX = useRef(new Animated.Value(-280)).current;
  const drawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const quickPressProgress = useRef(new Animated.Value(0)).current;
  const quickMenuProgress = useRef(new Animated.Value(0)).current;
  const selectedQuickOptionRef = useRef<QuickRadialOption>(null);
  const budgetWarningTrackerRef = useRef<Set<string>>(new Set());
  const csvExportCancelRef = useRef(false);
  const backupExportCancelRef = useRef(false);

  const theme = useMemo(() => {
    if (themeMode === 'light') {
      return LIGHT_THEME;
    }
    if (themeMode === 'original') {
      return ORIGINAL_THEME;
    }
    return DARK_THEME;
  }, [themeMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const t = TEXTS[language];
  const dateLocale =
    language === 'es'
      ? 'es-CR'
      : language === 'it'
        ? 'it-IT'
        : language === 'ja'
          ? 'ja-JP'
          : 'en-US';
  const confirmGenericNames = useCallback(
    (count: number): Promise<boolean> =>
      new Promise((resolve) => {
        Alert.alert(
          localizeLegacy(language, 'Confirmar nombres genericos', 'Confirm generic names'),
          translate(
            language,
            `Se detectaron ${count} producto(s) con nombre generico. ¿Deseas guardarlos de todos modos?`,
            `${count} product(s) have generic names. Do you want to save them anyway?`,
            `Sono stati rilevati ${count} prodotti con un nome generico. Vuoi salvarli comunque?`,
            `${count}\u4ef6\u306e\u5546\u54c1\u306b\u4e00\u822c\u7684\u306a\u540d\u79f0\u304c\u4ed8\u3044\u3066\u3044\u307e\u3059\u3002\u305d\u306e\u307e\u307e\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f`
          ),
          [
            {
              text: localizeLegacy(language, 'Cancelar', 'Cancel'),
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: localizeLegacy(language, 'Guardar', 'Save'),
              onPress: () => resolve(true),
            },
          ]
        );
      }),
    [language]
  );
  const displayCurrency = useCallback(
    (value: number, currencyCode: string = defaultCurrencyCode) =>
      hideAmounts ? '••••••' : formatCurrency(value, language, numberFormat, currencyCode),
    [defaultCurrencyCode, hideAmounts, language, numberFormat]
  );
  const formatEditableAmount = useCallback(
    (value: string, currencyCode: string = defaultCurrencyCode) =>
      formatAmountInput(value, numberFormat, getCurrencyOption(currencyCode).decimals),
    [defaultCurrencyCode, numberFormat]
  );
  const accountTotalsByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const account of accounts) {
      const code = account.currencyCode || DEFAULT_CURRENCY_CODE;
      totals.set(code, Number(((totals.get(code) ?? 0) + account.balance).toFixed(2)));
    }
    return Array.from(totals.entries());
  }, [accounts]);
  const totalAccountsDisplay = useMemo(() => {
    if (accountTotalsByCurrency.length === 0) {
      return displayCurrency(0, defaultCurrencyCode);
    }
    return accountTotalsByCurrency
      .map(([currencyCode, value]) => displayCurrency(value, currencyCode))
      .join(' · ');
  }, [accountTotalsByCurrency, defaultCurrencyCode, displayCurrency]);
  const receiptPipelineMessage = useMemo(() => {
    if (receiptPipelineDetail.trim().length > 0) {
      return receiptPipelineDetail;
    }
    if (receiptPipelineStage === 'processing_image') {
      return localizeLegacy(language, 'Procesando imagen...', 'Processing image...');
    }
    if (receiptPipelineStage === 'analyzing_text') {
      return localizeLegacy(language, 'Analizando texto...', 'Analyzing text...');
    }
    if (receiptPipelineStage === 'total_detected') {
      return localizeLegacy(language, 'Total detectado.', 'Total detected.');
    }
    if (receiptPipelineStage === 'total_not_detected') {
      return localizeLegacy(language, 'No pude detectar el total con seguridad. Revísalo manualmente.', 'Could not detect total with confidence. Please review manually.');
    }
    if (receiptPipelineStage === 'error') {
      return localizeLegacy(language, 'Ocurrió un error en OCR.', 'OCR pipeline error.');
    }
    return '';
  }, [language, receiptPipelineDetail, receiptPipelineStage]);

  const total = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses]);
  const totalIncomeAdded = useMemo(
    () => Number(incomeEntries.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    [incomeEntries]
  );
  const totalAccountsBalance = useMemo(
    () => Number(accounts.reduce((sum, account) => sum + account.balance, 0).toFixed(2)),
    [accounts]
  );
  const hasExistingUserData = useMemo(
    () =>
      accounts.length > 0 ||
      expenses.length > 0 ||
      incomeEntries.length > 0 ||
      products.length > 0 ||
      transactions.length > 0 ||
      budgets.length > 0,
    [accounts.length, budgets.length, expenses.length, incomeEntries.length, products.length, transactions.length]
  );
  const shouldShowOnboarding = !loading && !hasCompletedOnboarding && !hasExistingUserData;
  const now = useMemo(() => new Date(), []);
  const currentMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale, {
        month: 'long',
        year: 'numeric',
      }).format(now),
    [dateLocale, now]
  );
  const annualMonthSeries = useMemo(() => {
    const monthlyByNumber = new Map(annualMonthlySummary.map((summary) => [summary.month, summary]));

    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const summary = monthlyByNumber.get(month);
      return {
        month,
        income: summary?.income ?? 0,
        expense: summary?.expense ?? 0,
        label: new Intl.DateTimeFormat(dateLocale, { month: 'short' })
          .format(new Date(now.getFullYear(), index, 1))
          .replace('.', '')
          .slice(0, 3),
      };
    });
  }, [annualMonthlySummary, dateLocale, now]);
  const annualTopCategory = annualCategoryTotals[0] ?? null;

  const currentMonthProducts = useMemo(() => {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    return products.filter((product) => {
      const date = new Date(product.createdAt);
      return (
        date.getFullYear() === currentYear &&
        date.getMonth() === currentMonth &&
        (product.currencyCode || DEFAULT_CURRENCY_CODE) === defaultCurrencyCode
      );
    });
  }, [defaultCurrencyCode, now, products]);

  const currentMonthTotal = useMemo(
    () => Number(currentMonthProducts.reduce((sum, product) => sum + product.lineTotal, 0).toFixed(2)),
    [currentMonthProducts]
  );

  const topVariosProduct = useMemo<TopVariosProduct | null>(() => {
    const variosProducts = currentMonthProducts.filter((product) => product.category === 'varios');
    if (variosProducts.length === 0) {
      return null;
    }

    const aggregated = new Map<string, TopVariosProduct>();

    for (const product of variosProducts) {
      const existing = aggregated.get(product.name);
      if (existing) {
        existing.totalUnits += product.quantity;
        existing.totalAmount = Number((existing.totalAmount + product.lineTotal).toFixed(2));
        continue;
      }

      aggregated.set(product.name, {
        name: product.name,
        totalUnits: product.quantity,
        totalAmount: Number(product.lineTotal.toFixed(2)),
      });
    }

    return Array.from(aggregated.values()).sort((a, b) => {
      if (b.totalUnits !== a.totalUnits) {
        return b.totalUnits - a.totalUnits;
      }

      return b.totalAmount - a.totalAmount;
    })[0];
  }, [currentMonthProducts]);

  const currentMonthTransportTotal = useMemo(
    () =>
      Number(
        currentMonthProducts
          .filter((product) => product.category === 'transporte')
          .reduce((sum, product) => sum + product.lineTotal, 0)
          .toFixed(2)
      ),
    [currentMonthProducts]
  );

  const previousMonthTotal = useMemo(() => {
    const nowDate = new Date();
    const previousMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1);
    return Number(
      products
        .filter((product) => {
          const date = new Date(product.createdAt);
          return (
            date.getFullYear() === previousMonthDate.getFullYear() &&
            date.getMonth() === previousMonthDate.getMonth() &&
            (product.currencyCode || DEFAULT_CURRENCY_CODE) === defaultCurrencyCode
          );
        })
        .reduce((sum, product) => sum + product.lineTotal, 0)
        .toFixed(2)
    );
  }, [defaultCurrencyCode, products]);

  const topCategoryThisMonth = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of currentMonthProducts) {
      const prev = totals.get(item.category) ?? 0;
      totals.set(item.category, Number((prev + item.lineTotal).toFixed(2)));
    }
    const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      return null;
    }
    return { category: sorted[0][0], total: sorted[0][1] };
  }, [currentMonthProducts]);

  const currentMonthIncomeTotal = monthlyFinancialSummary.income;
  const currentMonthExpenseTotal = monthlyFinancialSummary.expense;
  const currentMonthBalance = monthlyFinancialSummary.balance;
  const hasCurrentMonthMovements = currentMonthIncomeTotal > 0 || currentMonthExpenseTotal > 0;

  const topProductThisMonth = useMemo<TopVariosProduct | null>(() => {
    if (currentMonthProducts.length === 0) {
      return null;
    }

    const aggregated = new Map<string, TopVariosProduct>();
    for (const product of currentMonthProducts) {
      const existing = aggregated.get(product.name);
      if (existing) {
        existing.totalUnits += product.quantity;
        existing.totalAmount = Number((existing.totalAmount + product.lineTotal).toFixed(2));
        continue;
      }
      aggregated.set(product.name, {
        name: product.name,
        totalUnits: product.quantity,
        totalAmount: Number(product.lineTotal.toFixed(2)),
      });
    }

    return Array.from(aggregated.values()).sort((a, b) => {
      if (b.totalUnits !== a.totalUnits) {
        return b.totalUnits - a.totalUnits;
      }
      return b.totalAmount - a.totalAmount;
    })[0];
  }, [currentMonthProducts]);

  const availableCategories = useMemo(() => {
    const fromProducts = currentMonthProducts.map((product) => product.category);
    return Array.from(new Set([...DEFAULT_PRODUCT_CATEGORIES, ...categories, ...fromProducts]));
  }, [categories, currentMonthProducts]);

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = { ...DEFAULT_CATEGORY_COLORS };
    for (const item of categoryColors) {
      map[item.category] = item.color;
    }
    return map;
  }, [categoryColors]);

  const currentMonthSpentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of currentMonthProducts) {
      const prev = map.get(product.category) ?? 0;
      map.set(product.category, Number((prev + product.lineTotal).toFixed(2)));
    }
    return map;
  }, [currentMonthProducts]);

  const usedBudgetCategorySet = useMemo(() => {
    return new Set(budgets.map((item) => item.category));
  }, [budgets]);

  const availableBudgetCategories = useMemo(() => {
    return categories.filter((category) => !usedBudgetCategorySet.has(category));
  }, [categories, usedBudgetCategorySet]);

  const monthlyCategorySlices = useMemo<CategorySlice[]>(() => {
    if (currentMonthTotal <= 0) {
      return [];
    }

    return availableCategories.map((category) => {
      const totalByCategory = currentMonthProducts
        .filter((product) => product.category === category)
        .reduce((sum, product) => sum + product.lineTotal, 0);

      return {
        category,
        total: Number(totalByCategory.toFixed(2)),
        percentage: Number(((totalByCategory / currentMonthTotal) * 100).toFixed(1)),
      };
    }).filter((slice) => slice.total > 0);
  }, [availableCategories, currentMonthProducts, currentMonthTotal]);

  const buildTransactionDateRange = useCallback((): { fromDate?: string; toDate?: string } => {
    const nowDate = new Date();
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    if (quickDateFilter === 'today') {
      return { fromDate: startOfToday.toISOString() };
    }

    if (quickDateFilter === '7d') {
      const sevenDaysAgo = new Date(startOfToday);
      sevenDaysAgo.setDate(startOfToday.getDate() - 6);
      return { fromDate: sevenDaysAgo.toISOString() };
    }

    if (quickDateFilter === 'month') {
      const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
      return { fromDate: startOfMonth.toISOString() };
    }

    return {};
  }, [quickDateFilter]);

  const buildTransactionQuery = useCallback((): TransactionQueryFilters => {
    const dateRange = buildTransactionDateRange();
    return {
      ...dateRange,
      sortField: transactionSortField as RepoTransactionSortField,
      sortDirection: transactionSortDirection as RepoSortDirection,
      limit: 60,
    };
  }, [buildTransactionDateRange, transactionSortDirection, transactionSortField]);

  const loadMonthlyTransactionAggregates = useCallback(async () => {
    const [summary, movementByAccount] = await Promise.all([
      getMonthlyFinancialSummary(undefined, defaultCurrencyCode),
      listMonthlyAccountMovementTotals(undefined, defaultCurrencyCode),
    ]);
    setMonthlyFinancialSummary(summary);
    setTopMovementAccountThisMonth(
      movementByAccount.length > 0
        ? {
            accountName: movementByAccount[0].accountName,
            amount: movementByAccount[0].totalMovement,
          }
        : null
    );
  }, [defaultCurrencyCode]);

  const loadAnnualTransactionAggregates = useCallback(async () => {
    const [summary, months, categories] = await Promise.all([
      getAnnualFinancialSummary(undefined, defaultCurrencyCode),
      listAnnualMonthlySummary(undefined, defaultCurrencyCode),
      listAnnualCategoryTotals(undefined, defaultCurrencyCode),
    ]);
    setAnnualFinancialSummary(summary);
    setAnnualMonthlySummary(months);
    setAnnualCategoryTotals(categories);
  }, [defaultCurrencyCode]);

  const loadTransactions = useCallback(async () => {
    const query = buildTransactionQuery();
    const startTime = DEV_PERF_LOG ? Date.now() : 0;
    const [page] = await Promise.all([
      listTransactionsPage(query, null),
      loadMonthlyTransactionAggregates(),
      loadAnnualTransactionAggregates(),
    ]);
    setTransactions(page.items);
    setTransactionsCursor(page.nextCursor);
    setTransactionsHasMore(page.hasMore);
    if (DEV_PERF_LOG) {
      console.info(
        '[perf][transactions:first-page]',
        JSON.stringify({
          count: page.items.length,
          hasMore: page.hasMore,
          ms: Date.now() - startTime,
        })
      );
    }
  }, [buildTransactionQuery, loadAnnualTransactionAggregates, loadMonthlyTransactionAggregates]);

  const loadMoreTransactions = useCallback(async () => {
    if (!transactionsHasMore || !transactionsCursor || isTransactionsLoadingMore) {
      return;
    }

    setIsTransactionsLoadingMore(true);
    try {
      const query = buildTransactionQuery();
      const startTime = DEV_PERF_LOG ? Date.now() : 0;
      const page = await listTransactionsPage(query, transactionsCursor);
      setTransactions((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        for (const item of page.items) {
          if (!seen.has(item.id)) {
            merged.push(item);
          }
        }
        return merged;
      });
      setTransactionsCursor(page.nextCursor);
      setTransactionsHasMore(page.hasMore);
      if (DEV_PERF_LOG) {
        console.info(
          '[perf][transactions:next-page]',
          JSON.stringify({
            count: page.items.length,
            hasMore: page.hasMore,
            ms: Date.now() - startTime,
          })
        );
      }
    } finally {
      setIsTransactionsLoadingMore(false);
    }
  }, [buildTransactionQuery, isTransactionsLoadingMore, transactionsCursor, transactionsHasMore]);

  const loadExpenses = useCallback(async () => {
    const data = await listExpenses();
    setExpenses(data);
  }, []);

  const loadIncomeEntries = useCallback(async () => {
    const data = await listIncomeEntries();
    setIncomeEntries(data);
  }, []);

  const loadProducts = useCallback(async () => {
    const data = await listProducts();
    setProducts(data);
  }, []);

  const loadCategories = useCallback(async () => {
    const data = await listCategories();
    setCategories(data);
  }, []);

  const loadLanguage = useCallback(async () => {
    const saved = await getSavedLanguage();
    setLanguage(saved);
  }, []);

  const loadThemeMode = useCallback(async () => {
    const saved = await getSavedThemeMode();
    setThemeMode(saved);
  }, []);

  const loadNumberFormat = useCallback(async () => {
    const saved = await getSavedNumberFormat();
    setNumberFormat(saved);
  }, []);

  const loadChartType = useCallback(async () => {
    const saved = await getSavedChartType();
    setChartType(saved);
  }, []);

  const loadDefaultCurrency = useCallback(async () => {
    const saved = await getDefaultCurrencyCode();
    setDefaultCurrencyCode(saved);
    setSelectedAccountCurrencyCode(saved);
  }, []);

  const loadPrivacySettings = useCallback(async () => {
    const [hide, lockEnabled, savedPin] = await Promise.all([
      getHideAmounts(),
      getAppLockEnabled(),
      getSavedAppPin(),
    ]);
    setHideAmounts(hide);
    setAppLockEnabled(lockEnabled);
    setAppPin(savedPin);
    setIsUnlocked(!(lockEnabled && savedPin.length >= 4));
  }, []);

  const loadOnboardingState = useCallback(async () => {
    const saved = await getOnboardingCompleted();
    setHasCompletedOnboarding(saved);
  }, []);

  const loadAccounts = useCallback(async () => {
    const data = await listAccounts();
    setAccounts(data);
  }, []);

  const loadBudgets = useCallback(async () => {
    const data = await listBudgets(defaultCurrencyCode);
    setBudgets(data);
  }, [defaultCurrencyCode]);

  const loadPayables = useCallback(async () => {
    const data = await listPayables();
    setPayables(data);
  }, []);

  const loadCategoryColors = useCallback(async () => {
    const data = await listCategoryColors();
    setCategoryColors(data);
  }, []);

  const reloadAllData = useCallback(async () => {
    await Promise.all([
      loadExpenses(),
      loadIncomeEntries(),
      loadProducts(),
      loadTransactions(),
      loadCategories(),
      loadAccounts(),
      loadBudgets(),
      loadPayables(),
      loadCategoryColors(),
    ]);
  }, [loadAccounts, loadBudgets, loadCategories, loadCategoryColors, loadExpenses, loadIncomeEntries, loadPayables, loadProducts, loadTransactions]);

  useEffect(() => {
    (async () => {
      try {
        await initDb();
        await Promise.all([
          reloadAllData(),
          loadLanguage(),
          loadThemeMode(),
          loadNumberFormat(),
          loadChartType(),
          loadDefaultCurrency(),
          loadPrivacySettings(),
          loadOnboardingState(),
        ]);
      } catch (error) {
        Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo iniciar la app', 'Could not start the app'));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadChartType, loadDefaultCurrency, loadLanguage, loadNumberFormat, loadOnboardingState, loadPrivacySettings, loadThemeMode, reloadAllData]);

  useEffect(() => {
    if (loading) {
      contentLoadOpacity.setValue(0.35);
      return;
    }

    void SplashScreen.hideAsync().catch(() => {
      // The splash may already be hidden when running inside Expo Go.
    });

    Animated.timing(contentLoadOpacity, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [contentLoadOpacity, loading]);

  useEffect(() => {
    if (!loading) {
      void Promise.all([loadBudgets(), loadTransactions()]);
    }
  }, [defaultCurrencyCode, loadBudgets, loadTransactions, loading]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && appLockEnabled) {
        setIsUnlocked(false);
        setPinInput('');
      }
    });

    return () => subscription.remove();
  }, [appLockEnabled]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(manualCategory)) {
      setManualCategory(categories[0]);
    }
    if (categories.length > 0 && !categories.includes(payableCategory)) {
      setPayableCategory(categories[0]);
    }
  }, [categories, manualCategory, payableCategory]);

  useEffect(() => {
    if (loading) {
      return;
    }
    void loadTransactions();
  }, [loading, quickDateFilter, transactionSortDirection, transactionSortField, loadTransactions]);

  useEffect(() => {
    if (loading || hasCompletedOnboarding || !hasExistingUserData) {
      return;
    }

    setHasCompletedOnboarding(true);
    void saveOnboardingCompleted(true);
  }, [hasCompletedOnboarding, hasExistingUserData, loading]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(budgetCategory)) {
      setBudgetCategory(FALLBACK_CATEGORY);
    }
    if (categories.length > 0 && !categories.includes(colorCategory)) {
      setColorCategory(FALLBACK_CATEGORY);
    }
  }, [budgetCategory, categories, colorCategory]);

  useEffect(() => {
    if (availableBudgetCategories.length === 0) {
      return;
    }

    if (!availableBudgetCategories.includes(budgetCategory)) {
      setBudgetCategory(availableBudgetCategories[0]);
    }
  }, [availableBudgetCategories, budgetCategory]);

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedExpenseAccountId(null);
      setSelectedReceiptAccountId(null);
      setSelectedTransferAccountId(null);
      setInternalTransferFromId(null);
      setInternalTransferToId(null);
      setQuickExpenseAccountId(null);
      setQuickIncomeAccountId(null);
      setPayablePaymentAccountId(null);
      return;
    }

    if (selectedExpenseAccountId !== null && !accounts.some((account) => account.id === selectedExpenseAccountId)) {
      setSelectedExpenseAccountId(null);
    }
  }, [
    accounts,
    selectedExpenseAccountId,
  ]);

  useEffect(() => {
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const budget of budgets) {
      const spent = currentMonthSpentByCategory.get(budget.category) ?? 0;
      const warningLevel = getBudgetWarningLevel(budget.amount, spent);
      if (!warningLevel) {
        continue;
      }

      const warningKey = `${monthKey}:${budget.category}:${warningLevel}`;
      if (budgetWarningTrackerRef.current.has(warningKey)) {
        continue;
      }

      budgetWarningTrackerRef.current.add(warningKey);
      const categoryLabel = getCategoryLabel(budget.category, language);
      const remaining = Number((budget.amount - spent).toFixed(2));

      if (warningLevel === 'over') {
        Alert.alert(
          localizeLegacy(language, 'Presupuesto excedido', 'Budget exceeded'),
          translate(
            language,
            `La categoria "${categoryLabel}" supero el presupuesto.\nRestante: ${formatCurrency(remaining, language, numberFormat, defaultCurrencyCode)}`,
            `Category "${categoryLabel}" exceeded the budget.\nRemaining: ${formatCurrency(remaining, language, numberFormat, defaultCurrencyCode)}`,
            `La categoria "${categoryLabel}" ha superato il budget.\nRimanente: ${formatCurrency(remaining, language, numberFormat, defaultCurrencyCode)}`,
            `\u30ab\u30c6\u30b4\u30ea\u300c${categoryLabel}\u300d\u304c\u4e88\u7b97\u3092\u8d85\u3048\u307e\u3057\u305f\u3002\n\u6b8b\u308a: ${formatCurrency(remaining, language, numberFormat, defaultCurrencyCode)}`
          )
        );
        continue;
      }

      Alert.alert(
        localizeLegacy(language, 'Alerta de presupuesto', 'Budget alert'),
        translate(
          language,
          `La categoria "${categoryLabel}" llego al ${warningLevel}% restante.`,
          `Category "${categoryLabel}" reached ${warningLevel}% remaining.`,
          `La categoria "${categoryLabel}" ha raggiunto il ${warningLevel}% rimanente.`,
          `\u30ab\u30c6\u30b4\u30ea\u300c${categoryLabel}\u300d\u306e\u4e88\u7b97\u6b8b\u9ad8\u304c${warningLevel}%\u306b\u306a\u308a\u307e\u3057\u305f\u3002`
        )
      );
    }
  }, [budgets, currentMonthSpentByCategory, defaultCurrencyCode, language, now]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    drawerTranslateX.setValue(-280);
    drawerBackdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(drawerTranslateX, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(drawerBackdropOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [drawerBackdropOpacity, drawerTranslateX]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(drawerTranslateX, {
        toValue: -280,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(drawerBackdropOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsDrawerOpen(false);
    });
  }, [drawerBackdropOpacity, drawerTranslateX]);

  const onChangeSection = useCallback(
    (nextSection: AppSection) => {
      setActiveSection(nextSection);
      closeDrawer();
    },
    [closeDrawer]
  );

  const onSaveExpense = async () => {
    const normalizedDescription = description.trim();
    const parsedQuantity = Number(quantity);
    const parsedAmount = parseAmountInput(amount);

    if (!normalizedDescription) {
      Alert.alert(localizeLegacy(language, 'Campo requerido', 'Required field'), localizeLegacy(language, 'Ingresa una descripcion.', 'Enter a description.'));
      return;
    }

    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      Alert.alert(localizeLegacy(language, 'Cantidad inválida', 'Invalid quantity'), localizeLegacy(language, 'Ingresa una cantidad entera mayor que 0.', 'Enter an integer quantity greater than 0.'));
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(localizeLegacy(language, 'Monto invalido', 'Invalid amount'), localizeLegacy(language, 'Ingresa un monto numerico mayor que 0.', 'Enter a numeric amount greater than 0.'));
      return;
    }

    if (isGenericProductName(normalizedDescription)) {
      const confirmed = await confirmGenericNames(1);
      if (!confirmed) {
        return;
      }
    }

    if (!hasValidCategory(manualCategory, categories)) {
      Alert.alert(
        localizeLegacy(language, 'Categoría requerida', 'Category required'),
        localizeLegacy(language, 'Selecciona una categoria valida para guardar el gasto.', 'Select a valid category to save the expense.')
      );
      return;
    }

    if (selectedExpenseAccountId == null) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta requerida', 'Account required'),
        localizeLegacy(language, 'Selecciona la cuenta desde la que se pagaron los productos.', 'Select the account used to pay these products.')
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedExpenseAccountId);
    if (!selectedAccount) {
      Alert.alert(localizeLegacy(language, 'Cuenta inválida', 'Invalid account'), localizeLegacy(language, 'La cuenta seleccionada no existe.', 'Selected account does not exist.'));
      return;
    }

    const manualLineTotal = Number((parsedQuantity * parsedAmount).toFixed(2));
    if (selectedAccount.balance < manualLineTotal) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getInsufficientFundsMessage(
          language,
          selectedAccount.name,
          formatCurrency(selectedAccount.balance, language, numberFormat, selectedAccount.currencyCode),
          formatCurrency(manualLineTotal, language, numberFormat, selectedAccount.currencyCode),
          'charge'
        )
      );
      return;
    }

    try {
      await createExpense(normalizedDescription, parsedQuantity, parsedAmount, selectedAccount.name, undefined, selectedAccount.currencyCode);
      await createProduct(
        normalizedDescription,
        parsedQuantity,
        parsedAmount,
        manualLineTotal,
        undefined,
        manualCategory,
        selectedAccount.name,
        selectedAccount.currencyCode
      );
      await updateAccountBalance(selectedAccount.id, roundCurrencyAmount(selectedAccount.balance - manualLineTotal, selectedAccount.currencyCode));
      await createAccountMovement({
        type: 'expense_manual',
        amount: -manualLineTotal,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
        note: normalizedDescription,
      });
      await createTransaction({
        type: 'expense',
        source: 'manual_expense',
        amount: manualLineTotal,
        currencyCode: selectedAccount.currencyCode,
        quantity: parsedQuantity,
        category: manualCategory,
        accountName: selectedAccount.name,
        note: normalizedDescription,
      });
      setDescription('');
      setQuantity('1');
      setAmount('');
      setManualCategory(FALLBACK_CATEGORY);
      await Promise.all([loadExpenses(), loadProducts(), loadAccounts(), loadTransactions()]);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo guardar el gasto', 'Could not save expense'));
    }
  };

  const onPickInvoiceScreenshot = async () => {
    if (isPickingInvoiceImage) {
      return;
    }

    setIsPickingInvoiceImage(true);
    setSelectedReceiptAccountId(null);
    setReceiptCategory(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          localizeLegacy(language, 'Permiso requerido', 'Permission required'),
          permission.canAskAgain
            ? translate(
                language,
                'Activa permisos de galeria para cargar la captura.',
                'Enable gallery permissions to load the screenshot.',
                'Abilita i permessi della galleria per caricare la schermata.',
                '\u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8\u3092\u8aad\u307f\u8fbc\u3080\u306b\u306f\u3001\u30ae\u30e3\u30e9\u30ea\u30fc\u3078\u306e\u30a2\u30af\u30bb\u30b9\u3092\u8a31\u53ef\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
              )
            : translate(
                language,
                'Debes habilitar el permiso de galeria desde Ajustes del telefono.',
                'You must enable gallery permission from your phone settings.',
                'Devi abilitare il permesso della galleria dalle impostazioni del telefono.',
                '\u7aef\u672b\u306e\u8a2d\u5b9a\u304b\u3089\u30ae\u30e3\u30e9\u30ea\u30fc\u306e\u6a29\u9650\u3092\u6709\u52b9\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
              )
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const selectedAsset = result.assets[0];
      const imageUri = selectedAsset.uri;
      const ocrMeta: OcrImageMeta = {
        width: selectedAsset.width,
        height: selectedAsset.height,
        fileSize: selectedAsset.fileSize,
        fileName: selectedAsset.fileName ?? undefined,
        assetId: selectedAsset.assetId ?? undefined,
      };
      setReceiptImageUri(imageUri);
      setOcrText('');
      setReceiptAnalysis(null);
      setReceiptTotalInput('');
      setReceiptPipelineStage('processing_image');
      setReceiptPipelineDetail(localizeLegacy(language, 'Procesando imagen...', 'Processing image...'));

      try {
        const ocrResult = await readTextFromImageLocalCached({ imageUri, meta: ocrMeta });
        setOcrText(ocrResult.text);
        setReceiptPipelineStage('analyzing_text');
        setReceiptPipelineDetail(
          ocrResult.warnings[0]
            ? translate(
                language,
                ocrResult.warnings[0],
                'The image resolution is low. Use a sharp capture where the receipt fills most of the image.',
                'La risoluzione dell’immagine è bassa. Usa una cattura nitida in cui la ricevuta occupi gran parte dell’immagine.',
                '画像の解像度が低いです。レシートが画像の大部分を占める鮮明な画像を使用してください。'
              )
            : ocrResult.fromCache
              ? translate(language, 'Texto recuperado de caché.', 'Text loaded from cache.', 'Testo caricato dalla cache.', 'OCRテキストをキャッシュから読み込みました。')
              : translate(language, 'Texto OCR detectado. Revisa y analiza.', 'OCR text detected. Review and analyze.', 'Testo OCR rilevato. Controlla e analizza.', 'OCRテキストを検出しました。確認して分析してください。')
        );
      } catch (error) {
        setReceiptPipelineStage('error');
        setReceiptPipelineDetail(
          localizeLegacy(language, 'Error en OCR. Puedes pegar texto manualmente.', 'OCR error. You can paste text manually.')
        );
        Alert.alert(
          localizeLegacy(language, 'Lectura de factura', 'Receipt reading'),
          error instanceof Error
            ? getOcrContinuationMessage(language, error.message, t.analyzeReceipt, 'receipt')
            : localizeLegacy(language, 'No se pudo leer la factura', 'Could not read the receipt')
        );
      }
    } finally {
      setIsPickingInvoiceImage(false);
    }
  };

  const onAnalyzeReceipt = async () => {
    if (isAnalyzingReceipt) {
      return;
    }
    setIsAnalyzingReceipt(true);
    setReceiptPipelineStage('analyzing_text');
    setReceiptPipelineDetail(localizeLegacy(language, 'Analizando texto...', 'Analyzing text...'));
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });

    let analysis: ReceiptAnalysis;
    try {
      analysis = analyzeReceiptText(ocrText);
    } catch (error) {
      setReceiptPipelineStage('error');
      setReceiptPipelineDetail(localizeLegacy(language, 'Error analizando texto OCR.', 'Error analyzing OCR text.'));
      Alert.alert(
        localizeLegacy(language, 'Error de análisis', 'Analysis error'),
        error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo analizar el texto OCR.', 'Could not analyze OCR text.')
      );
      setIsAnalyzingReceipt(false);
      return;
    }
    const fallbackTotal =
      analysis.detectedTotal?.amount ??
      (analysis.totalAmount > 0 ? Number(analysis.totalAmount.toFixed(2)) : 0);
    const useUnnamedFallback =
      fallbackTotal > 0 && shouldUseUnnamedReceiptFallback(ocrText, analysis);
    const noTotalMessage =
      localizeLegacy(language, 'No pude detectar el total del recibo. Revisa el texto o ingrésalo manualmente.', 'I could not detect the receipt total. Review the text or enter it manually.');
    const noProductsMessage =
      localizeLegacy(language, 'No pude detectar productos claros. Puedes editar el texto escaneado o registrar el gasto manualmente.', 'I could not detect clear products. You can edit scanned text or register the expense manually.');

    if (analysis.items.length > 0 && !useUnnamedFallback) {
      setReceiptAnalysis(analysis);
      const suggestedTotal =
        analysis.detectedTotal && analysis.detectedTotal.confidence >= 0.75
          ? analysis.detectedTotal.amount
          : analysis.totalAmount;
      setReceiptTotalInput(suggestedTotal > 0 ? formatAmountValueForInput(suggestedTotal, numberFormat) : '');
      setReceiptPipelineStage(analysis.detectedTotal?.confidence && analysis.detectedTotal.confidence >= 0.75 ? 'total_detected' : 'total_not_detected');
      setReceiptPipelineDetail(
        analysis.detectedTotal?.confidence && analysis.detectedTotal.confidence >= 0.75
          ? translate(
              language,
              `Total detectado: ${displayCurrency(analysis.detectedTotal.amount)}`,
              `Detected total: ${displayCurrency(analysis.detectedTotal.amount)}`,
              `Totale rilevato: ${displayCurrency(analysis.detectedTotal.amount)}`,
              `\u691c\u51fa\u3055\u308c\u305f\u5408\u8a08: ${displayCurrency(analysis.detectedTotal.amount)}`
            )
          : ''
      );
      if (analysis.warnings.length > 0) {
        Alert.alert(
          localizeLegacy(language, 'Revision recomendada', 'Review recommended'),
          analysis.warnings.join('\n')
        );
      }
      setIsAnalyzingReceipt(false);
      return;
    }

    if (fallbackTotal > 0) {
      const fallbackItem: ReceiptItem = {
        name: 'Recibo sin nombre',
        quantity: 1,
        unitPrice: fallbackTotal,
        lineTotal: fallbackTotal,
      };

      setReceiptAnalysis({
        items: [fallbackItem],
        totalAmount: fallbackTotal,
        totalUnits: 1,
        detectedTotal: analysis.detectedTotal,
        warnings: analysis.warnings,
        rawLines: analysis.rawLines,
      });
    setReceiptTotalInput(formatAmountValueForInput(fallbackTotal, numberFormat));
      setReceiptPipelineStage('total_detected');
      setReceiptPipelineDetail(
      translate(
        language,
        `Total detectado: ${displayCurrency(fallbackTotal)}`,
        `Detected total: ${displayCurrency(fallbackTotal)}`,
        `Totale rilevato: ${displayCurrency(fallbackTotal)}`,
        `\u691c\u51fa\u3055\u308c\u305f\u5408\u8a08: ${displayCurrency(fallbackTotal)}`
      )
      );

      Alert.alert(
        localizeLegacy(language, 'Solo total detectado', 'Only total detected'),
        noProductsMessage
      );
      setIsAnalyzingReceipt(false);
      return;
    }

    setReceiptAnalysis({
      items: [],
      totalAmount: 0,
      totalUnits: 0,
      detectedTotal: analysis.detectedTotal,
      warnings: [
        noTotalMessage,
        noProductsMessage,
      ],
      rawLines: analysis.rawLines,
      debug: analysis.debug,
    });
    setReceiptPipelineStage('total_not_detected');
    setReceiptPipelineDetail(
      localizeLegacy(language, 'No pude detectar el total con seguridad. Revísalo manualmente.', 'Could not detect total with confidence. Please review manually.')
    );
    Alert.alert(
      localizeLegacy(language, 'Revisión manual recomendada', 'Manual review recommended'),
      `${noTotalMessage}\n\n${noProductsMessage}`
    );
    setIsAnalyzingReceipt(false);
  };

  const onSaveDetectedProducts = async () => {
    if (!receiptAnalysis) {
      Alert.alert(
        localizeLegacy(language, 'Sin datos', 'No data'),
        localizeLegacy(language, 'Primero analiza la factura para obtener productos.', 'Analyze the receipt first to get products.')
      );
      return;
    }

    const parsedReceiptTotalInput = parseAmountInput(receiptTotalInput);
    const detectedTotalCandidate =
      receiptAnalysis.detectedTotal && receiptAnalysis.detectedTotal.confidence >= 0.75
        ? receiptAnalysis.detectedTotal.amount
        : 0;
    const manualOrDetectedTotal = Number(
      (
        Number.isFinite(parsedReceiptTotalInput) && parsedReceiptTotalInput > 0
          ? parsedReceiptTotalInput
          : detectedTotalCandidate > 0
            ? detectedTotalCandidate
            : receiptAnalysis.totalAmount
      ).toFixed(2)
    );

    const normalizedItemsSource =
      receiptAnalysis.items.length > 0
        ? receiptAnalysis.items
        : [
            {
              name: 'Recibo sin nombre',
              quantity: 1,
              unitPrice: manualOrDetectedTotal,
              lineTotal: manualOrDetectedTotal,
            } satisfies ReceiptItem,
          ];

    const normalizedItems = normalizedItemsSource.map((item) => ({
      ...item,
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    }));

    const emptyNameFound = normalizedItems.some((item) => item.name.length === 0);
    if (emptyNameFound) {
      Alert.alert(
        localizeLegacy(language, 'Producto inválido', 'Invalid product'),
        localizeLegacy(language, 'Hay productos sin nombre. Corrige los nombres antes de guardar.', 'Some products have empty names. Fix names before saving.')
      );
      return;
    }

    const invalidNumbersFound = normalizedItems.some(
      (item) =>
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice <= 0 ||
        !Number.isFinite(item.lineTotal) ||
        item.lineTotal <= 0
    );
    if (invalidNumbersFound) {
      Alert.alert(
        localizeLegacy(language, 'Datos inválidos', 'Invalid data'),
        localizeLegacy(language, 'Cada producto debe tener cantidad, precio unitario y total por línea mayores que 0.', 'Each product must have quantity, unit price and line total greater than 0.')
      );
      return;
    }

    const genericCount = normalizedItems.filter((item) => isGenericProductName(item.name)).length;
    if (genericCount > 0) {
      const confirmed = await confirmGenericNames(genericCount);
      if (!confirmed) {
        return;
      }
    }

    if (!hasValidCategory(receiptCategory, categories)) {
      Alert.alert(
        localizeLegacy(language, 'Categoría requerida', 'Category required'),
        localizeLegacy(language, 'Selecciona una categoría válida antes de guardar los productos detectados.', 'Select a valid category before saving detected products.')
      );
      return;
    }

    if (selectedReceiptAccountId == null) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta requerida', 'Account required'),
        localizeLegacy(language, 'Selecciona la cuenta desde la que se pagó esta factura.', 'Select the account used to pay this receipt.')
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedReceiptAccountId);
    if (!selectedAccount) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta inválida', 'Invalid account'),
        localizeLegacy(language, 'La cuenta seleccionada no existe.', 'Selected account does not exist.')
      );
      return;
    }
    const itemsComputedTotal = Number(
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)
    );
    const receiptTotal = Number(
      (Number.isFinite(parsedReceiptTotalInput) && parsedReceiptTotalInput > 0
        ? parsedReceiptTotalInput
        : detectedTotalCandidate > 0
          ? detectedTotalCandidate
          : itemsComputedTotal > 0
            ? itemsComputedTotal
            : receiptAnalysis.totalAmount
      ).toFixed(2)
    );
    if (receiptTotal <= 0) {
      Alert.alert(
        localizeLegacy(language, 'Sin datos', 'No data'),
        localizeLegacy(language, 'No se detectó un total válido en la captura. Corrige el texto OCR y vuelve a analizar.', 'No valid total amount was detected in the capture. Fix OCR text and analyze again.')
      );
      return;
    }

    const hasLowConfidenceTotal =
      !receiptAnalysis.detectedTotal || receiptAnalysis.detectedTotal.confidence < 0.75;
    const hasInconsistentTotal = Math.abs(receiptTotal - itemsComputedTotal) > 1;
    if (hasLowConfidenceTotal || hasInconsistentTotal) {
      const proceed = await confirmProceedLowConfidence({
        language,
        messageEs:
          hasLowConfidenceTotal && hasInconsistentTotal
            ? 'El OCR tiene baja confianza y el total no coincide con la suma de productos. Revisa antes de guardar.'
            : hasLowConfidenceTotal
              ? 'El OCR no detectó el total con suficiente confianza. Revisa antes de guardar.'
              : 'El total editado no coincide con la suma de productos. Revisa antes de guardar.',
        messageEn:
          hasLowConfidenceTotal && hasInconsistentTotal
            ? 'OCR confidence is low and total does not match item sum. Review before saving.'
            : hasLowConfidenceTotal
              ? 'OCR did not detect total with enough confidence. Review before saving.'
              : 'Edited total does not match items sum. Review before saving.',
      });
      if (!proceed) {
        return;
      }
    }

    if (Math.abs(receiptTotal - receiptAnalysis.totalAmount) > 0.01) {
      Alert.alert(
        localizeLegacy(language, 'Total ajustado', 'Adjusted total'),
        translate(
          language,
          `Se guardará el total editado (${displayCurrency(receiptTotal)}) en lugar del total detectado (${displayCurrency(receiptAnalysis.totalAmount)}).`,
          `Edited total (${displayCurrency(receiptTotal)}) will be used instead of detected total (${displayCurrency(receiptAnalysis.totalAmount)}).`,
          `Verrà usato il totale modificato (${displayCurrency(receiptTotal)}) al posto di quello rilevato (${displayCurrency(receiptAnalysis.totalAmount)}).`,
          `\u691c\u51fa\u3055\u308c\u305f\u5408\u8a08 (${displayCurrency(receiptAnalysis.totalAmount)}) \u306e\u4ee3\u308f\u308a\u306b\u3001\u7de8\u96c6\u3057\u305f\u5408\u8a08 (${displayCurrency(receiptTotal)}) \u3092\u4f7f\u7528\u3057\u307e\u3059\u3002`
        )
      );
    }

    if (isSuspiciousDetectedAmount(receiptTotal)) {
      Alert.alert(
        localizeLegacy(language, 'Revisión recomendada', 'Review recommended'),
        localizeLegacy(language, 'El monto detectado parece inusual. Revisa la captura o corrige el total antes de guardar.', 'Detected amount looks unusual. Review the image or edit total before saving.')
      );
    }

    if (selectedAccount.balance < receiptTotal) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getInsufficientFundsMessage(
          language,
          selectedAccount.name,
          formatCurrency(selectedAccount.balance, language, numberFormat, selectedAccount.currencyCode),
          formatCurrency(receiptTotal, language, numberFormat, selectedAccount.currencyCode),
          'charge'
        )
      );
      return;
    }

    try {
      const itemsToSave =
        normalizedItems.length === 1
          ? normalizedItems.map((item) => ({
              ...item,
              unitPrice: receiptTotal,
              lineTotal: receiptTotal,
            }))
          : normalizedItems;

      await createProducts(itemsToSave, {
        categoryOverride: receiptCategory,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
      });
      await updateAccountBalance(
        selectedAccount.id,
        roundCurrencyAmount(selectedAccount.balance - receiptTotal, selectedAccount.currencyCode)
      );
      await createAccountMovement({
        type: 'expense_receipt',
        amount: -receiptTotal,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
        note: `Receipt items: ${normalizedItems.length}`,
      });
      await createTransaction({
        type: 'expense',
        source: 'receipt_capture',
        amount: receiptTotal,
        currencyCode: selectedAccount.currencyCode,
        quantity: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        category: receiptCategory,
        accountName: selectedAccount.name,
        note: `Receipt items: ${normalizedItems.length}`,
      });
      await Promise.all([loadProducts(), loadAccounts(), loadTransactions()]);
      Alert.alert(
        localizeLegacy(language, 'Guardado', 'Saved'),
        translate(
          language,
          `${normalizedItems.length} productos agregados.`,
          `${normalizedItems.length} products added.`,
          `${normalizedItems.length} prodotti aggiunti.`,
          `${normalizedItems.length}\u4ef6\u306e\u5546\u54c1\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f\u3002`
        )
      );
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudieron guardar los productos', 'Could not save products'));
    }
  };

  const onClearReceipt = () => {
    setReceiptImageUri(null);
    setOcrText('');
    setReceiptAnalysis(null);
    setReceiptTotalInput('');
    setReceiptPipelineStage('idle');
    setReceiptPipelineDetail('');
    setSelectedReceiptAccountId(null);
    setReceiptCategory(null);
  };

  const onClearTransferCapture = () => {
    setTransferImageUri(null);
    setTransferOcrText('');
    setTransferTotalAmount(0);
    setTransferTotalInput('');
  };

  const onPickTransferScreenshot = async () => {
    if (isPickingTransferImage) {
      return;
    }

    setIsPickingTransferImage(true);
    setSelectedTransferAccountId(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          localizeLegacy(language, 'Permiso requerido', 'Permission required'),
          getGalleryPermissionMessage(language, permission.canAskAgain)
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const selectedAsset = result.assets[0];
      const imageUri = selectedAsset.uri;
      const ocrMeta: OcrImageMeta = {
        width: selectedAsset.width,
        height: selectedAsset.height,
        fileSize: selectedAsset.fileSize,
        fileName: selectedAsset.fileName ?? undefined,
        assetId: selectedAsset.assetId ?? undefined,
      };
      setTransferImageUri(imageUri);
      setTransferOcrText('');
      setTransferTotalAmount(0);
      setTransferTotalInput('');

      try {
        const ocrResult = await readTextFromImageLocalCached({ imageUri, meta: ocrMeta });
        setTransferOcrText(ocrResult.text);
        const transferDetected = detectReceiptTotalWithOptions(ocrResult.text, { preferredType: 'transfer' });
        const autoDetectedTotal = transferDetected?.amount ?? 0;
        setTransferTotalAmount(autoDetectedTotal);
        setTransferTotalInput(autoDetectedTotal > 0 ? formatAmountValueForInput(autoDetectedTotal, numberFormat) : '');
      } catch (error) {
        Alert.alert(
          localizeLegacy(language, 'Lectura de transferencia', 'Transfer reading'),
          error instanceof Error
            ? getOcrContinuationMessage(language, error.message, '', 'transfer')
            : localizeLegacy(language, 'No se pudo leer la transferencia', 'Could not read the transfer')
        );
      }
    } finally {
      setIsPickingTransferImage(false);
    }
  };

  const onAnalyzeTransferTotal = () => {
    const detected = detectReceiptTotalWithOptions(transferOcrText, { preferredType: 'transfer' });
    const detectedTotal = detected?.amount ?? 0;
    setTransferTotalAmount(detectedTotal);
    setTransferTotalInput(detectedTotal > 0 ? formatAmountValueForInput(detectedTotal, numberFormat) : '');

    if (detectedTotal > 0) {
      return;
    }

    Alert.alert(
      localizeLegacy(language, 'Sin monto total detectado', 'No total amount detected'),
      localizeLegacy(language, 'No se detectó "Monto total" con símbolo de colones (¢/CRC). Corrige el texto OCR y reintenta.', 'Could not detect "Total amount" with CRC symbol (¢/CRC). Fix OCR text and retry.')
    );
  };

  const onApplyTransferFromCapture = async () => {
    if (!transferMode) {
      Alert.alert(
        localizeLegacy(language, 'Tipo de transferencia', 'Transfer type'),
        localizeLegacy(language, 'Selecciona si recibiste o hiciste una transferencia.', 'Select whether you received or made a transfer.')
      );
      return;
    }

    if (selectedTransferAccountId == null) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta requerida', 'Account required'),
        localizeLegacy(language, 'Selecciona la cuenta para aplicar la transferencia.', 'Select the account to apply this transfer.')
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedTransferAccountId);
    if (!selectedAccount) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta inválida', 'Invalid account'),
        localizeLegacy(language, 'La cuenta seleccionada no existe.', 'Selected account does not exist.')
      );
      return;
    }

    const parsedTransferInput = parseAmountInput(transferTotalInput);
    const totalToApply = Number(
      (Number.isFinite(parsedTransferInput) && parsedTransferInput > 0
        ? parsedTransferInput
        : transferTotalAmount
      ).toFixed(2)
    );
    if (!Number.isFinite(totalToApply) || totalToApply <= 0) {
      Alert.alert(
        localizeLegacy(language, 'Monto invalido', 'Invalid amount'),
        localizeLegacy(language, 'No se detectó un "Monto total" válido. Usa "Detectar monto total" y valida el texto OCR.', 'No valid "Total amount" was detected. Use "Detect total amount" and verify OCR text.')
      );
      return;
    }

    if (isSuspiciousDetectedAmount(totalToApply)) {
      Alert.alert(
        localizeLegacy(language, 'Revision recomendada', 'Review recommended'),
        localizeLegacy(language, 'El monto detectado parece inusual. Verifica el valor antes de aplicarlo.', 'Detected amount looks unusual. Verify it before applying.')
      );
    }

    if (transferMode === 'sent' && selectedAccount.balance < totalToApply) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getInsufficientFundsMessage(
          language,
          selectedAccount.name,
          formatCurrency(selectedAccount.balance, language, numberFormat, selectedAccount.currencyCode),
          formatCurrency(totalToApply, language, numberFormat, selectedAccount.currencyCode),
          'deduction'
        )
      );
      return;
    }

    const nextBalance =
      transferMode === 'received'
        ? roundCurrencyAmount(selectedAccount.balance + totalToApply, selectedAccount.currencyCode)
        : roundCurrencyAmount(selectedAccount.balance - totalToApply, selectedAccount.currencyCode);

    try {
      await updateAccountBalance(selectedAccount.id, nextBalance);
      if (transferMode === 'received') {
        await createIncomeEntry('transfer_received', totalToApply, selectedAccount.name, undefined, selectedAccount.currencyCode);
        await createAccountMovement({
          type: 'transfer_in',
          amount: totalToApply,
          accountName: selectedAccount.name,
          currencyCode: selectedAccount.currencyCode,
          note: 'Transfer received',
        });
        await createTransaction({
          type: 'transfer_in',
          source: 'transfer_capture',
          amount: totalToApply,
          currencyCode: selectedAccount.currencyCode,
          category: FALLBACK_CATEGORY,
          accountName: selectedAccount.name,
          note: 'Transfer received',
        });
        await Promise.all([loadAccounts(), loadIncomeEntries(), loadTransactions()]);
      } else {
        await createAccountMovement({
          type: 'transfer_out',
          amount: -totalToApply,
          accountName: selectedAccount.name,
          currencyCode: selectedAccount.currencyCode,
          note: 'Transfer sent',
        });
        await createTransaction({
          type: 'transfer_out',
          source: 'transfer_capture',
          amount: totalToApply,
          currencyCode: selectedAccount.currencyCode,
          category: FALLBACK_CATEGORY,
          accountName: selectedAccount.name,
          note: 'Transfer sent',
        });
        await Promise.all([loadAccounts(), loadTransactions()]);
      }
      Alert.alert(
        localizeLegacy(language, 'Transferencia aplicada', 'Transfer applied'),
        translate(
          language,
          `Se ${transferMode === 'received' ? 'sumo' : 'resto'} ${formatCurrency(totalToApply, language, numberFormat, selectedAccount.currencyCode)} en "${selectedAccount.name}".`,
          `${formatCurrency(totalToApply, language, numberFormat, selectedAccount.currencyCode)} was ${transferMode === 'received' ? 'added to' : 'subtracted from'} "${selectedAccount.name}".`,
          `${formatCurrency(totalToApply, language, numberFormat, selectedAccount.currencyCode)} ${transferMode === 'received' ? '\u00e8 stato aggiunto a' : '\u00e8 stato sottratto da'} "${selectedAccount.name}".`,
          `${formatCurrency(totalToApply, language, numberFormat, selectedAccount.currencyCode)}\u3092\u53e3\u5ea7\u300c${selectedAccount.name}\u300d\u306b${transferMode === 'received' ? '\u8ffd\u52a0\u3057\u307e\u3057\u305f' : '\u304b\u3089\u5dee\u3057\u5f15\u304d\u307e\u3057\u305f'}\u3002`
        )
      );
      onClearTransferCapture();
    } catch (error) {
      Alert.alert(
        localizeLegacy(language, 'Error', 'Error'),
        error instanceof Error
          ? error.message
          : localizeLegacy(language, 'No se pudo aplicar la transferencia', 'Could not apply transfer')
      );
    }
  };

  const onClearFilters = () => {
    setQuickDateFilter('all');
    setTransactionSortField('date');
    setTransactionSortDirection('desc');
  };

  const onExportTransactionsCsv = async () => {
    if (isExportingCsv) {
      csvExportCancelRef.current = true;
      return;
    }

    setIsExportingCsv(true);
    csvExportCancelRef.current = false;
    setCsvExportProgressLabel(localizeLegacy(language, 'Preparando exportación...', 'Preparing export...'));
    const query = buildTransactionQuery();
    const exportItems: Transaction[] = [];
    let cursor: TransactionCursor | null = null;
    let hasMore = true;
    let safety = 0;

    while (hasMore && safety < 200 && !csvExportCancelRef.current) {
      const page = await listTransactionsPage({ ...query, limit: 500 }, cursor);
      exportItems.push(...page.items);
      cursor = page.nextCursor;
      hasMore = page.hasMore && cursor != null;
      safety += 1;
      setCsvExportProgressLabel(
        translate(
          language,
          `Procesando... ${exportItems.length} registros`,
          `Processing... ${exportItems.length} records`,
          `Elaborazione... ${exportItems.length} record`,
          `\u51e6\u7406\u4e2d... ${exportItems.length}\u4ef6`
        )
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    if (csvExportCancelRef.current) {
      setIsExportingCsv(false);
      setCsvExportProgressLabel('');
      csvExportCancelRef.current = false;
      Alert.alert(
        localizeLegacy(language, 'Exportación cancelada', 'Export canceled'),
        localizeLegacy(language, 'Se canceló la exportación CSV.', 'CSV export was canceled.')
      );
      return;
    }

    if (exportItems.length === 0) {
      setIsExportingCsv(false);
      setCsvExportProgressLabel('');
      Alert.alert(
        localizeLegacy(language, 'Sin datos', 'No data'),
        localizeLegacy(language, 'No hay transacciones para exportar con los filtros actuales.', 'There are no transactions to export with current filters.')
      );
      return;
    }

    const header = ['date', 'type', 'source', 'category', 'account', 'quantity', 'amount', 'note'];
    const rows = exportItems.map((item) => [
      item.createdAt,
      item.type,
      item.source,
      item.category,
      item.accountName || '',
      String(item.quantity ?? 1),
      item.amount.toFixed(2),
      item.note || '',
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const safe = `${cell}`.replace(/"/g, '""');
            return `"${safe}"`;
          })
          .join(',')
      )
      .join('\n');

    try {
      await Share.share({
        title: 'MyFinance CSV',
        message: csv,
      });
    } finally {
      setIsExportingCsv(false);
      setCsvExportProgressLabel('');
    }
  };

  const onDeleteProduct = (productId: number) => {
    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar producto', 'Delete product'),
      message:
        localizeLegacy(language, 'Este producto se ocultara del historial visible. ¿Deseas continuar?', 'This product will be removed from visible history. Continue?'),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deleteProductById(productId);
          await loadProducts();
        } catch (error) {
          Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo eliminar el producto', 'Could not delete product'));
        }
      },
    });
  };

  const onAddCategory = async () => {
    const normalizedName = newCategoryName.trim().toLowerCase();
    if (!normalizedName) {
      Alert.alert(localizeLegacy(language, 'Categoría inválida', 'Invalid category'), localizeLegacy(language, 'Ingresa un nombre de categoría.', 'Enter a category name.'));
      return;
    }

    try {
      await addCategory(normalizedName);
      await loadCategories();
      setManualCategory(normalizedName);
      setNewCategoryName('');
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo crear la categoria', 'Could not create category'));
    }
  };

  const onDeleteSelectedCategory = () => {
    if (manualCategory === FALLBACK_CATEGORY) {
      Alert.alert(
        localizeLegacy(language, 'Categoría protegida', 'Protected category'),
        localizeLegacy(language, 'No se puede eliminar la categoria "varios".', 'You cannot delete the "varios" category.')
      );
      return;
    }

    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar categoria', 'Delete category'),
      message: translate(
        language,
        `Se eliminara "${manualCategory}" y sus productos pasaran a "varios".`,
        `"${manualCategory}" will be deleted and its products moved to "varios".`,
        `"${manualCategory}" verr\u00e0 eliminata e i suoi prodotti saranno spostati in "varios".`,
        `\u300c${manualCategory}\u300d\u3092\u524a\u9664\u3057\u3001\u305d\u306e\u5546\u54c1\u3092\u300cvarios\u300d\u306b\u79fb\u52d5\u3057\u307e\u3059\u3002`
      ),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deleteCategory(manualCategory);
          await Promise.all([loadCategories(), loadProducts()]);
          setManualCategory(FALLBACK_CATEGORY);
        } catch (error) {
          Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo eliminar la categoria', 'Could not delete category'));
        }
      },
    });
  };

  const onDeleteCategoryFromSettings = (category: string) => {
    if (category === FALLBACK_CATEGORY) {
      Alert.alert(
        localizeLegacy(language, 'Categoría protegida', 'Protected category'),
        localizeLegacy(language, 'No se puede eliminar la categoria "varios".', 'You cannot delete the "varios" category.')
      );
      return;
    }

    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar categoria', 'Delete category'),
      message: translate(
        language,
        `Se eliminara "${category}" y sus productos pasaran a "varios".`,
        `"${category}" will be deleted and its products moved to "varios".`,
        `"${category}" verr\u00e0 eliminata e i suoi prodotti saranno spostati in "varios".`,
        `\u300c${category}\u300d\u3092\u524a\u9664\u3057\u3001\u305d\u306e\u5546\u54c1\u3092\u300cvarios\u300d\u306b\u79fb\u52d5\u3057\u307e\u3059\u3002`
      ),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deleteCategory(category);
          await Promise.all([loadCategories(), loadProducts(), loadTransactions()]);
        } catch (error) {
          Alert.alert(
            localizeLegacy(language, 'Error', 'Error'),
            error instanceof Error
              ? error.message
              : localizeLegacy(language, 'No se pudo eliminar la categoria', 'Could not delete category')
          );
        }
      },
    });
  };

  const openQuickAction = useCallback((mode: QuickActionMode) => {
    if (mode === null) {
      return;
    }
    if (accounts.length === 0) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta requerida', 'Account required'),
        localizeLegacy(language, 'Primero crea una cuenta.', 'Create an account first.')
      );
      return;
    }
    if (categories.length === 0) {
      Alert.alert(
        localizeLegacy(language, 'Categoría requerida', 'Category required'),
        localizeLegacy(language, 'Primero crea una categoría desde Configuración.', 'Create a category from Settings first.')
      );
      return;
    }
    setIsQuickMenuOpen(false);
    setQuickExpenseAccountId(null);
    setQuickExpenseCategory(null);
    setQuickIncomeAccountId(null);
    setQuickIncomeCategory(null);
    setQuickActionMode(mode);
  }, [accounts.length, categories.length, language]);

  const closeQuickAction = () => {
    setQuickActionMode(null);
  };

  const closeAnyOpenMenu = useCallback(() => {
    setQuickActionMode(null);
    setIsAccountActionModalVisible(false);
    setSelectedAccountForAction(null);
    setAccountActionType(null);
    setIsBudgetAdjustModalVisible(false);
    setSelectedBudgetCategoryForAdjust(null);
    setIsBudgetModalVisible(false);
    setIsPayableModalVisible(false);
    setSelectedPayableForPayment(null);
    setIsNewAccountModalVisible(false);
    setIsNewAccountColorTableVisible(false);
    setIsNewAccountCurrencyDropdownOpen(false);
    setIsAccountActionCurrencyDropdownOpen(false);
    setIsAccountEditColorTableVisible(false);
    setIsLanguageDropdownOpen(false);
    setIsNumberFormatDropdownOpen(false);
    setIsCurrencyDropdownOpen(false);
    setIsInternalTransferModalVisible(false);
    setIsRestoreBackupModalVisible(false);
  }, []);

  const hasUnsavedModalText = useCallback((): boolean => {
    if (quickActionMode === 'expense') return Boolean(quickExpenseAmount.trim() || quickExpenseNote.trim());
    if (quickActionMode === 'income') return Boolean(quickIncomeAmount.trim());
    if (isAccountActionModalVisible) return Boolean(accountActionAmount.trim());
    if (isBudgetAdjustModalVisible) return Boolean(budgetDeltaInput.trim());
    if (isBudgetModalVisible) return Boolean(budgetAmountInput.trim());
    if (isPayableModalVisible) return Boolean(payableName.trim() || payableAmountInput.trim() || payableDueDayInput !== '1');
    if (isNewAccountModalVisible) return Boolean(accountName.trim() || accountBalanceInput.trim());
    if (isInternalTransferModalVisible) return Boolean(internalTransferAmount.trim());
    if (isRestoreBackupModalVisible) return Boolean(backupJsonInput.trim());
    return false;
  }, [
    accountActionAmount,
    accountBalanceInput,
    accountName,
    backupJsonInput,
    budgetAmountInput,
    budgetDeltaInput,
    internalTransferAmount,
    isAccountActionModalVisible,
    isBudgetAdjustModalVisible,
    isBudgetModalVisible,
    isInternalTransferModalVisible,
    isNewAccountModalVisible,
    isPayableModalVisible,
    isRestoreBackupModalVisible,
    payableAmountInput,
    payableDueDayInput,
    payableName,
    quickActionMode,
    quickExpenseAmount,
    quickExpenseNote,
    quickIncomeAmount,
  ]);

  const discardOpenModalText = useCallback(() => {
    if (quickActionMode === 'expense') {
      setQuickExpenseAmount('');
      setQuickExpenseNote('');
    }
    if (quickActionMode === 'income') setQuickIncomeAmount('');
    if (isAccountActionModalVisible) setAccountActionAmount('');
    if (isBudgetAdjustModalVisible) setBudgetDeltaInput('');
    if (isBudgetModalVisible) setBudgetAmountInput('');
    if (isPayableModalVisible) {
      setPayableName('');
      setPayableAmountInput('');
      setPayableDueDayInput('1');
    }
    if (isNewAccountModalVisible) {
      setAccountName('');
      setAccountBalanceInput('');
    }
    if (isInternalTransferModalVisible) setInternalTransferAmount('');
    if (isRestoreBackupModalVisible) setBackupJsonInput('');
    closeAnyOpenMenu();
  }, [
    closeAnyOpenMenu,
    isAccountActionModalVisible,
    isBudgetAdjustModalVisible,
    isBudgetModalVisible,
    isInternalTransferModalVisible,
    isNewAccountModalVisible,
    isPayableModalVisible,
    isRestoreBackupModalVisible,
    quickActionMode,
  ]);

  const requestCloseAnyOpenMenu = useCallback(() => {
    if (!hasUnsavedModalText()) {
      closeAnyOpenMenu();
      return;
    }
    Alert.alert(
      translate(language, 'Descartar cambios', 'Discard changes', 'Eliminare le modifiche', '変更を破棄'),
      translate(language, 'Hay información escrita que no se ha guardado. ¿Deseas descartarla?', 'There is unsaved information. Do you want to discard it?', 'Sono presenti informazioni non salvate. Vuoi eliminarle?', '未保存の入力があります。破棄しますか？'),
      [
        { text: translate(language, 'Seguir editando', 'Keep editing', 'Continua a modificare', '編集を続ける'), style: 'cancel' },
        { text: translate(language, 'Descartar', 'Discard', 'Elimina', '破棄'), style: 'destructive', onPress: discardOpenModalText },
      ]
    );
  }, [closeAnyOpenMenu, discardOpenModalText, hasUnsavedModalText, language]);

  const getQuickOptionFromGesture = useCallback((dx: number, dy: number): QuickRadialOption => {
    if (dy > -22) {
      return null;
    }
    if (dx < -34) {
      return 'expense';
    }
    if (dx > 34) {
      return 'transfer';
    }
    if (dy < -34) {
      return 'income';
    }
    return null;
  }, []);

  const runQuickRadialSelection = useCallback(
    (option: QuickRadialOption) => {
      if (option === 'income') {
        openQuickAction('income');
        return;
      }
      if (option === 'expense') {
        openQuickAction('expense');
        return;
      }
      if (option === 'transfer') {
        setIsQuickMenuOpen(false);
        setHighlightedQuickOption(null);
        setInternalTransferFromId(null);
        setInternalTransferToId(null);
        setInternalTransferAmount('');
        setIsInternalTransferModalVisible(true);
      }
    },
    [openQuickAction]
  );

  const quickFabPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          selectedQuickOptionRef.current = null;
          setHighlightedQuickOption(null);
          setIsQuickMenuOpen(true);
          quickPressProgress.setValue(0);
          quickMenuProgress.setValue(0);
          Animated.timing(quickMenuProgress, {
            toValue: 1,
            duration: 240,
            useNativeDriver: true,
          }).start();
          Animated.timing(quickPressProgress, {
            toValue: 1,
            duration: 1150,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderMove: (_, gestureState) => {
          const option = getQuickOptionFromGesture(gestureState.dx, gestureState.dy);
          selectedQuickOptionRef.current = option;
          setHighlightedQuickOption(option);
        },
        onPanResponderRelease: (_, gestureState) => {
          const option = getQuickOptionFromGesture(gestureState.dx, gestureState.dy) ?? selectedQuickOptionRef.current;
          quickPressProgress.stopAnimation();
          quickMenuProgress.stopAnimation();
          quickPressProgress.setValue(0);
          quickMenuProgress.setValue(0);
          setIsQuickMenuOpen(false);
          setHighlightedQuickOption(null);
          selectedQuickOptionRef.current = null;
          runQuickRadialSelection(option);
        },
        onPanResponderTerminate: () => {
          quickPressProgress.stopAnimation();
          quickMenuProgress.stopAnimation();
          quickPressProgress.setValue(0);
          quickMenuProgress.setValue(0);
          setIsQuickMenuOpen(false);
          setHighlightedQuickOption(null);
          selectedQuickOptionRef.current = null;
        },
      }),
    [getQuickOptionFromGesture, quickMenuProgress, quickPressProgress, runQuickRadialSelection]
  );

  const onSaveQuickExpense = async () => {
    if (quickExpenseValidationMessage) {
      return;
    }
    const selectedAccount = accounts.find((account) => account.id === quickExpenseAccountId);
    const parsedAmount = parseAmountInput(quickExpenseAmount);
    const note = quickExpenseNote.trim() || (localizeLegacy(language, 'Gasto', 'Expense'));
    const createdAt = parseDateInputToIso(quickExpenseDate);

    if (!selectedAccount) {
      Alert.alert(localizeLegacy(language, 'Cuenta requerida', 'Account required'), localizeLegacy(language, 'Selecciona una cuenta.', 'Select an account.'));
      return;
    }
    if (!hasValidCategory(quickExpenseCategory, categories)) {
      Alert.alert(localizeLegacy(language, 'Categoría requerida', 'Category required'), localizeLegacy(language, 'Selecciona una categoría.', 'Select a category.'));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(localizeLegacy(language, 'Monto inválido', 'Invalid amount'), localizeLegacy(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.'));
      return;
    }
    if (!createdAt) {
      Alert.alert(localizeLegacy(language, 'Fecha inválida', 'Invalid date'), localizeLegacy(language, 'Usa el formato YYYY-MM-DD.', 'Use YYYY-MM-DD format.'));
      return;
    }
    if (selectedAccount.balance < parsedAmount) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getSimpleInsufficientFundsMessage(language, selectedAccount.name)
      );
      return;
    }

    try {
      await createExpense(note, 1, parsedAmount, selectedAccount.name, createdAt, selectedAccount.currencyCode);
      await createProduct(note, 1, parsedAmount, parsedAmount, createdAt, quickExpenseCategory, selectedAccount.name, selectedAccount.currencyCode);
      await updateAccountBalance(selectedAccount.id, roundCurrencyAmount(selectedAccount.balance - parsedAmount, selectedAccount.currencyCode));
      await createAccountMovement({
        type: 'expense_manual',
        amount: -parsedAmount,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
        note,
        createdAt,
      });
      await createTransaction({
        type: 'expense',
        source: 'quick_expense',
        amount: parsedAmount,
        currencyCode: selectedAccount.currencyCode,
        quantity: 1,
        category: quickExpenseCategory,
        accountName: selectedAccount.name,
        note,
        createdAt,
      });
      setQuickExpenseAmount('');
      setQuickExpenseNote('');
      setQuickExpenseDate(new Date().toISOString().slice(0, 10));
      closeQuickAction();
      await Promise.all([loadExpenses(), loadProducts(), loadAccounts(), loadTransactions()]);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo guardar el gasto.', 'Could not save expense.'));
    }
  };

  const onSaveQuickIncome = async () => {
    if (quickIncomeValidationMessage) {
      return;
    }
    const selectedAccount = accounts.find((account) => account.id === quickIncomeAccountId);
    const parsedAmount = parseAmountInput(quickIncomeAmount);

    if (!selectedAccount) {
      Alert.alert(localizeLegacy(language, 'Cuenta requerida', 'Account required'), localizeLegacy(language, 'Selecciona una cuenta.', 'Select an account.'));
      return;
    }
    if (!hasValidCategory(quickIncomeCategory, categories)) {
      Alert.alert(localizeLegacy(language, 'Categoría requerida', 'Category required'), localizeLegacy(language, 'Selecciona una categoría.', 'Select a category.'));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(localizeLegacy(language, 'Monto inválido', 'Invalid amount'), localizeLegacy(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.'));
      return;
    }

    try {
      const createdAt = new Date().toISOString();
      await createIncomeEntry('manual_add', parsedAmount, selectedAccount.name, createdAt, selectedAccount.currencyCode);
      await updateAccountBalance(selectedAccount.id, roundCurrencyAmount(selectedAccount.balance + parsedAmount, selectedAccount.currencyCode));
      await createAccountMovement({
        type: 'income_manual',
        amount: parsedAmount,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
        note: quickIncomeCategory,
        createdAt,
      });
      await createTransaction({
        type: 'income',
        source: 'quick_income',
        amount: parsedAmount,
        currencyCode: selectedAccount.currencyCode,
        quantity: 1,
        category: quickIncomeCategory,
        accountName: selectedAccount.name,
        note: quickIncomeCategory,
        createdAt,
      });
      setQuickIncomeAmount('');
      closeQuickAction();
      await Promise.all([loadAccounts(), loadIncomeEntries(), loadTransactions()]);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo guardar el ingreso.', 'Could not save income.'));
    }
  };

  const onChangeLanguage = async (nextLanguage: AppLanguage) => {
    try {
      setLanguage(nextLanguage);
      setIsLanguageDropdownOpen(false);
      await saveLanguage(nextLanguage);
    } catch (error) {
      Alert.alert(
        translate(nextLanguage, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
        translate(
          nextLanguage,
          'No se pudo guardar el idioma.',
          'Could not save language preference.',
          'Impossibile salvare la lingua.',
          '\u8a00\u8a9e\u8a2d\u5b9a\u3092\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002'
        )
      );
    }
  };

  const onChangeTheme = async (nextTheme: AppThemeMode) => {
    if (nextTheme === themeMode) {
      return;
    }

    try {
      themeOpacity.setValue(0.82);
      setThemeMode(nextTheme);
      Animated.timing(themeOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      await saveThemeMode(nextTheme);
    } catch (error) {
      Alert.alert(
        translate(language, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
        localizeLegacy(language, 'No se pudo guardar el tema.', 'Could not save theme preference.')
      );
    }
  };

  const onChangeNumberFormat = async (nextFormat: AppNumberFormat) => {
    if (nextFormat === numberFormat) {
      return;
    }

    try {
      setNumberFormat(nextFormat);
      setIsNumberFormatDropdownOpen(false);
      await saveNumberFormat(nextFormat);
    } catch (error) {
      Alert.alert(
        translate(language, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
        localizeLegacy(language, 'No se pudo guardar el formato numerico.', 'Could not save number format.')
      );
    }
  };

  const onChangeChartType = async (nextType: AppChartType) => {
    if (nextType === chartType) {
      return;
    }

    try {
      setChartType(nextType);
      await saveChartType(nextType);
    } catch {
      Alert.alert(
        translate(language, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
        translate(language, 'No se pudo guardar el tipo de gráfica.', 'Could not save chart type.', 'Non è stato possibile salvare il tipo di grafico.', '\u30b0\u30e9\u30d5\u306e\u7a2e\u985e\u3092\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002')
      );
    }
  };

  const onChangeDefaultCurrency = async (nextCurrency: AppCurrencyCode) => {
    if (nextCurrency === defaultCurrencyCode) {
      return;
    }

    try {
      setDefaultCurrencyCode(nextCurrency);
      setSelectedAccountCurrencyCode(nextCurrency);
      setIsCurrencyDropdownOpen(false);
      await saveDefaultCurrencyCode(nextCurrency);
    } catch (error) {
      Alert.alert(
        translate(language, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
        translate(language, 'No se pudo guardar la moneda.', 'Could not save currency.', 'Impossibile salvare la valuta.', '\u901a\u8ca8\u3092\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002')
      );
    }
  };

  const onCompleteOnboarding = async () => {
    try {
      setHasCompletedOnboarding(true);
      await saveOnboardingCompleted(true);
    } catch (error) {
      Alert.alert(
        localizeLegacy(language, 'Error', 'Error'),
        localizeLegacy(language, 'No se pudo guardar el estado inicial.', 'Could not save onboarding state.')
      );
    }
  };

  const onNextOnboardingStep = () => {
    if (onboardingStepIndex >= ONBOARDING_STEPS.length - 1) {
      void onCompleteOnboarding();
      return;
    }
    setOnboardingStepIndex((prev) => Math.min(prev + 1, ONBOARDING_STEPS.length - 1));
  };

  const onToggleHideAmounts = async () => {
    const next = !hideAmounts;
    setHideAmounts(next);
    try {
      await saveHideAmounts(next);
    } catch {
      // Best effort.
    }
  };

  const onSavePin = async () => {
    const normalized = pinInput.trim();
    if (!/^\d{4,8}$/.test(normalized)) {
      Alert.alert(
        localizeLegacy(language, 'PIN invalido', 'Invalid PIN'),
        localizeLegacy(language, 'Usa un PIN numerico de 4 a 8 digitos.', 'Use a numeric PIN with 4 to 8 digits.')
      );
      return;
    }

    setAppPin(normalized);
    setPinInput('');
    await saveAppPin(normalized);
    Alert.alert(localizeLegacy(language, 'Listo', 'Done'), localizeLegacy(language, 'PIN guardado.', 'PIN saved.'));
  };

  const onToggleAppLock = async () => {
    if (!appPin) {
      Alert.alert(
        localizeLegacy(language, 'PIN requerido', 'PIN required'),
        localizeLegacy(language, 'Primero define un PIN para habilitar el bloqueo.', 'Set a PIN first before enabling app lock.')
      );
      return;
    }

    const next = !appLockEnabled;
    setAppLockEnabled(next);
    await saveAppLockEnabled(next);
    if (next) {
      setIsUnlocked(false);
      setPinInput('');
    }
  };

  const onUnlockApp = async () => {
    if (!appLockEnabled) {
      setIsUnlocked(true);
      return;
    }

    const remainingLockoutMs = await getPinLockoutRemainingMs();
    if (remainingLockoutMs > 0) {
      const seconds = Math.max(1, Math.ceil(remainingLockoutMs / 1000));
      Alert.alert(
        translate(language, 'Espera para intentarlo de nuevo', 'Wait before trying again', 'Attendi prima di riprovare', '\u518d\u5ea6\u8a66\u3059\u524d\u306b\u5f85\u3063\u3066\u304f\u3060\u3055\u3044'),
        translate(language, `Por seguridad, espera ${seconds} segundos.`, `For security, wait ${seconds} seconds.`, `Per sicurezza, attendi ${seconds} secondi.`, `\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u306e\u305f\u3081\u3001${seconds}\u79d2\u5f85\u3063\u3066\u304f\u3060\u3055\u3044\u3002`)
      );
      return;
    }

    if (pinInput.trim() === appPin) {
      setIsUnlocked(true);
      setPinInput('');
      await clearPinFailedAttempts();
      return;
    }

    const lockoutMs = await registerFailedPinAttempt();
    if (lockoutMs > 0) {
      Alert.alert(
        translate(language, 'Demasiados intentos', 'Too many attempts', 'Troppi tentativi', '\u8a66\u884c\u56de\u6570\u304c\u591a\u3059\u304e\u307e\u3059'),
        translate(language, 'Por seguridad, espera 30 segundos antes de intentarlo de nuevo.', 'For security, wait 30 seconds before trying again.', 'Per sicurezza, attendi 30 secondi prima di riprovare.', '\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u306e\u305f\u3081\u300130\u79d2\u5f85\u3063\u3066\u304b\u3089\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
      );
      return;
    }
    Alert.alert(localizeLegacy(language, 'PIN incorrecto', 'Wrong PIN'));
  };

  const onContactPress = async () => {
    const subject = localizeLegacy(language, 'MyFinance - Reporte', 'MyFinance - Report');
    const body = translate(
      language,
      ['Describe aquí el error o sugerencia:', '', `Build: ${t.buildNumber}`, `Idioma: ${language}`, `Tema: ${themeMode}`, `Plataforma: ${Platform.OS}`].join('\n'),
      ['Describe your issue or suggestion:', '', `Build: ${t.buildNumber}`, `Language: ${language}`, `Theme: ${themeMode}`, `Platform: ${Platform.OS}`].join('\n'),
      ['Descrivi qui l\u2019errore o il suggerimento:', '', `Build: ${t.buildNumber}`, `Lingua: ${language}`, `Tema: ${themeMode}`, `Piattaforma: ${Platform.OS}`].join('\n'),
      ['\u30a8\u30e9\u30fc\u307e\u305f\u306f\u63d0\u6848\u3092\u3053\u3053\u306b\u8a18\u5165\u3057\u3066\u304f\u3060\u3055\u3044:', '', `Build: ${t.buildNumber}`, `\u8a00\u8a9e: ${language}`, `\u30c6\u30fc\u30de: ${themeMode}`, `\u30d7\u30e9\u30c3\u30c8\u30d5\u30a9\u30fc\u30e0: ${Platform.OS}`].join('\n')
    );
    const mailToUrl = buildMailtoUrl('sebasretana27@gmail.com', subject, body);
    const canOpen = await Linking.canOpenURL(mailToUrl);
    if (!canOpen) {
      Alert.alert(
        localizeLegacy(language, 'No disponible', 'Unavailable'),
        localizeLegacy(language, 'No se pudo abrir la app de correo en este dispositivo.', 'Could not open the email app on this device.')
      );
      return;
    }

    await Linking.openURL(mailToUrl);
  };

  const onOpenPrivacyPolicy = async () => {
    try {
      const canOpen = await Linking.canOpenURL(PRIVACY_POLICY_URL);
      if (!canOpen) {
        throw new Error('Privacy policy URL is unavailable.');
      }
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch {
      Alert.alert(
        translate(language, 'Política no disponible', 'Policy unavailable', 'Informativa non disponibile', 'ポリシーを開けません'),
        translate(
          language,
          'No se pudo abrir la política de privacidad. Verifica tu conexión e inténtalo de nuevo.',
          'The privacy policy could not be opened. Check your connection and try again.',
          'Non è stato possibile aprire l\'informativa sulla privacy. Controlla la connessione e riprova.',
          'プライバシーポリシーを開けませんでした。接続を確認してもう一度お試しください。'
        )
      );
    }
  };

  const onExportBackup = async () => {
    if (isExportingBackup) {
      backupExportCancelRef.current = true;
      return;
    }

    setIsExportingBackup(true);
    backupExportCancelRef.current = false;
    setBackupExportProgressLabel(localizeLegacy(language, 'Preparando backup...', 'Preparing backup...'));
    try {
      const payload = await createBackupPayload((progress) => {
        if (backupExportCancelRef.current) {
          return;
        }
        const label = translate(
          language,
          `Leyendo ${progress.tableLabel} (${progress.processed}/${progress.total})`,
          `Reading ${progress.tableLabel} (${progress.processed}/${progress.total})`,
          `Lettura ${progress.tableLabel} (${progress.processed}/${progress.total})`,
          `${progress.tableLabel}\u3092\u8aad\u307f\u8fbc\u307f\u4e2d (${progress.processed}/${progress.total})`
        );
        setBackupExportProgressLabel(label);
      });

      if (backupExportCancelRef.current) {
        setIsExportingBackup(false);
        setBackupExportProgressLabel('');
        backupExportCancelRef.current = false;
        Alert.alert(
          localizeLegacy(language, 'Backup cancelado', 'Backup canceled'),
          localizeLegacy(language, 'Se canceló la exportación del backup.', 'Backup export canceled.')
        );
        return;
      }

      await Share.share({
        title: 'MyFinance Backup',
        message: JSON.stringify(payload),
      });
    } catch (error) {
      Alert.alert(
        localizeLegacy(language, 'Error de backup', 'Backup error'),
        error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo exportar backup.', 'Could not export backup.')
      );
    } finally {
      setIsExportingBackup(false);
      setBackupExportProgressLabel('');
    }
  };

  const onRestoreBackup = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(backupJsonInput);
    } catch {
      Alert.alert(
        localizeLegacy(language, 'JSON invalido', 'Invalid JSON'),
        localizeLegacy(language, 'El contenido no es un JSON valido.', 'The content is not valid JSON.')
      );
      return;
    }

    if (!validateBackupPayload(parsed)) {
      Alert.alert(
        localizeLegacy(language, 'Backup invalido', 'Invalid backup'),
        localizeLegacy(language, 'El JSON no tiene el formato de respaldo esperado.', 'JSON does not match the expected backup format.')
      );
      return;
    }

    let integrity: { valid: boolean; reason?: string };
    try {
      integrity = await validateBackupIntegrity(parsed as BackupPayload);
    } catch {
      Alert.alert(
        localizeLegacy(language, 'Backup inválido', 'Invalid backup'),
        localizeLegacy(language, 'No se pudo verificar la integridad del backup.', 'The backup integrity could not be verified.')
      );
      return;
    }
    if (!integrity.valid) {
      Alert.alert(
        localizeLegacy(language, 'Backup inválido', 'Invalid backup'),
        integrity.reason ?? (localizeLegacy(language, 'No pasó la validación de integridad.', 'Backup integrity validation failed.'))
      );
      return;
    }

    Alert.alert(
      localizeLegacy(language, 'Restaurar backup', 'Restore backup'),
      localizeLegacy(language, 'Se intentara fusionar el respaldo con tus datos actuales. ¿Deseas continuar?', 'Backup will be merged with current local data. Continue?'),
      [
        { text: localizeLegacy(language, 'Cancelar', 'Cancel'), style: 'cancel' },
        {
          text: localizeLegacy(language, 'Restaurar', 'Restore'),
          onPress: async () => {
            try {
              await restoreBackupPayload(parsed as BackupPayload, 'merge');
              await reloadAllData();
              setIsRestoreBackupModalVisible(false);
              setBackupJsonInput('');
              Alert.alert(
                localizeLegacy(language, 'Listo', 'Done'),
                localizeLegacy(language, 'Backup restaurado correctamente.', 'Backup restored successfully.')
              );
            } catch (error) {
              Alert.alert(
                localizeLegacy(language, 'Error de restore', 'Restore error'),
                error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo restaurar backup.', 'Could not restore backup.')
              );
            }
          },
        },
      ]
    );
  };

  const onAddAccount = async () => {
    const normalizedName = accountName.trim();
    const parsedBalance = parseAmountInput(accountBalanceInput || '0');
    const normalizedColor = normalizeHexColor(selectedAccountColor);

    if (!normalizedName) {
      Alert.alert(localizeLegacy(language, 'Cuenta inválida', 'Invalid account'), localizeLegacy(language, 'Ingresa el nombre de la cuenta.', 'Enter account name.'));
      return;
    }

    if (!Number.isFinite(parsedBalance)) {
      Alert.alert(localizeLegacy(language, 'Saldo invalido', 'Invalid balance'), localizeLegacy(language, 'Ingresa un saldo inicial valido.', 'Enter a valid initial balance.'));
      return;
    }

    if (!normalizedColor) {
      Alert.alert(
        localizeLegacy(language, 'Color invalido', 'Invalid color'),
        localizeLegacy(language, 'Selecciona un color valido.', 'Select a valid color.')
      );
      return;
    }

    try {
      await createAccount(normalizedName, parsedBalance, normalizedColor, selectedAccountCurrencyCode);
      if (parsedBalance !== 0) {
        await createAccountMovement({
          type: 'account_adjustment',
          amount: roundCurrencyAmount(parsedBalance, selectedAccountCurrencyCode),
          accountName: normalizedName,
          currencyCode: selectedAccountCurrencyCode,
          note: 'Initial account balance',
        });
      }
      await loadAccounts();
      setAccountName('');
      setAccountBalanceInput('');
      setSelectedAccountColor(ALL_COLOR_OPTIONS[0]);
      setSelectedAccountCurrencyCode(defaultCurrencyCode);
      setIsNewAccountColorTableVisible(false);
      setIsNewAccountCurrencyDropdownOpen(false);
      setIsNewAccountModalVisible(false);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo crear la cuenta', 'Could not create account'));
    }
  };

  const onSaveBudget = async (): Promise<boolean> => {
    if (usedBudgetCategorySet.has(budgetCategory)) {
      Alert.alert(localizeLegacy(language, 'Categoría en uso', 'Category in use'), t.budgetCategoryInUse);
      return false;
    }

    const parsedAmount = parseAmountInput(budgetAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      Alert.alert(
        localizeLegacy(language, 'Monto invalido', 'Invalid amount'),
        localizeLegacy(language, 'Ingresa un presupuesto valido (0 o mayor).', 'Enter a valid budget amount (0 or greater).')
      );
      return false;
    }

    try {
      await upsertBudget(budgetCategory, Number(parsedAmount.toFixed(2)), defaultCurrencyCode);
      setBudgetAmountInput('');
      await loadBudgets();
      return true;
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo guardar el presupuesto', 'Could not save budget'));
      return false;
    }
  };

  const onAdjustBudget = async (category: string, operator: 1 | -1) => {
    const parsedAmount = parseAmountInput(budgetDeltaInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(
        localizeLegacy(language, 'Monto invalido', 'Invalid amount'),
        localizeLegacy(language, 'Ingresa un ajuste mayor que 0.', 'Enter an adjustment greater than 0.')
      );
      return;
    }

    try {
      await changeBudgetAmount(category, operator * parsedAmount, defaultCurrencyCode);
      setBudgetDeltaInput('');
      await loadBudgets();
      setIsBudgetAdjustModalVisible(false);
      setSelectedBudgetCategoryForAdjust(null);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo ajustar el presupuesto', 'Could not adjust budget'));
    }
  };

  const onDeleteBudget = (category: string) => {
    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar presupuesto', 'Delete budget'),
      message: translate(
        language,
        `Se eliminara el presupuesto de "${getCategoryLabel(category, language)}".`,
        `Budget for "${getCategoryLabel(category, language)}" will be deleted.`,
        `Il budget di "${getCategoryLabel(category, language)}" verr\u00e0 eliminato.`,
        `\u300c${getCategoryLabel(category, language)}\u300d\u306e\u4e88\u7b97\u3092\u524a\u9664\u3057\u307e\u3059\u3002`
      ),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deleteBudget(category, defaultCurrencyCode);
          await loadBudgets();
        } catch (error) {
          Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo eliminar el presupuesto', 'Could not delete budget'));
        }
      },
    });
  };

  const onSavePayable = async () => {
    const normalizedName = payableName.trim();
    const parsedAmount = parseAmountInput(payableAmountInput);
    const parsedDueDay = Number(payableDueDayInput.trim());

    if (!normalizedName) {
      Alert.alert(localizeLegacy(language, 'Nombre requerido', 'Name required'), localizeLegacy(language, 'Ingresa el nombre del gasto fijo.', 'Enter the fixed expense name.'));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(localizeLegacy(language, 'Monto inválido', 'Invalid amount'), localizeLegacy(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.'));
      return;
    }
    if (!hasValidCategory(payableCategory, categories)) {
      Alert.alert(localizeLegacy(language, 'Categoría requerida', 'Category required'), localizeLegacy(language, 'Selecciona una categoría.', 'Select a category.'));
      return;
    }
    if (!Number.isFinite(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 31) {
      Alert.alert(localizeLegacy(language, 'Día inválido', 'Invalid day'), localizeLegacy(language, 'Usa un día entre 1 y 31.', 'Use a day from 1 to 31.'));
      return;
    }

    try {
      await createPayable(normalizedName, parsedAmount, payableCategory, parsedDueDay, defaultCurrencyCode);
      setPayableName('');
      setPayableAmountInput('');
      setPayableDueDayInput('1');
      setIsPayableModalVisible(false);
      await loadPayables();
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo crear el gasto fijo.', 'Could not create payable.'));
    }
  };

  const onPayPayable = async () => {
    if (!selectedPayableForPayment) {
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === payablePaymentAccountId);
    if (!selectedAccount) {
      Alert.alert(localizeLegacy(language, 'Cuenta requerida', 'Account required'), localizeLegacy(language, 'Selecciona la cuenta de pago.', 'Select the payment account.'));
      return;
    }
    if (selectedAccount.currencyCode !== selectedPayableForPayment.currencyCode) {
      Alert.alert(
        translate(language, 'Moneda incompatible', 'Currency mismatch', 'Valute non compatibili', '通貨が一致しません'),
        translate(language, 'Selecciona una cuenta con la misma moneda que este pago pendiente.', 'Select an account with the same currency as this payable.', 'Seleziona un conto con la stessa valuta di questa spesa fissa.', 'この支払い予定と同じ通貨の口座を選択してください。')
      );
      return;
    }
    if (selectedAccount.balance < selectedPayableForPayment.amount) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getSimpleInsufficientFundsMessage(language, selectedAccount.name)
      );
      return;
    }

    try {
      const createdAt = new Date().toISOString();
      await updateAccountBalance(
        selectedAccount.id,
        roundCurrencyAmount(selectedAccount.balance - selectedPayableForPayment.amount, selectedAccount.currencyCode)
      );
      await markPayablePaid(selectedPayableForPayment.id, selectedAccount.name, createdAt);
      await createExpense(
        selectedPayableForPayment.name,
        1,
        selectedPayableForPayment.amount,
        selectedAccount.name,
        createdAt,
        selectedPayableForPayment.currencyCode
      );
      await createProduct(
        selectedPayableForPayment.name,
        1,
        selectedPayableForPayment.amount,
        selectedPayableForPayment.amount,
        createdAt,
        selectedPayableForPayment.category,
        selectedAccount.name,
        selectedPayableForPayment.currencyCode
      );
      await createAccountMovement({
        type: 'expense_manual',
        amount: -selectedPayableForPayment.amount,
        accountName: selectedAccount.name,
        currencyCode: selectedPayableForPayment.currencyCode,
        note: selectedPayableForPayment.name,
        createdAt,
      });
      await createTransaction({
        type: 'expense',
        source: 'payable_payment',
        amount: selectedPayableForPayment.amount,
        currencyCode: selectedPayableForPayment.currencyCode,
        quantity: 1,
        category: selectedPayableForPayment.category,
        accountName: selectedAccount.name,
        note: selectedPayableForPayment.name,
        relatedId: selectedPayableForPayment.id,
        createdAt,
      });
      setSelectedPayableForPayment(null);
      await Promise.all([loadPayables(), loadAccounts(), loadExpenses(), loadProducts(), loadTransactions()]);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo pagar el gasto fijo.', 'Could not pay payable.'));
    }
  };

  const onDeletePayable = (payable: Payable) => {
    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar por pagar', 'Delete payable'),
      message: translate(
        language,
        `Se eliminará "${payable.name}" de tus gastos fijos.`,
        `"${payable.name}" will be removed from fixed expenses.`,
        `"${payable.name}" verr\u00e0 rimosso dalle spese fisse.`,
        `\u300c${payable.name}\u300d\u3092\u56fa\u5b9a\u8cbb\u304b\u3089\u524a\u9664\u3057\u307e\u3059\u3002`
      ),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deletePayable(payable.id);
          await loadPayables();
        } catch (error) {
          Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo eliminar.', 'Could not delete.'));
        }
      },
    });
  };

  const onSaveCategoryColor = async (color: string) => {
    if (!colorCategory) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), t.selectCategoryFirst);
      return;
    }

    try {
      await upsertCategoryColor(colorCategory, color);
      await loadCategoryColors();
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo guardar el color', 'Could not save category color'));
    }
  };

  const onApplyAccountMovement = async (account: Account, operator: 1 | -1, amountInput: string) => {
    const movement = parseAmountInput(amountInput);
    if (!Number.isFinite(movement) || movement <= 0) {
      Alert.alert(localizeLegacy(language, 'Monto invalido', 'Invalid amount'), localizeLegacy(language, 'Ingresa un monto de movimiento mayor que 0.', 'Enter a movement amount greater than 0.'));
      return;
    }

    const updatedBalance = roundCurrencyAmount(account.balance + operator * movement, account.currencyCode);
    if (updatedBalance < 0) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        translate(
          language,
          `No puedes restar ${formatCurrency(movement, language, numberFormat, account.currencyCode)} porque la cuenta "${account.name}" solo tiene ${formatCurrency(account.balance, language, numberFormat, account.currencyCode)}.`,
          `You cannot subtract ${formatCurrency(movement, language, numberFormat, account.currencyCode)} because account "${account.name}" only has ${formatCurrency(account.balance, language, numberFormat, account.currencyCode)}.`,
          `Non puoi sottrarre ${formatCurrency(movement, language, numberFormat, account.currencyCode)} perch\u00e9 il conto "${account.name}" dispone solo di ${formatCurrency(account.balance, language, numberFormat, account.currencyCode)}.`,
          `\u53e3\u5ea7\u300c${account.name}\u300d\u306e\u6b8b\u9ad8\u306f${formatCurrency(account.balance, language, numberFormat, account.currencyCode)}\u306e\u305f\u3081\u3001${formatCurrency(movement, language, numberFormat, account.currencyCode)}\u3092\u5dee\u3057\u5f15\u3051\u307e\u305b\u3093\u3002`
        )
      );
      return;
    }

    try {
      await updateAccountBalance(account.id, updatedBalance);
      if (operator === 1) {
        await createIncomeEntry('manual_add', movement, account.name, undefined, account.currencyCode);
        await createAccountMovement({
          type: 'income_manual',
          amount: movement,
          accountName: account.name,
          currencyCode: account.currencyCode,
          note: 'Manual income',
        });
        await createTransaction({
          type: 'income',
          source: 'manual_add',
          amount: movement,
          currencyCode: account.currencyCode,
          category: FALLBACK_CATEGORY,
          accountName: account.name,
          note: 'Manual income',
        });
        await Promise.all([loadAccounts(), loadIncomeEntries(), loadTransactions()]);
      } else {
        await createAccountMovement({
          type: 'account_adjustment',
          amount: -movement,
          accountName: account.name,
          currencyCode: account.currencyCode,
          note: 'Manual account subtraction',
        });
        await createTransaction({
          type: 'expense',
          source: 'manual_subtract',
          amount: movement,
          currencyCode: account.currencyCode,
          category: FALLBACK_CATEGORY,
          accountName: account.name,
          note: 'Manual account subtraction',
        });
        await Promise.all([loadAccounts(), loadTransactions()]);
      }
      setAccountActionAmount('');
      setAccountActionType(null);
      setIsAccountActionModalVisible(false);
      setSelectedAccountForAction(null);
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo actualizar la cuenta', 'Could not update account'));
    }
  };

  const onPressAccount = (account: Account) => {
    setSelectedAccountForAction(account);
    setAccountActionType(null);
    setAccountActionAmount('');
    setIsAccountEditColorTableVisible(false);
    setIsAccountActionCurrencyDropdownOpen(false);
    setIsAccountActionModalVisible(true);
  };

  const onUpdateSelectedAccountColor = async (color: string) => {
    if (!selectedAccountForAction) {
      return;
    }

    try {
      await updateAccountColor(selectedAccountForAction.id, color);
      await loadAccounts();
      setSelectedAccountForAction((prev) => (prev ? { ...prev, color } : prev));
    } catch (error) {
      Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo actualizar el color', 'Could not update color'));
    }
  };

  const onUpdateSelectedAccountCurrency = async (currencyCode: AppCurrencyCode) => {
    if (!selectedAccountForAction) {
      return;
    }

    if (selectedAccountForAction.currencyCode === currencyCode) {
      setIsAccountActionCurrencyDropdownOpen(false);
      return;
    }

    const applyCurrency = async (convertBalance: boolean) => {
      try {
        let nextBalance = selectedAccountForAction.balance;
        if (convertBalance && nextBalance !== 0) {
          const quote = await getExchangeRate(selectedAccountForAction.currencyCode, currencyCode);
          nextBalance = convertWithRate(nextBalance, quote.rate, currencyCode);
        }
        if (convertBalance) {
          await updateAccountBalance(selectedAccountForAction.id, nextBalance);
        }
        await updateAccountCurrency(selectedAccountForAction.id, currencyCode);
        await loadAccounts();
        setSelectedAccountForAction((prev) => (prev ? { ...prev, balance: nextBalance, currencyCode } : prev));
        setIsAccountActionCurrencyDropdownOpen(false);
      } catch (error) {
        Alert.alert(
          translate(language, 'Error', 'Error', 'Errore', '\u30a8\u30e9\u30fc'),
          error instanceof Error
            ? error.message
            : translate(language, 'No se pudo actualizar la moneda. Conéctate a Internet si elegiste convertir el saldo.', 'Could not update the currency. Connect to the Internet if you chose to convert the balance.', 'Non è stato possibile aggiornare la valuta. Connettiti a Internet se hai scelto di convertire il saldo.', '\u901a\u8ca8\u3092\u66f4\u65b0\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u6b8b\u9ad8\u3092\u63db\u7b97\u3059\u308b\u5834\u5408\u306f\u30a4\u30f3\u30bf\u30fc\u30cd\u30c3\u30c8\u306b\u63a5\u7d9a\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
        );
      }
    };

    Alert.alert(
      translate(language, 'Cambiar moneda de la cuenta', 'Change account currency', 'Cambia valuta del conto', '\u53e3\u5ea7\u901a\u8ca8\u3092\u5909\u66f4'),
      translate(
        language,
        'Elige si el saldo actual ya está expresado en la nueva moneda o si deseas convertirlo con una tasa de cambio. La conversión puede usar una tasa guardada o requerir Internet.',
        'Choose whether the current balance is already expressed in the new currency or should be converted using an exchange rate. Conversion may use a saved rate or require Internet access.',
        'Scegli se il saldo attuale è già espresso nella nuova valuta o se deve essere convertito con un tasso di cambio. La conversione può usare un tasso salvato o richiedere Internet.',
        '\u73fe\u5728\u306e\u6b8b\u9ad8\u304c\u65e2\u306b\u65b0\u3057\u3044\u901a\u8ca8\u3067\u8868\u793a\u3055\u308c\u3066\u3044\u308b\u304b\u3001\u70ba\u66ff\u30ec\u30fc\u30c8\u3067\u63db\u7b97\u3059\u308b\u304b\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u63db\u7b97\u306b\u306f\u4fdd\u5b58\u6e08\u307f\u30ec\u30fc\u30c8\u307e\u305f\u306f\u30a4\u30f3\u30bf\u30fc\u30cd\u30c3\u30c8\u63a5\u7d9a\u304c\u5fc5\u8981\u306b\u306a\u308b\u5834\u5408\u304c\u3042\u308a\u307e\u3059\u3002'
      ),
      [
        { text: translate(language, 'Cancelar', 'Cancel', 'Annulla', '\u30ad\u30e3\u30f3\u30bb\u30eb'), style: 'cancel' },
        { text: translate(language, 'Conservar monto', 'Keep amount', 'Mantieni importo', '\u91d1\u984d\u3092\u7dad\u6301'), onPress: () => void applyCurrency(false) },
        { text: translate(language, 'Convertir saldo', 'Convert balance', 'Converti saldo', '\u6b8b\u9ad8\u3092\u63db\u7b97'), onPress: () => void applyCurrency(true) },
      ]
    );
  };

  const onDeleteSelectedAccount = () => {
    if (!selectedAccountForAction) {
      return;
    }

    showDangerConfirm({
      title: localizeLegacy(language, 'Eliminar cuenta', 'Delete account'),
      message: translate(
        language,
        `Se eliminara la cuenta "${selectedAccountForAction.name}". Esta accion no se puede deshacer.`,
        `Account "${selectedAccountForAction.name}" will be deleted. This action cannot be undone.`,
        `Il conto "${selectedAccountForAction.name}" verr\u00e0 eliminato. Questa azione non pu\u00f2 essere annullata.`,
        `\u53e3\u5ea7\u300c${selectedAccountForAction.name}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u3002\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002`
      ),
      cancelText: localizeLegacy(language, 'Cancelar', 'Cancel'),
      confirmText: localizeLegacy(language, 'Eliminar', 'Delete'),
      onConfirm: async () => {
        try {
          await deleteAccountById(selectedAccountForAction.id);
          await loadAccounts();
          setIsAccountActionModalVisible(false);
          setSelectedAccountForAction(null);
          setAccountActionType(null);
          setAccountActionAmount('');
          Alert.alert(localizeLegacy(language, 'Listo', 'Done'), t.accountDeleted);
        } catch (error) {
          Alert.alert(localizeLegacy(language, 'Error', 'Error'), error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo eliminar la cuenta', 'Could not delete account'));
        }
      },
    });
  };

  const onConfirmAccountAction = async () => {
    if (!selectedAccountForAction) {
      Alert.alert(
        localizeLegacy(language, 'Cuenta requerida', 'Account required'),
        localizeLegacy(language, 'Selecciona una cuenta antes de aplicar el movimiento.', 'Select an account before applying movement.')
      );
      return;
    }

    if (!accountActionType) {
      Alert.alert(
        localizeLegacy(language, 'Tipo requerido', 'Type required'),
        localizeLegacy(language, 'Selecciona si deseas agregar o restar ingresos.', 'Select whether you want to add or subtract income.')
      );
      return;
    }

    const operator: 1 | -1 = accountActionType === 'add' ? 1 : -1;
    await onApplyAccountMovement(selectedAccountForAction, operator, accountActionAmount);
  };

  const onApplyInternalTransfer = async () => {
    if (internalTransferValidationMessage) {
      return;
    }
    const from = accounts.find((item) => item.id === internalTransferFromId);
    const to = accounts.find((item) => item.id === internalTransferToId);
    const parsed = parseAmountInput(internalTransferAmount);

    if (!from || !to) {
      Alert.alert(
        localizeLegacy(language, 'Cuentas requeridas', 'Accounts required'),
        localizeLegacy(language, 'Selecciona la cuenta origen y destino.', 'Select source and destination accounts.')
      );
      return;
    }

    if (from.id === to.id) {
      Alert.alert(
        localizeLegacy(language, 'Transferencia inválida', 'Invalid transfer'),
        localizeLegacy(language, 'La cuenta origen y destino deben ser diferentes.', 'Source and destination accounts must be different.')
      );
      return;
    }

    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert(
        localizeLegacy(language, 'Monto invalido', 'Invalid amount'),
        localizeLegacy(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.')
      );
      return;
    }

    if (from.balance < parsed) {
      Alert.alert(
        localizeLegacy(language, 'Fondos insuficientes', 'Insufficient funds'),
        getSimpleInsufficientFundsMessage(language, from.name)
      );
      return;
    }

    let destinationAmount = parsed;
    let conversionNote = '';
    if (from.currencyCode !== to.currencyCode) {
      try {
        const quote = await getExchangeRate(from.currencyCode, to.currencyCode);
        destinationAmount = convertWithRate(parsed, quote.rate, to.currencyCode);
        conversionNote = ` | FX ${from.currencyCode}/${to.currencyCode} ${quote.rate} (${quote.date}${quote.fromCache ? ', cached' : ''})`;
      } catch (error) {
        Alert.alert(
          translate(language, 'Tasa no disponible', 'Rate unavailable', 'Tasso non disponibile', '為替レートを取得できません'),
          error instanceof Error ? error.message : translate(language, 'No se pudo convertir entre monedas.', 'Could not convert currencies.', 'Impossibile convertire le valute.', '通貨を換算できませんでした。')
        );
        return;
      }
    }

    const fromNext = roundCurrencyAmount(from.balance - parsed, from.currencyCode);
    const toNext = roundCurrencyAmount(to.balance + destinationAmount, to.currencyCode);

    try {
      await updateAccountBalance(from.id, fromNext);
      await updateAccountBalance(to.id, toNext);
      await createAccountMovement({
        type: 'transfer_out',
        amount: -parsed,
        accountName: from.name,
        currencyCode: from.currencyCode,
        note: `Internal transfer to ${to.name}${conversionNote}`,
      });
      await createAccountMovement({
        type: 'transfer_in',
        amount: destinationAmount,
        accountName: to.name,
        currencyCode: to.currencyCode,
        note: `Internal transfer from ${from.name}${conversionNote}`,
      });
      await createTransaction({
        type: 'transfer_out',
        source: 'internal_transfer',
        amount: parsed,
        currencyCode: from.currencyCode,
        accountName: from.name,
        category: FALLBACK_CATEGORY,
        note: `Internal transfer to ${to.name}${conversionNote}`,
      });
      await createTransaction({
        type: 'transfer_in',
        source: 'internal_transfer',
        amount: destinationAmount,
        currencyCode: to.currencyCode,
        accountName: to.name,
        category: FALLBACK_CATEGORY,
        note: `Internal transfer from ${from.name}${conversionNote}`,
      });
      await Promise.all([loadAccounts(), loadTransactions()]);
      setInternalTransferAmount('');
      setIsInternalTransferModalVisible(false);
      Alert.alert(
        translate(language, 'Transferencia aplicada', 'Transfer applied', 'Trasferimento applicato', '送金を適用しました'),
        from.currencyCode === to.currencyCode
          ? translate(language, `Se movió ${displayCurrency(parsed, from.currencyCode)} de "${from.name}" a "${to.name}".`, `${displayCurrency(parsed, from.currencyCode)} moved from "${from.name}" to "${to.name}".`, `${displayCurrency(parsed, from.currencyCode)} trasferiti da "${from.name}" a "${to.name}".`, `${displayCurrency(parsed, from.currencyCode)}を「${from.name}」から「${to.name}」へ移動しました。`)
          : translate(language, `Se movió ${displayCurrency(parsed, from.currencyCode)} y se acreditaron ${displayCurrency(destinationAmount, to.currencyCode)}.`, `${displayCurrency(parsed, from.currencyCode)} was moved and ${displayCurrency(destinationAmount, to.currencyCode)} was credited.`, `Sono stati trasferiti ${displayCurrency(parsed, from.currencyCode)} e accreditati ${displayCurrency(destinationAmount, to.currencyCode)}.`, `${displayCurrency(parsed, from.currencyCode)}を移動し、${displayCurrency(destinationAmount, to.currencyCode)}を入金しました。`)
      );
    } catch (error) {
      Alert.alert(
        localizeLegacy(language, 'Error', 'Error'),
        error instanceof Error ? error.message : localizeLegacy(language, 'No se pudo transferir', 'Could not transfer')
      );
    }
  };

  const renderColorTable = (
    selectedColor: string | null,
    onSelect: (color: string) => void,
    keyPrefix: string
  ) => {
    return (
      <View style={styles.colorTableWrap}>
        {COLOR_GROUPS.flatMap((group) => group.colors).map((color) => (
          <TouchableOpacity
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            key={`${keyPrefix}-${color}`}
            accessibilityLabel={`${translate(language, 'Seleccionar color', 'Select color', 'Seleziona colore', '色を選択')} ${color}`}
            style={[styles.colorChip, { backgroundColor: color }, selectedColor === color ? styles.colorChipActive : undefined]}
            onPress={() => onSelect(color)}
          />
        ))}
      </View>
    );
  };

  const renderBudgetOverview = () => (
    <View style={[styles.card, styles.homeBudgetOverview]}>
      <View style={styles.accountsHeaderRow}>
        <TouchableOpacity
          activeOpacity={BUTTON_ACTIVE_OPACITY}
          style={styles.addCircleButton}
          onPress={() => {
            if (availableBudgetCategories.length > 0) setBudgetCategory(availableBudgetCategories[0]);
            setIsBudgetModalVisible(true);
          }}
        >
          <Text style={styles.addCircleButtonText}>+</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>{t.budgetByCategory}</Text>
      </View>
      <Text style={styles.helpText}>
        {translate(language, 'Moneda de análisis', 'Analysis currency', 'Valuta di analisi', '分析通貨')}: {defaultCurrencyCode}
      </Text>
      {budgets.length === 0 ? (
        <Text style={styles.empty}>{t.noBudgets}</Text>
      ) : (
        <View style={styles.homeBudgetList}>
          {budgets.map((budget) => {
            const spent = currentMonthSpentByCategory.get(budget.category) ?? 0;
            const remaining = Number((budget.amount - spent).toFixed(2));
            const warningLevel = getBudgetWarningLevel(budget.amount, spent);
            const progress = `${Math.min(100, Math.max(0, (spent / Math.max(1, budget.amount)) * 100))}%` as `${number}%`;
            return (
              <View key={`home-budget-${budget.category}`} style={styles.homeBudgetItem}>
                <View style={styles.homeBudgetTopRow}>
                  <View style={styles.budgetCategoryRow}>
                    <View style={[styles.budgetCategoryDot, { backgroundColor: categoryColorMap[budget.category] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY] }]} />
                    <Text style={styles.itemDesc}>{getCategoryLabel(budget.category, language)}</Text>
                  </View>
                  <Text style={[styles.homeBudgetRemaining, remaining <= 0 ? styles.negativeBudget : undefined]}>{displayCurrency(remaining)}</Text>
                </View>
                <View style={styles.budgetProgressTrack}>
                  <View style={[styles.budgetProgressFill, { width: progress, backgroundColor: remaining <= 0 ? theme.dangerBorder : categoryColorMap[budget.category] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY] }]} />
                </View>
                <Text style={styles.homeBudgetDetails}>
                  {t.monthlySpent}: {displayCurrency(spent)} · {t.maxBudget}: {displayCurrency(budget.amount)}
                </Text>
                {warningLevel ? <Text style={styles.budgetWarningText}>{warningLevel === 'over' ? translate(language, 'Presupuesto excedido', 'Budget exceeded', 'Budget superato', '予算を超過しました') : `${translate(language, 'Alerta', 'Alert', 'Avviso', '警告')}: ${warningLevel}%`}</Text> : null}
                <View style={styles.homeBudgetActionRow}>
                  <TouchableOpacity
                    activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={styles.adjustBudgetInlineButton}
                    onPress={() => {
                      setSelectedBudgetCategoryForAdjust(budget.category);
                      setBudgetDeltaInput('');
                      setIsBudgetAdjustModalVisible(true);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>{t.adjustBudget}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.deleteTableButton} onPress={() => onDeleteBudget(budget.category)}>
                    <Text style={styles.deleteTableButtonText}>{t.delete}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderPayablesOverview = () => (
    <View style={[styles.card, styles.homePayablesOverview]}>
      <View style={styles.accountsHeaderRow}>
        <TouchableOpacity
          activeOpacity={BUTTON_ACTIVE_OPACITY}
          style={styles.addCircleButton}
          onPress={() => {
            setPayableCategory(FALLBACK_CATEGORY);
            setPayablePaymentAccountId(null);
            setIsPayableModalVisible(true);
          }}
        >
          <Text style={styles.addCircleButtonText}>+</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>{translate(language, 'Por pagar', 'Payables', 'Da pagare', '支払い予定')}</Text>
      </View>
      <Text style={styles.helpText}>
        {translate(language, 'Cada pago conserva su propia moneda.', 'Each payable keeps its own currency.', 'Ogni pagamento mantiene la propria valuta.', '各支払い予定は独自の通貨を保持します。')}
      </Text>
      {payables.length === 0 ? (
        <Text style={styles.empty}>{translate(language, 'No hay gastos fijos configurados.', 'No fixed expenses configured.', 'Non ci sono spese fisse configurate.', '固定費は設定されていません。')}</Text>
      ) : (
        <View style={styles.homeBudgetList}>
          {payables.map((payable) => (
            <View key={`home-payable-${payable.id}`} style={styles.homePayableItem}>
              <View style={styles.homeBudgetTopRow}>
                <View style={styles.budgetCategoryRow}>
                  <View style={[styles.payableStatusDot, payable.isPaid ? styles.payableStatusPaid : styles.payableStatusPending]} />
                  <Text style={styles.itemDesc}>{payable.name}</Text>
                </View>
                <Text style={styles.itemAmount}>{displayCurrency(payable.amount, payable.currencyCode)}</Text>
              </View>
              <Text style={styles.homeBudgetDetails}>
                {getCategoryLabel(payable.category, language)} · {translate(language, 'Día', 'Day', 'Giorno', '日')} {payable.dueDay} · {payable.isPaid ? translate(language, 'Pagado', 'Paid', 'Pagato', '支払済み') : translate(language, 'Pendiente', 'Pending', 'In attesa', '保留中')}
              </Text>
              <View style={styles.homeBudgetActionRow}>
                {!payable.isPaid ? (
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.adjustBudgetInlineButton} onPress={() => {
                    setSelectedPayableForPayment(payable);
                    setPayablePaymentAccountId(null);
                  }}>
                    <Text style={styles.secondaryButtonText}>{translate(language, 'Pagar', 'Pay', 'Paga', '支払う')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.deleteTableButton} onPress={() => onDeletePayable(payable)}>
                  <Text style={styles.deleteTableButtonText}>{t.delete}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderCategoriesManager = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{translate(language, 'Categorías', 'Categories', 'Categorie', 'カテゴリ')}</Text>
      <Text style={styles.helpText}>{translate(language, 'Crea las categorías que usarás en gastos, recibos y presupuestos.', 'Create the categories you will use for expenses, receipts, and budgets.', 'Crea le categorie da usare per spese, ricevute e budget.', '支出、レシート、予算に使用するカテゴリを作成します。')}</Text>
      <TextInput placeholder={t.newCategory} value={newCategoryName} onChangeText={setNewCategoryName} style={styles.input} placeholderTextColor={theme.placeholder} />
      <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={onAddCategory}>
        <Text style={styles.secondaryButtonText}>{t.addCategory}</Text>
      </TouchableOpacity>
      {categories.length === 0 ? (
        <Text style={styles.empty}>{translate(language, 'Todavía no hay categorías. Crea una para empezar.', 'No categories yet. Create one to get started.', 'Non ci sono ancora categorie. Creane una per iniziare.', 'カテゴリはまだありません。最初のカテゴリを作成してください。')}</Text>
      ) : (
        <View style={styles.categoryManagerList}>
          {categories.map((category) => (
            <View key={`categories-page-${category}`} style={styles.categoryManagerRow}>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={[styles.filterChip, manualCategory === category ? styles.filterChipActive : undefined]} onPress={() => setManualCategory(category)}>
                <Text style={[styles.filterChipText, manualCategory === category ? styles.filterChipTextActive : undefined]}>{getCategoryLabel(category, language)}</Text>
              </TouchableOpacity>
              {category !== FALLBACK_CATEGORY ? (
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.deleteCategorySmallButton} onPress={() => onDeleteCategoryFromSettings(category)}>
                  <Text style={styles.deleteCategoryButtonText}>{t.delete}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const chartSize = 142;
  const chartStroke = 17;
  const chartRadius = (chartSize - chartStroke) / 2;
  const chartCircumference = 2 * Math.PI * chartRadius;
  const darkModeChartTrack = '#6b7280';
  const chartTrackColor = themeMode === 'dark' ? darkModeChartTrack : theme.borderStrong;
  // Category colors are user data, not theme colors. Keep them visible in every theme.
  const getChartSliceColor = (category: string) =>
    categoryColorMap[category] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY];
  const renderHomeChartVisual = (): ReactElement => {
    if (currentMonthTotal <= 0 || monthlyCategorySlices.length === 0) {
      return (
        <View style={styles.chartWrap}>
          <View style={[styles.emptyChart, { borderColor: chartTrackColor }]} />
          <View style={styles.chartCenter}>
            <Text style={styles.chartCenterValue}>{displayCurrency(0)}</Text>
            <Text style={styles.chartCenterSub}>{localizeLegacy(language, 'Total', 'Total')}</Text>
          </View>
        </View>
      );
    }

    if (chartType === 'circle') {
      let offsetRatio = 0;
      return (
        <View style={styles.chartWrap}>
          <Svg width={chartSize} height={chartSize}>
            {monthlyCategorySlices.length === 1 ? (
              <Circle
                cx={chartSize / 2}
                cy={chartSize / 2}
                r={chartRadius + chartStroke / 2}
                fill={getChartSliceColor(monthlyCategorySlices[0].category)}
              />
            ) : monthlyCategorySlices.map((slice) => {
              const nextRatio = offsetRatio + slice.percentage / 100;
              const path = describePieSlice(chartSize / 2, chartRadius + chartStroke / 2, offsetRatio, nextRatio);
              offsetRatio = nextRatio;
              return <Path key={`circle-${slice.category}`} d={path} fill={getChartSliceColor(slice.category)} />;
            })}
          </Svg>
        </View>
      );
    }

    if (chartType === 'line' || chartType === 'bar') {
      const padding = 16;
      const graphWidth = chartSize - padding * 2;
      const graphHeight = chartSize - padding * 2;
      const maxValue = Math.max(...monthlyCategorySlices.map((slice) => slice.total), 1);
      const getPoint = (index: number, value: number) => {
        const x = monthlyCategorySlices.length === 1
          ? chartSize / 2
          : padding + (graphWidth * index) / (monthlyCategorySlices.length - 1);
        const y = padding + graphHeight - (value / maxValue) * graphHeight;
        return { x, y };
      };

      return (
        <View style={styles.chartWrap}>
          <Svg width={chartSize} height={chartSize}>
            <Line
              x1={padding}
              y1={padding + graphHeight}
              x2={padding + graphWidth}
              y2={padding + graphHeight}
              stroke={chartTrackColor}
              strokeWidth={1}
            />
            {chartType === 'line' ? (
              <>
                <Polyline
                  points={monthlyCategorySlices.map((slice, index) => {
                    const point = getPoint(index, slice.total);
                    return `${point.x},${point.y}`;
                  }).join(' ')}
                  fill="none"
                  stroke={theme.accentStrong}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {monthlyCategorySlices.map((slice, index) => {
                  const point = getPoint(index, slice.total);
                  return (
                    <Circle
                      key={`line-${slice.category}`}
                      cx={point.x}
                      cy={point.y}
                      r={4}
                      fill={getChartSliceColor(slice.category)}
                      stroke={theme.surface}
                      strokeWidth={2}
                    />
                  );
                })}
              </>
            ) : (() => {
              const gap = 5;
              const barWidth = Math.max(3, (graphWidth - gap * (monthlyCategorySlices.length - 1)) / monthlyCategorySlices.length);
              return monthlyCategorySlices.map((slice, index) => {
                const height = (slice.total / maxValue) * graphHeight;
                const x = padding + index * (barWidth + gap);
                const y = padding + graphHeight - height;
                return (
                  <Rect
                    key={`bar-${slice.category}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={Math.min(4, barWidth / 2)}
                    fill={getChartSliceColor(slice.category)}
                  />
                );
              });
            })()}
          </Svg>
        </View>
      );
    }

    return (
      <View style={styles.chartWrap}>
        <Svg width={chartSize} height={chartSize}>
          <Circle
            cx={chartSize / 2}
            cy={chartSize / 2}
            r={chartRadius}
            stroke={chartTrackColor}
            strokeWidth={chartStroke}
            fill="none"
          />
          <G rotation="-90" origin={`${chartSize / 2}, ${chartSize / 2}`}>
            {monthlyCategorySlices.reduce(
              (acc, slice, index) => {
                const dashLength = chartCircumference * (slice.percentage / 100);
                const offset = -chartCircumference * acc.offsetRatio;
                acc.elements.push(
                  <Circle
                    key={`pie-${slice.category}-${index}`}
                    cx={chartSize / 2}
                    cy={chartSize / 2}
                    r={chartRadius}
                    stroke={getChartSliceColor(slice.category)}
                    strokeWidth={chartStroke}
                    fill="none"
                    strokeDasharray={`${dashLength} ${chartCircumference}`}
                    strokeDashoffset={offset}
                    strokeLinecap="butt"
                  />
                );
                acc.offsetRatio += slice.percentage / 100;
                return acc;
              },
              { elements: [] as ReactElement[], offsetRatio: 0 }
            ).elements}
          </G>
        </Svg>
        <View style={styles.chartCenter}>
          <Text style={styles.chartCenterValue}>{displayCurrency(currentMonthTotal)}</Text>
          <Text style={styles.chartCenterSub}>{localizeLegacy(language, 'Total', 'Total')}</Text>
        </View>
      </View>
    );
  };
  const renderAnnualTrendChart = (): ReactElement => {
    const hasAnnualData = annualMonthSeries.some((item) => item.income > 0 || item.expense > 0);
    const padding = 14;
    const graphWidth = chartSize - padding * 2;
    const graphHeight = chartSize - padding * 2;

    if (!hasAnnualData) {
      return (
        <View style={styles.chartWrap}>
          <View style={[styles.emptyChart, { borderColor: chartTrackColor }]} />
          <View style={styles.chartCenter}>
            <Text style={styles.chartCenterValue}>{displayCurrency(0)}</Text>
            <Text style={styles.chartCenterSub}>{translate(language, 'Año', 'Year', 'Anno', '年')}</Text>
          </View>
        </View>
      );
    }

    const maxValue = Math.max(
      ...annualMonthSeries.flatMap((item) => [item.income, item.expense]),
      1
    );
    const getPoint = (index: number, value: number) => ({
      x: padding + (graphWidth * index) / (annualMonthSeries.length - 1),
      y: padding + graphHeight - (value / maxValue) * graphHeight,
    });
    const pointsFor = (key: 'income' | 'expense') =>
      annualMonthSeries
        .map((item, index) => {
          const point = getPoint(index, item[key]);
          return `${point.x},${point.y}`;
        })
        .join(' ');

    return (
      <View style={styles.chartWrap}>
        <Svg width={chartSize} height={chartSize}>
          <Line
            x1={padding}
            y1={padding + graphHeight}
            x2={padding + graphWidth}
            y2={padding + graphHeight}
            stroke={chartTrackColor}
            strokeWidth={1}
          />
          <Polyline
            points={pointsFor('income')}
            fill="none"
            stroke={theme.accentStrong}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Polyline
            points={pointsFor('expense')}
            fill="none"
            stroke={theme.dangerBorder}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
    );
  };
  const statusBarStyle = themeMode === 'light' ? 'dark' : 'light';
  const canSaveManualExpense = useMemo(() => {
    const parsedQuantity = Number(quantity);
    const parsedAmount = parseAmountInput(amount);
    return (
      description.trim().length > 0 &&
      Number.isInteger(parsedQuantity) &&
      parsedQuantity > 0 &&
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      hasValidCategory(manualCategory, categories) &&
      selectedExpenseAccountId != null
    );
  }, [amount, categories, description, manualCategory, quantity, selectedExpenseAccountId]);
  const canAnalyzeReceipt = ocrText.trim().length > 0;
  const parsedReceiptTotalInput = parseAmountInput(receiptTotalInput);
  const canSaveDetectedProducts =
    receiptAnalysis != null &&
    selectedReceiptAccountId != null &&
    hasValidCategory(receiptCategory, categories) &&
    ((Number.isFinite(parsedReceiptTotalInput) && parsedReceiptTotalInput > 0) ||
      (receiptAnalysis?.totalAmount ?? 0) > 0);
  const receiptValidationMessage = useMemo(() => {
    if (selectedReceiptAccountId == null) return translate(language, 'Selecciona la cuenta desde la que se pagó el recibo.', 'Select the account used to pay the receipt.', 'Seleziona il conto usato per pagare la ricevuta.', 'レシートの支払いに使用した口座を選択してください。');
    if (!hasValidCategory(receiptCategory, categories)) return translate(language, 'Selecciona una categoría antes de guardar.', 'Select a category before saving.', 'Seleziona una categoria prima di salvare.', '保存前にカテゴリを選択してください。');
    if (!receiptAnalysis) return translate(language, 'Analiza el recibo antes de guardar.', 'Analyze the receipt before saving.', 'Analizza la ricevuta prima di salvare.', '保存前にレシートを分析してください。');
    return null;
  }, [categories, language, receiptAnalysis, receiptCategory, selectedReceiptAccountId]);
  const parsedTransferTotalInput = parseAmountInput(transferTotalInput);
  const canApplyTransfer =
    transferMode != null &&
    selectedTransferAccountId != null &&
    ((Number.isFinite(parsedTransferTotalInput) && parsedTransferTotalInput > 0) ||
      (Number.isFinite(transferTotalAmount) && transferTotalAmount > 0));
  const quickExpenseValidationMessage = useMemo(() => {
    if (quickExpenseAccountId == null) return translate(language, 'Selecciona una cuenta para continuar.', 'Select an account to continue.', 'Seleziona un conto per continuare.', '続行するには口座を選択してください。');
    if (!hasValidCategory(quickExpenseCategory, categories)) return translate(language, 'Selecciona una categoría para continuar.', 'Select a category to continue.', 'Seleziona una categoria per continuare.', '続行するにはカテゴリを選択してください。');
    if (!Number.isFinite(parseAmountInput(quickExpenseAmount)) || parseAmountInput(quickExpenseAmount) <= 0) return translate(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.', 'Inserisci un importo maggiore di 0.', '0より大きい金額を入力してください。');
    return null;
  }, [categories, language, quickExpenseAccountId, quickExpenseAmount, quickExpenseCategory]);
  const quickIncomeValidationMessage = useMemo(() => {
    if (quickIncomeAccountId == null) return translate(language, 'Selecciona una cuenta de destino para continuar.', 'Select a destination account to continue.', 'Seleziona un conto di destinazione per continuare.', '続行するには入金先口座を選択してください。');
    if (!hasValidCategory(quickIncomeCategory, categories)) return translate(language, 'Selecciona una categoría para continuar.', 'Select a category to continue.', 'Seleziona una categoria per continuare.', '続行するにはカテゴリを選択してください。');
    if (!Number.isFinite(parseAmountInput(quickIncomeAmount)) || parseAmountInput(quickIncomeAmount) <= 0) return translate(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.', 'Inserisci un importo maggiore di 0.', '0より大きい金額を入力してください。');
    return null;
  }, [categories, language, quickIncomeAccountId, quickIncomeAmount, quickIncomeCategory]);
  const internalTransferValidationMessage = useMemo(() => {
    if (internalTransferFromId == null || internalTransferToId == null) return translate(language, 'Selecciona la cuenta origen y la cuenta destino.', 'Select both source and destination accounts.', 'Seleziona il conto di origine e quello di destinazione.', '送金元と送金先の口座を選択してください。');
    if (internalTransferFromId === internalTransferToId) return translate(language, 'Las cuentas deben ser diferentes.', 'Accounts must be different.', 'I conti devono essere diversi.', '異なる口座を選択してください。');
    if (!Number.isFinite(parseAmountInput(internalTransferAmount)) || parseAmountInput(internalTransferAmount) <= 0) return translate(language, 'Ingresa un monto mayor que 0.', 'Enter an amount greater than 0.', 'Inserisci un importo maggiore di 0.', '0より大きい金額を入力してください。');
    return null;
  }, [internalTransferAmount, internalTransferFromId, internalTransferToId, language]);
  const renderTransactionItem = useCallback(
    (item: Transaction): ReactElement => {
      const signedAmount = getTransactionSignedAmount(item);
      return (
        <View style={styles.itemRow}>
          <View style={styles.itemTextWrap}>
            <Text style={styles.itemDesc}>{getTransactionTypeLabel(item.type, language)}</Text>
            <Text style={styles.itemDate}>
              {t.account}: {item.accountName || t.noAccount}
            </Text>
            <Text style={styles.itemDate}>
              {t.category}: {getCategoryLabel(item.category || FALLBACK_CATEGORY, language)}
            </Text>
            <Text style={styles.itemDate}>{formatDateTime(item.createdAt, dateLocale)}</Text>
          </View>
          <Text style={[styles.itemAmount, signedAmount < 0 ? styles.negativeBudget : undefined]}>
            {signedAmount < 0 ? '-' : '+'}
            {displayCurrency(Math.abs(signedAmount), item.currencyCode)}
          </Text>
        </View>
      );
    },
    [dateLocale, displayCurrency, language, styles, t.account, t.category, t.noAccount]
  );
  const transactionsCard = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Transacciones', 'Transactions')}</Text>
      <View style={styles.filterWrap}>
        <Text style={styles.filterLabel}>{localizeLegacy(language, 'Rango rapido', 'Quick range')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[styles.filterChip, quickDateFilter === 'all' ? styles.filterChipActive : undefined]}
            onPress={() => setQuickDateFilter('all')}
          >
            <Text style={[styles.filterChipText, quickDateFilter === 'all' ? styles.filterChipTextActive : undefined]}>
              {localizeLegacy(language, 'Todo', 'All')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[styles.filterChip, quickDateFilter === 'today' ? styles.filterChipActive : undefined]}
            onPress={() => setQuickDateFilter('today')}
          >
            <Text style={[styles.filterChipText, quickDateFilter === 'today' ? styles.filterChipTextActive : undefined]}>
              {localizeLegacy(language, 'Hoy', 'Today')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[styles.filterChip, quickDateFilter === '7d' ? styles.filterChipActive : undefined]}
            onPress={() => setQuickDateFilter('7d')}
          >
            <Text style={[styles.filterChipText, quickDateFilter === '7d' ? styles.filterChipTextActive : undefined]}>
              {localizeLegacy(language, '7 dias', '7 days')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[styles.filterChip, quickDateFilter === 'month' ? styles.filterChipActive : undefined]}
            onPress={() => setQuickDateFilter('month')}
          >
            <Text style={[styles.filterChipText, quickDateFilter === 'month' ? styles.filterChipTextActive : undefined]}>
              {localizeLegacy(language, 'Este mes', 'This month')}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <Text style={styles.filterLabel}>{localizeLegacy(language, 'Ordenar por', 'Sort by')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[
              styles.filterChip,
              transactionSortField === 'date' && transactionSortDirection === 'desc'
                ? styles.filterChipActive
                : undefined,
            ]}
            onPress={() => {
              setTransactionSortField('date');
              setTransactionSortDirection('desc');
            }}
          >
            <Text
              style={[
                styles.filterChipText,
                transactionSortField === 'date' && transactionSortDirection === 'desc'
                  ? styles.filterChipTextActive
                  : undefined,
              ]}
            >
              {localizeLegacy(language, 'Fecha mas reciente', 'Newest date')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[
              styles.filterChip,
              transactionSortField === 'date' && transactionSortDirection === 'asc'
                ? styles.filterChipActive
                : undefined,
            ]}
            onPress={() => {
              setTransactionSortField('date');
              setTransactionSortDirection('asc');
            }}
          >
            <Text
              style={[
                styles.filterChipText,
                transactionSortField === 'date' && transactionSortDirection === 'asc'
                  ? styles.filterChipTextActive
                  : undefined,
              ]}
            >
              {localizeLegacy(language, 'Fecha mas antigua', 'Oldest date')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[
              styles.filterChip,
              transactionSortField === 'amount' && transactionSortDirection === 'desc'
                ? styles.filterChipActive
                : undefined,
            ]}
            onPress={() => {
              setTransactionSortField('amount');
              setTransactionSortDirection('desc');
            }}
          >
            <Text
              style={[
                styles.filterChipText,
                transactionSortField === 'amount' && transactionSortDirection === 'desc'
                  ? styles.filterChipTextActive
                  : undefined,
              ]}
            >
              {localizeLegacy(language, 'Monto mayor', 'Highest amount')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
            style={[
              styles.filterChip,
              transactionSortField === 'amount' && transactionSortDirection === 'asc'
                ? styles.filterChipActive
                : undefined,
            ]}
            onPress={() => {
              setTransactionSortField('amount');
              setTransactionSortDirection('asc');
            }}
          >
            <Text
              style={[
                styles.filterChipText,
                transactionSortField === 'amount' && transactionSortDirection === 'asc'
                  ? styles.filterChipTextActive
                  : undefined,
              ]}
            >
              {localizeLegacy(language, 'Monto menor', 'Lowest amount')}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={onClearFilters}>
          <Text style={styles.secondaryButtonText}>{t.clearFilters}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={() => void onExportTransactionsCsv()}>
          <Text style={styles.secondaryButtonText}>
            {isExportingCsv
              ? localizeLegacy(language, 'Cancelar exportación CSV', 'Cancel CSV export')
              : localizeLegacy(language, 'Exportar CSV', 'Export CSV')}
          </Text>
        </TouchableOpacity>
        {csvExportProgressLabel ? <Text style={styles.helpText}>{csvExportProgressLabel}</Text> : null}
      </View>

      {loading ? (
        <View style={styles.skeletonCardWrap}>
          <SkeletonBlock height={18} width="42%" borderRadius={8} />
          <SkeletonRows rows={5} rowHeight={62} gap={uiSpacing.xs} />
        </View>
      ) : transactions.length === 0 ? (
        <Text style={styles.empty}>
          {localizeLegacy(language, 'No hay movimientos para este filtro.', 'No movements found for this filter.')}
        </Text>
      ) : (
        <View style={styles.transactionsList}>
          {transactions.map((item) => (
            <View key={`transaction-${item.id}`}>{renderTransactionItem(item)}</View>
          ))}
          {isTransactionsLoadingMore ? (
            <Text style={styles.loading}>{localizeLegacy(language, 'Cargando más...', 'Loading more...')}</Text>
          ) : transactionsHasMore ? (
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={() => void loadMoreTransactions()}>
              <Text style={styles.secondaryButtonText}>
                {localizeLegacy(language, 'Cargar más movimientos', 'Load more movements')}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.helpText}>{localizeLegacy(language, 'Fin de resultados.', 'End of results.')}</Text>
          )}
        </View>
      )}
    </View>
  );

  if (shouldShowOnboarding) {
    const currentStep = ONBOARDING_STEPS[onboardingStepIndex] ?? ONBOARDING_STEPS[0];
    const isLastOnboardingStep = onboardingStepIndex === ONBOARDING_STEPS.length - 1;

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={statusBarStyle} />
        <View style={[styles.onboardingScreen, { paddingBottom: uiSpacing.md + insets.bottom }]}>
          <View style={styles.onboardingHeader}>
            <Text style={styles.onboardingBrand}>MyFinance</Text>
            <Text style={styles.onboardingBuild}>{t.buildNumber}</Text>
          </View>

          <View style={styles.onboardingCard}>
            <View style={styles.onboardingVisual}>
              <View style={styles.onboardingOrbLarge} />
              <View style={styles.onboardingOrbSmall} />
              <View style={styles.onboardingVisualCard}>
                <Text style={styles.onboardingVisualCurrency}>₡</Text>
              </View>
            </View>

            <Text style={styles.onboardingStepCount}>
              {localizeLegacy(language, 'Paso', 'Step')} {onboardingStepIndex + 1}/{ONBOARDING_STEPS.length}
            </Text>
            <Text style={styles.onboardingTitle}>
              {translate(language, currentStep.titleEs, currentStep.titleEn, currentStep.titleIt, currentStep.titleJa)}
            </Text>
            <Text style={styles.onboardingBody}>
              {translate(language, currentStep.bodyEs, currentStep.bodyEn, currentStep.bodyIt, currentStep.bodyJa)}
            </Text>

            <View style={styles.onboardingDots}>
              {ONBOARDING_STEPS.map((step, index) => (
                <View
                  key={`onboarding-dot-${step.titleEn}`}
                  style={[
                    styles.onboardingDot,
                    index === onboardingStepIndex ? styles.onboardingDotActive : undefined,
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.onboardingActions}>
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.primaryButton}
              onPress={onNextOnboardingStep}
            >
              <Text style={styles.primaryButtonText}>
                {isLastOnboardingStep
                  ? localizeLegacy(language, 'Comenzar', 'Get started')
                  : localizeLegacy(language, 'Siguiente', 'Next')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.onboardingSkipButton}
              onPress={() => void onCompleteOnboarding()}
            >
              <Text style={styles.onboardingSkipText}>{localizeLegacy(language, 'Omitir', 'Skip')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={statusBarStyle} />
      <Animated.View style={[styles.mainContent, { opacity: Animated.multiply(themeOpacity, contentLoadOpacity) }]}>
        <View style={styles.sectionAnimatedWrap}>
          <ScrollView contentContainerStyle={[styles.container, { paddingBottom: uiSpacing.md + insets.bottom }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.menuButton} onPress={openDrawer}>
              <Text style={styles.menuIcon}>{'\u2630'}</Text>
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>MyFinance</Text>
              <Text style={styles.headerCaption}>{capitalize(currentMonthLabel)}</Text>
            </View>
          </View>
          {activeSection !== 'inicio' ? (
            <Text style={styles.subtitle}>
              {activeSection === 'gastos'
                ? localizeLegacy(language, 'Sube y revisa recibos con OCR.', 'Upload and review receipts with OCR.')
                : activeSection === 'transacciones'
                  ? t.subtitleTransacciones
                : activeSection === 'graficoAnual'
                  ? translate(language, 'Tu panorama financiero del año.', 'Your financial overview for the year.', 'La tua panoramica finanziaria dell\'anno.', '年間の資金状況を確認できます。')
                : activeSection === 'cuentas'
                  ? ''
                  : activeSection === 'configuracion'
                    ? t.subtitleConfig
                    : ''}
            </Text>
          ) : null}

          {activeSection === 'inicio' ? (
            <>
              <View style={styles.homeHeroCard}>
                <View pointerEvents="none" style={styles.homeHeroGlow} />
                <View style={styles.homeHeroRow}>
                  <View style={styles.homeHeroTextWrap}>
                    <Text style={styles.homeHeroLabel}>{t.totalAccounts}</Text>
                    <Text
                      adjustsFontSizeToFit
                      minimumFontScale={0.55}
                      numberOfLines={1}
                      style={styles.homeHeroValue}
                    >
                      {totalAccountsDisplay}
                    </Text>
                    <Text style={styles.homeHeroSubLabel}>{capitalize(currentMonthLabel)}</Text>
                  </View>

                  <Image source={require('./assets/icon.png')} style={styles.homeHeroLogo} />
                </View>
              </View>

              <View style={styles.homeStatsGrid}>
                <View style={styles.homeStatCard}>
                  <Text style={styles.homeStatTitle}>{localizeLegacy(language, 'Gasto hormiga (Varios)', 'Small frequent expense')}</Text>
                  <Text style={styles.homeStatPrimaryText}>
                    {topVariosProduct
                      ? topVariosProduct.name
                      : localizeLegacy(language, 'Sin datos', 'No data')}
                  </Text>
                  {topVariosProduct ? <Text style={styles.homeStatValue}>{displayCurrency(topVariosProduct.totalAmount)}</Text> : null}
                </View>
                <View style={styles.homeStatCard}>
                  <Text style={styles.homeStatTitle}>{localizeLegacy(language, 'Transporte', 'Transport')}</Text>
                  <Text style={styles.homeStatValue}>{displayCurrency(currentMonthTransportTotal)}</Text>
                  <Text style={styles.homeStatSub}>
                    {currentMonthTransportTotal > 0
                      ? capitalize(currentMonthLabel)
                      : localizeLegacy(language, 'Sin datos', 'No data')}
                  </Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Resumen mensual', 'Monthly summary')}</Text>
                <Text style={styles.helpText}>
                  {translate(language, 'Moneda de análisis', 'Analysis currency', 'Valuta di analisi', '分析通貨')}: {defaultCurrencyCode}
                </Text>
                <View style={styles.homeSectionGrid}>
                  <View style={styles.homeSectionMiniCard}>
                    <Text style={styles.homeStatTitle}>{localizeLegacy(language, 'Ingresos del mes', 'Monthly income')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(currentMonthIncomeTotal)}</Text>
                  </View>
                  <View style={styles.homeSectionMiniCard}>
                    <Text style={styles.homeStatTitle}>{localizeLegacy(language, 'Gastos del mes', 'Monthly expenses')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(currentMonthExpenseTotal)}</Text>
                  </View>
                  <View style={[styles.homeSectionMiniCard, styles.homeSectionWideCard]}>
                    <Text style={styles.homeStatTitle}>{localizeLegacy(language, 'Balance del mes', 'Monthly balance')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(currentMonthBalance)}</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.card, styles.homeChartCard]}>
                <Text style={styles.sectionTitle}>{t.spendingStructure}</Text>
                <Text style={styles.helpText}>
                  {capitalize(currentMonthLabel)} · {defaultCurrencyCode}
                </Text>
                <View style={styles.chartContentRow}>
                  {renderHomeChartVisual()}
                </View>
                {monthlyCategorySlices.length > 0 ? (
                  <View style={styles.chartSideCard}>
                    <View style={styles.legendWrap}>
                      {monthlyCategorySlices.map((slice) => (
                        <View key={slice.category} style={styles.legendRow}>
                          <View style={[styles.legendDot, { backgroundColor: getChartSliceColor(slice.category) }]} />
                          <Text style={styles.legendText}>{getCategoryLabel(slice.category, language)}</Text>
                          <View style={styles.legendRight}>
                            <Text style={styles.legendPercent}>{slice.percentage.toFixed(1)}%</Text>
                            <Text style={styles.legendAmount}>{displayCurrency(slice.total)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              {renderPayablesOverview()}
              {renderBudgetOverview()}

            </>
          ) : null}

          {activeSection === 'graficoAnual' ? (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{translate(language, 'Resumen anual', 'Annual summary', 'Riepilogo annuale', '年間概要')}</Text>
                <Text style={styles.helpText}>{now.getFullYear()} · {defaultCurrencyCode}</Text>
                <View style={styles.annualSummaryGrid}>
                  <View style={styles.annualSummaryCard}>
                    <Text style={styles.homeStatTitle}>{translate(language, 'Ingresos del año', 'Year income', 'Entrate annuali', '年間収入')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(annualFinancialSummary.income)}</Text>
                  </View>
                  <View style={styles.annualSummaryCard}>
                    <Text style={styles.homeStatTitle}>{translate(language, 'Gastos del año', 'Year expenses', 'Spese annuali', '年間支出')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(annualFinancialSummary.expense)}</Text>
                  </View>
                  <View style={[styles.annualSummaryCard, styles.annualSummaryWideCard]}>
                    <Text style={styles.homeStatTitle}>{translate(language, 'Balance anual', 'Annual balance', 'Saldo annuale', '年間収支')}</Text>
                    <Text style={styles.homeStatValue}>{displayCurrency(annualFinancialSummary.balance)}</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.card, styles.homeChartCard]}>
                <Text style={styles.sectionTitle}>{translate(language, 'Ingresos y gastos por mes', 'Monthly income and expenses', 'Entrate e spese mensili', '月別の収入と支出')}</Text>
                <Text style={styles.helpText}>{now.getFullYear()}</Text>
                {renderAnnualTrendChart()}
                <View style={styles.annualChartLegend}>
                  <View style={styles.annualLegendItem}>
                    <View style={[styles.annualLegendDot, { backgroundColor: theme.accentStrong }]} />
                    <Text style={styles.annualLegendText}>{translate(language, 'Ingresos', 'Income', 'Entrate', '収入')}</Text>
                  </View>
                  <View style={styles.annualLegendItem}>
                    <View style={[styles.annualLegendDot, { backgroundColor: theme.dangerBorder }]} />
                    <Text style={styles.annualLegendText}>{translate(language, 'Gastos', 'Expenses', 'Spese', '支出')}</Text>
                  </View>
                </View>
                <View style={styles.annualMonthLabels}>
                  {annualMonthSeries.map((item) => (
                    <Text key={`annual-month-${item.month}`} numberOfLines={1} style={styles.annualMonthLabel}>
                      {item.label}
                    </Text>
                  ))}
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{translate(language, 'Categoría con mayor gasto', 'Top spending category', 'Categoria con più spese', '支出が最も多いカテゴリ')}</Text>
                {annualTopCategory ? (
                  <View style={styles.annualTopCategoryRow}>
                    <View style={[styles.legendDot, { backgroundColor: getChartSliceColor(annualTopCategory.category) }]} />
                    <Text style={styles.annualTopCategoryName}>{getCategoryLabel(annualTopCategory.category, language)}</Text>
                    <Text style={styles.annualTopCategoryAmount}>{displayCurrency(annualTopCategory.total)}</Text>
                  </View>
                ) : (
                  <Text style={styles.empty}>{translate(language, 'Aún no hay movimientos para este año.', 'There are no movements for this year yet.', 'Non ci sono ancora movimenti per quest\'anno.', '今年の取引はまだありません。')}</Text>
                )}
              </View>
            </>
          ) : null}

          {activeSection === 'gastos' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t.uploadReceipt}</Text>
              <Text style={styles.helpText}>
                {localizeLegacy(language, 'Sube una captura del recibo, revisa el texto detectado y confirma el total antes de guardar.', 'Upload a receipt screenshot, review detected text and confirm the total before saving.')}
              </Text>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.primaryButton, isPickingInvoiceImage ? styles.primaryButtonDisabled : undefined]}
                onPress={onPickInvoiceScreenshot}
                disabled={isPickingInvoiceImage}
              >
                <Text style={styles.primaryButtonText}>
                  {isPickingInvoiceImage
                    ? localizeLegacy(language, 'Abriendo galeria...', 'Opening gallery...')
                    : t.pickScreenshot}
                </Text>
              </TouchableOpacity>
              {receiptPipelineMessage ? <Text style={styles.helpText}>{receiptPipelineMessage}</Text> : null}

              {receiptImageUri ? (
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.clearButton} onPress={onClearReceipt}>
                  <Text style={styles.clearButtonText}>{t.removeScreenshot}</Text>
                </TouchableOpacity>
              ) : null}

              {receiptImageUri ? <Image source={{ uri: receiptImageUri }} style={styles.previewImage} /> : null}

              <Text style={styles.filterLabel}>{t.category}</Text>
              {categories.length === 0 ? (
                <Text style={styles.helpText}>
                  {localizeLegacy(language, 'Crea una categoría desde Configuración antes de guardar recibos.', 'Create a category from Settings before saving receipts.')}
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((category) => (
                    <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                      key={`receipt-${category}`}
                      style={[styles.filterChip, receiptCategory === category ? styles.filterChipActive : undefined]}
                      onPress={() => setReceiptCategory(category)}
                    >
                      <Text style={[styles.filterChipText, receiptCategory === category ? styles.filterChipTextActive : undefined]}>
                        {getCategoryLabel(category, language)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <Text style={styles.filterLabel}>{t.account}</Text>
              {accounts.length === 0 ? (
                <Text style={styles.helpText}>{t.createAccountFirst}</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {accounts.map((account) => (
                    <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                      key={`receipt-account-${account.id}`}
                      style={[styles.accountChoiceChip, selectedReceiptAccountId === account.id ? styles.filterChipActive : undefined, { borderColor: account.color }]}
                      onPress={() => setSelectedReceiptAccountId(account.id)}
                    >
                      <Text style={[styles.filterChipText, selectedReceiptAccountId === account.id ? styles.filterChipTextActive : undefined]}>{account.name}</Text>
                      <Text style={styles.accountChoiceAmount}>{displayCurrency(account.balance, account.currencyCode)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <TextInput
                multiline
                value={ocrText}
                onChangeText={setOcrText}
                style={styles.ocrInput}
                placeholder={localizeLegacy(language, 'Texto OCR del recibo...', 'Receipt OCR text...')}
                placeholderTextColor={theme.placeholder}
                textAlignVertical="top"
              />

              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.secondaryButton, !canAnalyzeReceipt || isAnalyzingReceipt ? styles.primaryButtonDisabled : undefined]}
                onPress={() => void onAnalyzeReceipt()}
                disabled={!canAnalyzeReceipt || isAnalyzingReceipt}
              >
                <Text style={styles.secondaryButtonText}>
                  {isAnalyzingReceipt ? (localizeLegacy(language, 'Analizando...', 'Analyzing...')) : t.analyzeReceipt}
                </Text>
              </TouchableOpacity>

              {receiptAnalysis ? (
                <View style={styles.analysisWrap}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t.totalProducts}</Text>
                    <Text style={styles.summaryValue}>{receiptAnalysis.items.length}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t.purchasedUnits}</Text>
                    <Text style={styles.summaryValue}>{receiptAnalysis.totalUnits}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t.totalMoney}</Text>
                    <Text style={styles.summaryValue}>{displayCurrency(receiptAnalysis.totalAmount)}</Text>
                  </View>
                  {receiptAnalysis.warnings.length > 0 ? (
                    <View style={styles.receiptWarningsBox}>
                      {receiptAnalysis.warnings.map((warning, index) => (
                        <Text key={`receipt-warning-${index}`} style={styles.receiptWarningText}>{getReceiptWarningLabel(warning, language)}</Text>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.filterLabel}>{localizeLegacy(language, 'Total a guardar', 'Total to save')}</Text>
                  <TextInput
                    value={receiptTotalInput}
                    onChangeText={(value) => setReceiptTotalInput(formatEditableAmount(value))}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholder={localizeLegacy(language, 'Edita el total si hace falta', 'Edit total if needed')}
                    placeholderTextColor={theme.placeholder}
                  />
                  {receiptValidationMessage ? <Text style={styles.inlineValidationError}>{receiptValidationMessage}</Text> : null}
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={[styles.primaryButton, !canSaveDetectedProducts ? styles.primaryButtonDisabled : undefined]}
                    onPress={onSaveDetectedProducts}
                    disabled={!canSaveDetectedProducts}
                  >
                    <Text style={styles.primaryButtonText}>{t.saveDetectedProducts}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}
          {activeSection === 'transacciones' ? (
            <>
              {transactionsCard}
            </>
          ) : null}

          {activeSection === 'cuentas' ? (
            <>
              <View style={styles.card}>
                <View style={styles.accountsHeaderRow}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={styles.addCircleButton}
                    onPress={() => {
                      setIsNewAccountColorTableVisible(false);
                      setIsNewAccountModalVisible(true);
                    }}
                  >
                    <Text style={styles.addCircleButtonText}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.sectionTitle}>{t.navCuentas}</Text>
                </View>
                <Text style={styles.helpText}>
                  {localizeLegacy(language, 'Toca para agregar o restar ingresos', 'Tap to add or subtract income')}
                </Text>
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  style={styles.secondaryButton}
                  onPress={() => {
                    setInternalTransferFromId(null);
                    setInternalTransferToId(null);
                    setInternalTransferAmount('');
                    setIsInternalTransferModalVisible(true);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>
                    {localizeLegacy(language, 'Transferencia entre cuentas', 'Transfer between accounts')}
                  </Text>
                </TouchableOpacity>

                {loading ? (
                  <Text style={styles.loading}>{localizeLegacy(language, 'Cargando cuentas...', 'Loading accounts...')}</Text>
                ) : accounts.length === 0 ? (
                  <Text style={styles.empty}>{localizeLegacy(language, 'Aún no hay cuentas creadas.', 'No accounts created yet.')}</Text>
                ) : (
                  <View style={styles.accountGrid}>
                    {accounts.map((account) => (
                      <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                        key={account.id}
                        style={[styles.accountCard, { backgroundColor: account.color, shadowColor: account.color }]}
                        onPress={() => onPressAccount(account)}
                      >
                        <View style={styles.accountCardTopRow}>
                          <Text style={styles.accountName}>{account.name}</Text>
                          <View style={styles.accountBadge}>
                            <Text style={styles.accountBadgeText}>{account.currencyCode || DEFAULT_CURRENCY_CODE}</Text>
                          </View>
                        </View>
                        <Text style={styles.accountBalance}>
                          {displayCurrency(account.balance, account.currencyCode)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : null}

          {activeSection === 'presupuesto' ? (
            <>
              {false ? (
              <View style={styles.card}>
                <View style={styles.accountsHeaderRow}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={styles.addCircleButton}
                    onPress={() => {
                      if (availableBudgetCategories.length > 0) {
                        setBudgetCategory(availableBudgetCategories[0]);
                      }
                      setIsBudgetModalVisible(true);
                    }}
                  >
                    <Text style={styles.addCircleButtonText}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.sectionTitle}>{t.budgetByCategory}</Text>
                </View>

                {budgets.length === 0 ? (
                  <Text style={styles.empty}>{t.noBudgets}</Text>
                ) : (
                  budgets.map((budget) => {
                    const spent = currentMonthSpentByCategory.get(budget.category) ?? 0;
                    const remaining = Number((budget.amount - spent).toFixed(2));
                    const warningLevel = getBudgetWarningLevel(budget.amount, spent);
                    const warningText =
                      warningLevel === 'over'
                        ? localizeLegacy(language, 'Presupuesto excedido', 'Budget exceeded')
                        : warningLevel
                          ? translate(
                              language,
                              `Alerta: ${warningLevel}% restante`,
                              `Alert: ${warningLevel}% remaining`,
                              `Avviso: ${warningLevel}% rimanente`,
                              `\u30a2\u30e9\u30fc\u30c8: \u6b8b\u308a${warningLevel}%`
                            )
                          : null;
                    return (
                      <View key={`budget-${budget.category}`} style={[styles.itemRow, styles.budgetItemRow]}>
                        <View style={styles.itemTextWrap}>
                          <View style={styles.budgetCategoryRow}>
                            <View
                              style={[
                                styles.budgetCategoryDot,
                                {
                                  backgroundColor:
                                    categoryColorMap[budget.category] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY],
                                },
                              ]}
                            />
                            <Text style={styles.itemDesc}>{getCategoryLabel(budget.category, language)}</Text>
                          </View>
                          <View style={styles.budgetProgressTrack}>
                            <View
                              style={[
                                styles.budgetProgressFill,
                                {
                                  width: `${Math.min(100, Math.max(0, (spent / Math.max(1, budget.amount)) * 100))}%`,
                                  backgroundColor:
                                    remaining <= 0
                                      ? theme.dangerBorder
                                      : categoryColorMap[budget.category] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY],
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.itemDate}>
                            {t.maxBudget}: {displayCurrency(budget.amount)}
                          </Text>
                          <Text style={styles.itemDate}>
                            {t.monthlySpent}: {displayCurrency(spent)}
                          </Text>
                          <Text style={[styles.itemDate, remaining <= 0 ? styles.negativeBudget : undefined]}>
                            {t.remainingBudget}: {displayCurrency(remaining)}
                          </Text>
                          {warningText ? (
                            <Text style={styles.budgetWarningText}>{warningText}</Text>
                          ) : null}
                        </View>
                        <View style={[styles.productActionWrap, styles.budgetActionsWrap]}>
                          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                            style={styles.deleteTableButton}
                            onPress={() => onDeleteBudget(budget.category)}
                          >
                            <Text style={styles.deleteTableButtonText}>{t.deleteBudget}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                            style={styles.adjustBudgetInlineButton}
                            onPress={() => {
                              setSelectedBudgetCategoryForAdjust(budget.category);
                              setBudgetDeltaInput('');
                              setIsBudgetAdjustModalVisible(true);
                            }}
                          >
                            <Text style={styles.secondaryButtonText}>{t.adjustBudget}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
              ) : null}

              {false ? (
              <View style={styles.card}>
                <View style={styles.accountsHeaderRow}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={styles.addCircleButton}
                    onPress={() => {
                      if (categories.length > 0) {
                        setPayableCategory(categories[0]);
                      }
                      setIsPayableModalVisible(true);
                    }}
                  >
                    <Text style={styles.addCircleButtonText}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Por pagar', 'Payables')}</Text>
                </View>
                {payables.length === 0 ? (
                  <Text style={styles.empty}>
                    {localizeLegacy(language, 'No hay gastos fijos configurados.', 'No fixed expenses configured.')}
                  </Text>
                ) : (
                  payables.map((payable) => (
                    <View key={`payable-${payable.id}`} style={styles.itemRow}>
                      <View style={styles.itemTextWrap}>
                        <View style={styles.budgetCategoryRow}>
                          <View
                            style={[
                              styles.payableStatusDot,
                              payable.isPaid ? styles.payableStatusPaid : styles.payableStatusPending,
                            ]}
                          />
                          <Text style={styles.itemDesc}>{payable.name}</Text>
                        </View>
                        <Text style={styles.itemDate}>
                          {t.category}: {getCategoryLabel(payable.category, language)}
                        </Text>
                        <Text style={styles.itemDate}>
                          {localizeLegacy(language, 'Día de pago', 'Due day')}: {payable.dueDay}
                        </Text>
                        <Text style={styles.itemDate}>
                          {payable.isPaid
                            ? translate(
                                language,
                                `Pagado${payable.paidAccountName ? ` · ${payable.paidAccountName}` : ''}`,
                                `Paid${payable.paidAccountName ? ` · ${payable.paidAccountName}` : ''}`,
                                `Pagato${payable.paidAccountName ? ` · ${payable.paidAccountName}` : ''}`,
                                `\u652f\u6255\u3044\u6e08\u307f${payable.paidAccountName ? ` · ${payable.paidAccountName}` : ''}`
                              )
                            : localizeLegacy(language, 'Pendiente', 'Pending')}
                        </Text>
                      </View>
                      <View style={[styles.productActionWrap, styles.budgetActionsWrap]}>
                        <Text style={styles.itemAmount}>{displayCurrency(payable.amount, payable.currencyCode)}</Text>
                        {!payable.isPaid ? (
                          <TouchableOpacity
                            activeOpacity={BUTTON_ACTIVE_OPACITY}
                            style={styles.adjustBudgetInlineButton}
                            onPress={() => {
                              setSelectedPayableForPayment(payable);
                              if (accounts.length > 0) {
                                setPayablePaymentAccountId(accounts[0].id);
                              }
                            }}
                          >
                            <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Pagar', 'Pay')}</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          activeOpacity={BUTTON_ACTIVE_OPACITY}
                          style={styles.deleteTableButton}
                          onPress={() => onDeletePayable(payable)}
                        >
                          <Text style={styles.deleteTableButtonText}>{localizeLegacy(language, 'Eliminar', 'Delete')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>
              ) : null}

              {renderCategoriesManager()}
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t.chartCategoryColors}</Text>
                <Text style={styles.filterLabel}>{t.category}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((category) => (
                    <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                      key={`color-category-${category}`}
                      style={[styles.filterChip, colorCategory === category ? styles.filterChipActive : undefined]}
                      onPress={() => setColorCategory(category)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          colorCategory === category ? styles.filterChipTextActive : undefined,
                        ]}
                      >
                        {getCategoryLabel(category, language)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                  style={styles.secondaryButton}
                  onPress={() => setIsCategoryColorTableVisible((prev) => !prev)}
                >
                  <Text style={styles.secondaryButtonText}>
                    {isCategoryColorTableVisible ? t.hideColors : t.changeColor}
                  </Text>
                </TouchableOpacity>
                {isCategoryColorTableVisible
                  ? renderColorTable(
                      categoryColorMap[colorCategory] ?? DEFAULT_CATEGORY_COLORS[FALLBACK_CATEGORY],
                      (color) => {
                        void onSaveCategoryColor(color);
                      },
                      'category-color'
                    )
                  : null}
              </View>
            </>
          ) : null}

          {activeSection === 'configuracion' ? (
            <>
              <View style={styles.configSectionCard}>
                <Text style={styles.configSectionTitle}>{getSectionLabel('general', language)}</Text>
                <Text style={styles.filterLabel}>{t.theme}</Text>
                <View style={styles.settingsOptionGrid}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={[styles.filterChip, themeMode === 'dark' ? styles.filterChipActive : undefined]}
                    onPress={() => void onChangeTheme('dark')}
                  >
                    <Text style={[styles.filterChipText, themeMode === 'dark' ? styles.filterChipTextActive : undefined]}>{t.darkMode}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={[styles.filterChip, themeMode === 'light' ? styles.filterChipActive : undefined]}
                    onPress={() => void onChangeTheme('light')}
                  >
                    <Text style={[styles.filterChipText, themeMode === 'light' ? styles.filterChipTextActive : undefined]}>{t.lightMode}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={[styles.filterChip, themeMode === 'original' ? styles.filterChipActive : undefined]}
                    onPress={() => void onChangeTheme('original')}
                  >
                    <Text style={[styles.filterChipText, themeMode === 'original' ? styles.filterChipTextActive : undefined]}>{t.originalMode}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.filterLabel}>
                  {translate(language, 'Tipo de gráfica', 'Chart type', 'Tipo di grafico', '\u30b0\u30e9\u30d5\u306e\u7a2e\u985e')}
                </Text>
                <View style={styles.settingsOptionGrid}>
                  {(['pie', 'circle', 'line', 'bar'] as AppChartType[]).map((option) => (
                    <TouchableOpacity
                      activeOpacity={BUTTON_ACTIVE_OPACITY}
                      key={`chart-type-${option}`}
                      style={[styles.filterChip, chartType === option ? styles.filterChipActive : undefined]}
                      onPress={() => void onChangeChartType(option)}
                    >
                      <Text style={[styles.filterChipText, chartType === option ? styles.filterChipTextActive : undefined]}>
                        {getChartTypeLabel(option, language)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.filterLabel}>{t.language}</Text>
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  style={styles.dropdownButton}
                  onPress={() => {
                    setIsLanguageDropdownOpen((prev) => !prev);
                    setIsNumberFormatDropdownOpen(false);
                    setIsCurrencyDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownButtonText}>
                    {getSelectLabel('language', language)} · {getLanguageLabel(language)}
                  </Text>
                  <Text style={styles.dropdownChevron}>{isLanguageDropdownOpen ? '⌃' : '⌄'}</Text>
                </TouchableOpacity>
                {isLanguageDropdownOpen ? (
                  <View style={styles.dropdownMenu}>
                    {(['es', 'en', 'it', 'ja'] as AppLanguage[]).map((option) => (
                      <TouchableOpacity
                        activeOpacity={BUTTON_ACTIVE_OPACITY}
                        key={`language-option-${option}`}
                        style={[styles.dropdownOption, language === option ? styles.dropdownOptionActive : undefined]}
                        onPress={() => onChangeLanguage(option)}
                      >
                        <Text style={[styles.dropdownOptionText, language === option ? styles.dropdownOptionTextActive : undefined]}>
                          {getLanguageLabel(option)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.filterLabel}>{t.numberFormat}</Text>
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  style={styles.dropdownButton}
                  onPress={() => {
                    setIsNumberFormatDropdownOpen((prev) => !prev);
                    setIsLanguageDropdownOpen(false);
                    setIsCurrencyDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownButtonText}>
                    {getSelectLabel('numberFormat', language)} · {getNumberFormatLabel(numberFormat, t)}
                  </Text>
                  <Text style={styles.dropdownChevron}>{isNumberFormatDropdownOpen ? '⌃' : '⌄'}</Text>
                </TouchableOpacity>
                {isNumberFormatDropdownOpen ? (
                  <View style={styles.dropdownMenu}>
                    {([
                      ['none', t.numberFormatNone],
                      ['comma', t.numberFormatComma],
                      ['dot_comma', t.numberFormatDotComma],
                      ['space_dot', t.numberFormatSpaceDot],
                      ['space_comma', t.numberFormatSpaceComma],
                    ] as Array<[AppNumberFormat, string]>).map(([formatKey, label]) => (
                      <TouchableOpacity
                        activeOpacity={BUTTON_ACTIVE_OPACITY}
                        key={`format-${formatKey}`}
                        style={[styles.dropdownOption, numberFormat === formatKey ? styles.dropdownOptionActive : undefined]}
                        onPress={() => void onChangeNumberFormat(formatKey)}
                      >
                        <Text style={[styles.dropdownOptionText, numberFormat === formatKey ? styles.dropdownOptionTextActive : undefined]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.filterLabel}>
                  {translate(language, 'Moneda predeterminada', 'Default currency', 'Valuta predefinita', '\u65e2\u5b9a\u306e\u901a\u8ca8')}
                </Text>
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  style={styles.dropdownButton}
                  onPress={() => {
                    setIsCurrencyDropdownOpen((prev) => !prev);
                    setIsLanguageDropdownOpen(false);
                    setIsNumberFormatDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownButtonText}>
                    {getSelectLabel('currency', language)} · {defaultCurrencyCode} · {getCurrencyLabel(defaultCurrencyCode, language)}
                  </Text>
                  <Text style={styles.dropdownChevron}>{isCurrencyDropdownOpen ? '⌃' : '⌄'}</Text>
                </TouchableOpacity>
                {isCurrencyDropdownOpen ? (
                  <ScrollView style={styles.dropdownMenu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {CURRENCY_OPTIONS.map((currency) => (
                      <TouchableOpacity
                        activeOpacity={BUTTON_ACTIVE_OPACITY}
                        key={`default-currency-${currency.code}`}
                        style={[styles.dropdownOption, defaultCurrencyCode === currency.code ? styles.dropdownOptionActive : undefined]}
                        onPress={() => void onChangeDefaultCurrency(currency.code)}
                      >
                        <Text style={[styles.dropdownOptionText, defaultCurrencyCode === currency.code ? styles.dropdownOptionTextActive : undefined]}>
                          {currency.code} · {getCurrencyLabel(currency.code, language)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
                <Text style={styles.helpText}>
                  {translate(
                    language,
                    'Se usa al crear cuentas nuevas. Cada cuenta puede conservar una moneda diferente.',
                    'Used when creating new accounts. Each account can keep a different currency.',
                    'Viene usata per i nuovi conti. Ogni conto pu\u00f2 mantenere una valuta diversa.',
                    '\u65b0\u3057\u3044\u53e3\u5ea7\u306e\u4f5c\u6210\u6642\u306b\u4f7f\u7528\u3055\u308c\u307e\u3059\u3002\u53e3\u5ea7\u3054\u3068\u306b\u7570\u306a\u308b\u901a\u8ca8\u3092\u8a2d\u5b9a\u3067\u304d\u307e\u3059\u3002'
                  )}
                </Text>
              </View>

              {false ? (
              <View style={styles.configSectionCard}>
                <Text style={styles.configSectionTitle}>
                  {getSectionLabel('categories', language)}
                </Text>
                <Text style={styles.helpText}>
                  {translate(language, 'Crea las categorías que quieres usar para gastos, recibos y presupuestos.', 'Create the categories you want to use for expenses, receipts and budgets.', 'Crea le categorie da usare per spese, ricevute e budget.', '\u652f\u51fa\u3001\u30ec\u30b7\u30fc\u30c8\u3001\u4e88\u7b97\u306b\u4f7f\u7528\u3059\u308b\u30ab\u30c6\u30b4\u30ea\u3092\u4f5c\u6210\u3057\u307e\u3059\u3002')}
                </Text>
                <TextInput
                  placeholder={t.newCategory}
                  value={newCategoryName}
                  onChangeText={setNewCategoryName}
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={onAddCategory}>
                  <Text style={styles.secondaryButtonText}>{t.addCategory}</Text>
                </TouchableOpacity>
                {categories.length === 0 ? (
                  <Text style={styles.empty}>
                    {translate(language, 'Todavía no hay categorías. Crea una para empezar.', 'No categories yet. Create one to get started.', 'Non ci sono ancora categorie. Creane una per iniziare.', '\u30ab\u30c6\u30b4\u30ea\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002\u6700\u521d\u306e\u30ab\u30c6\u30b4\u30ea\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002')}
                  </Text>
                ) : (
                  <View style={styles.categoryManagerList}>
                    {categories.map((category) => (
                      <View key={`settings-category-${category}`} style={styles.categoryManagerRow}>
                        <TouchableOpacity
                          activeOpacity={BUTTON_ACTIVE_OPACITY}
                          style={[styles.filterChip, manualCategory === category ? styles.filterChipActive : undefined]}
                          onPress={() => setManualCategory(category)}
                        >
                          <Text style={[styles.filterChipText, manualCategory === category ? styles.filterChipTextActive : undefined]}>
                            {getCategoryLabel(category, language)}
                          </Text>
                        </TouchableOpacity>
                        {category !== FALLBACK_CATEGORY ? (
                          <TouchableOpacity
                            activeOpacity={BUTTON_ACTIVE_OPACITY}
                            style={styles.deleteCategorySmallButton}
                            onPress={() => onDeleteCategoryFromSettings(category)}
                          >
                            <Text style={styles.deleteCategoryButtonText}>{t.delete}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
              ) : null}

              <View style={styles.configSectionCard}>
                <Text style={styles.configSectionTitle}>{getSectionLabel('security', language)}</Text>
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={() => void onToggleHideAmounts()}>
                  <Text style={styles.secondaryButtonText}>
                    {hideAmounts
                      ? translate(language, 'Mostrar montos', 'Show amounts', 'Mostra importi', '\u91d1\u984d\u3092\u8868\u793a')
                      : translate(language, 'Ocultar montos', 'Hide amounts', 'Nascondi importi', '\u91d1\u984d\u3092\u96a0\u3059')}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.filterLabel}>{localizeLegacy(language, 'PIN', 'PIN')}</Text>
                <TextInput
                  value={pinInput}
                  onChangeText={setPinInput}
                  placeholder={translate(language, 'PIN (4-8 dígitos)', 'PIN (4-8 digits)', 'PIN (4-8 cifre)', 'PIN\uff084\uff5e8\u6841\uff09')}
                  keyboardType="number-pad"
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                  secureTextEntry
                />
                <View style={styles.modalOptionRow}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButtonCompact} onPress={() => void onSavePin()}>
                    <Text style={styles.secondaryButtonText}>{translate(language, 'Guardar PIN', 'Save PIN', 'Salva PIN', 'PIN\u3092\u4fdd\u5b58')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButtonCompact} onPress={() => void onToggleAppLock()}>
                    <Text style={styles.secondaryButtonText}>
                      {appLockEnabled
                        ? translate(language, 'Desactivar bloqueo', 'Disable lock', 'Disattiva blocco', '\u30ed\u30c3\u30af\u3092\u7121\u52b9\u5316')
                        : translate(language, 'Activar bloqueo', 'Enable lock', 'Attiva blocco', '\u30ed\u30c3\u30af\u3092\u6709\u52b9\u5316')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.configSectionCard}>
                <Text style={styles.configSectionTitle}>{getSectionLabel('data', language)}</Text>
                <View style={styles.settingsActionGrid}>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={[styles.secondaryButtonCompact, styles.dataActionButton]} onPress={() => void onExportTransactionsCsv()}>
                    <Text style={[styles.secondaryButtonText, styles.dataActionButtonText]}>
                      {isExportingCsv
                        ? localizeLegacy(language, 'Cancelar CSV', 'Cancel CSV')
                        : localizeLegacy(language, 'Exportar CSV', 'Export CSV')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={[styles.secondaryButtonCompact, styles.dataActionButton]} onPress={() => void onExportBackup()}>
                    <Text style={[styles.secondaryButtonText, styles.dataActionButtonText]}>
                      {isExportingBackup
                        ? localizeLegacy(language, 'Cancelar backup', 'Cancel backup')
                        : localizeLegacy(language, 'Exportar backup', 'Export backup')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    style={[styles.secondaryButtonCompact, styles.dataActionButton]}
                    onPress={() => setIsRestoreBackupModalVisible(true)}
                  >
                    <Text style={[styles.secondaryButtonText, styles.dataActionButtonText]}>{localizeLegacy(language, 'Restaurar backup', 'Restore backup')}</Text>
                  </TouchableOpacity>
                </View>
                {csvExportProgressLabel ? <Text style={styles.helpText}>{csvExportProgressLabel}</Text> : null}
                {backupExportProgressLabel ? <Text style={styles.helpText}>{backupExportProgressLabel}</Text> : null}
                <Text style={styles.helpText}>
                  {translate(
                    language,
                    'Mantén los backups en un lugar privado: incluyen tus datos financieros, pero nunca tu PIN.',
                    'Keep backups private: they include your financial data, but never your PIN.',
                    'Conserva i backup in un luogo privato: includono i tuoi dati finanziari, ma mai il tuo PIN.',
                    'バックアップには金融データが含まれますが、PINは含まれません。安全な場所に保管してください。'
                  )}
                </Text>
              </View>

              <View style={styles.configSectionCard}>
                <Text style={styles.configSectionTitle}>{getSectionLabel('support', language)}</Text>
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={onContactPress}>
                  <Text style={styles.secondaryButtonText}>{t.contact}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={() => void onOpenPrivacyPolicy()}>
                  <Text style={styles.secondaryButtonText}>
                    {translate(language, 'Política de privacidad', 'Privacy policy', 'Informativa sulla privacy', 'プライバシーポリシー')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.helpText}>{t.buildNumber}</Text>
                <View style={styles.developerSeal}>
                  <View pointerEvents="none" style={styles.developerSealGlow} />
                  <Text style={styles.developerSealOverline}>
                    {translate(language, 'DESARROLLADO POR', 'DEVELOPED BY', 'SVILUPPATO DA', '\u958b\u767a\u8005')}
                  </Text>
                  <Text style={styles.developerSealName}>CodeZero Interactive</Text>
                  <Text style={styles.developerSealRights}>
                    {translate(
                      language,
                      '© 2026 CodeZero Interactive. Todos los derechos reservados.',
                      '© 2026 CodeZero Interactive. All rights reserved.',
                      '© 2026 CodeZero Interactive. Tutti i diritti riservati.',
                      '© 2026 CodeZero Interactive. 無断転載を禁じます。',
                    )}
                  </Text>
                </View>
                <Text style={styles.helpText}>
                  {translate(language, 'MyFinance guarda tus datos localmente en este dispositivo.', 'MyFinance stores your data locally on this device.', 'MyFinance conserva i dati localmente su questo dispositivo.', 'MyFinance\u306f\u3053\u306e\u7aef\u672b\u306b\u30c7\u30fc\u30bf\u3092\u30ed\u30fc\u30ab\u30eb\u4fdd\u5b58\u3057\u307e\u3059\u3002')}
                </Text>
              </View>
            </>
          ) : null}
          </ScrollView>
        </View>

        {isDrawerOpen ? (
          <Animated.View style={[styles.drawerOverlay, { opacity: drawerBackdropOpacity }]}>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.drawerBackdropTouch} onPress={closeDrawer} />
            <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: drawerTranslateX }] }]}>
              <Text style={styles.drawerTitle}>MyFinance</Text>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'inicio' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('inicio')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'inicio' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.inicio}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'inicio' ? styles.drawerItemTextActive : undefined]}>
                    {t.navInicio}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'transacciones' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('transacciones')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'transacciones' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.transacciones}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'transacciones' ? styles.drawerItemTextActive : undefined]}>
                    {t.navTransacciones}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'gastos' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('gastos')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'gastos' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.gastos}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'gastos' ? styles.drawerItemTextActive : undefined]}>
                    {localizeLegacy(language, 'Recibos', 'Receipts')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'graficoAnual' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('graficoAnual')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'graficoAnual' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.graficoAnual}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'graficoAnual' ? styles.drawerItemTextActive : undefined]}>
                    {translate(language, 'Gráfico Anual', 'Annual Chart', 'Grafico annuale', '年間グラフ')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'cuentas' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('cuentas')}
              >
                <View style={styles.drawerItemRow}>
                  <Text
                    style={[
                      styles.drawerItemIcon,
                      styles.drawerAccountsIcon,
                      activeSection === 'cuentas' ? styles.drawerItemTextActive : undefined,
                    ]}
                  >
                    {SECTION_SYMBOLS.cuentas}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'cuentas' ? styles.drawerItemTextActive : undefined]}>
                    {t.navCuentas}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'presupuesto' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('presupuesto')}
              >
                <View style={styles.drawerItemRow}>
                  <Text
                    style={[
                      styles.drawerItemIcon,
                      styles.drawerBudgetIcon,
                      activeSection === 'presupuesto' ? styles.drawerItemTextActive : undefined,
                    ]}
                  >
                    {SECTION_SYMBOLS.presupuesto}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'presupuesto' ? styles.drawerItemTextActive : undefined]}>
                    {translate(language, 'Categorías', 'Categories', 'Categorie', 'カテゴリ')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[styles.drawerItem, activeSection === 'configuracion' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('configuracion')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'configuracion' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.configuracion}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'configuracion' ? styles.drawerItemTextActive : undefined]}>
                    {t.navConfig}
                  </Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        ) : null}

        {activeSection === 'inicio' ? (
        <View pointerEvents="box-none" style={[styles.quickFabLayer, { paddingBottom: uiSpacing.lg + insets.bottom }]}>
          {isQuickMenuOpen ? (
            <>
              <View style={styles.quickMenuBackdrop} />
              <View pointerEvents="none" style={[styles.quickRadialMenu, { bottom: 94 + insets.bottom }]}>
                <Animated.View
                  style={[
                    styles.quickRadialButton,
                    styles.quickRadialIncome,
                    highlightedQuickOption === 'income' ? styles.quickRadialButtonActive : undefined,
                    {
                      opacity: quickMenuProgress,
                      transform: [
                        { translateX: -62 },
                        {
                          translateY: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [84, 0],
                          }),
                        },
                        {
                          scale: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.82, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickRadialText,
                      highlightedQuickOption === 'income' ? styles.quickRadialTextActive : undefined,
                    ]}
                  >
                    {`+ ${translate(language, 'Ingreso', 'Income', 'Entrata', '\u53ce\u5165')}`}
                  </Text>
                </Animated.View>
                <Animated.View
                  style={[
                    styles.quickRadialButton,
                    styles.quickRadialExpense,
                    highlightedQuickOption === 'expense' ? styles.quickRadialButtonActive : undefined,
                    {
                      opacity: quickMenuProgress,
                      transform: [
                        {
                          translateX: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-58, -162],
                          }),
                        },
                        {
                          translateY: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [12, 0],
                          }),
                        },
                        {
                          scale: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.82, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickRadialText,
                      highlightedQuickOption === 'expense' ? styles.quickRadialTextActive : undefined,
                    ]}
                  >
                    {`- ${translate(language, 'Gasto', 'Expense', 'Spesa', '\u652f\u51fa')}`}
                  </Text>
                </Animated.View>
                <Animated.View
                  style={[
                    styles.quickRadialButton,
                    styles.quickRadialTransfer,
                    highlightedQuickOption === 'transfer' ? styles.quickRadialButtonActive : undefined,
                    {
                      opacity: quickMenuProgress,
                      transform: [
                        {
                          translateX: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-86, 18],
                          }),
                        },
                        {
                          translateY: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [12, 0],
                          }),
                        },
                        {
                          scale: quickMenuProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.82, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickRadialText,
                      highlightedQuickOption === 'transfer' ? styles.quickRadialTextActive : undefined,
                    ]}
                  >
                    {`<-> ${translate(language, 'Transferencia', 'Transfer', 'Trasferimento', '送金')}`}
                  </Text>
                </Animated.View>
                <View
                  style={[
                    styles.quickDirectionGlow,
                    highlightedQuickOption ? styles.quickDragArrowVisible : undefined,
                    {
                      transform: [
                        {
                          rotate:
                            highlightedQuickOption === 'expense'
                              ? '-135deg'
                              : highlightedQuickOption === 'transfer'
                                ? '-45deg'
                                : '-90deg',
                        },
                      ],
                    },
                  ]}
                />
              </View>
            </>
          ) : null}
          <View style={styles.quickFabAnchor} {...quickFabPanResponder.panHandlers}>
            {isQuickMenuOpen ? <View pointerEvents="none" style={styles.quickFabGlow} /> : null}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.quickFabProgressRing,
                {
                  opacity: quickPressProgress.interpolate({
                    inputRange: [0, 0.15, 1],
                    outputRange: [0, 0.9, 0.25],
                  }),
                  transform: [
                    {
                      scale: quickPressProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1.32],
                      }),
                    },
                  ],
                },
              ]}
            />
            <View style={[styles.quickFabButton, isQuickMenuOpen ? styles.quickFabButtonActive : undefined]}>
              <Text style={styles.quickFabText}>+</Text>
            </View>
          </View>
        </View>
        ) : null}

      <Modal visible={quickActionMode === 'expense'} transparent animationType="fade" onRequestClose={requestCloseAnyOpenMenu}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{translate(language, 'Agregar gasto', 'Add expense', 'Aggiungi spesa', '支出を追加')}</Text>
            <Text style={styles.filterLabel}>{t.account}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {accounts.map((account) => (
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`quick-expense-account-${account.id}`}
                  style={[styles.accountChoiceChip, quickExpenseAccountId === account.id ? styles.filterChipActive : undefined, { borderColor: account.color }]}
                  onPress={() => setQuickExpenseAccountId(account.id)}
                >
                  <Text style={[styles.filterChipText, quickExpenseAccountId === account.id ? styles.filterChipTextActive : undefined]}>{account.name}</Text>
                  <Text style={styles.accountChoiceAmount}>{displayCurrency(account.balance, account.currencyCode)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.filterLabel}>{t.category}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {categories.map((category) => (
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`quick-expense-category-${category}`}
                  style={[styles.filterChip, quickExpenseCategory === category ? styles.filterChipActive : undefined]}
                  onPress={() => setQuickExpenseCategory(category)}
                >
                  <Text style={[styles.filterChipText, quickExpenseCategory === category ? styles.filterChipTextActive : undefined]}>
                    {getCategoryLabel(category, language)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              value={quickExpenseAmount}
              onChangeText={(value) => setQuickExpenseAmount(formatEditableAmount(value, accounts.find((account) => account.id === quickExpenseAccountId)?.currencyCode))}
              placeholder={t.amount}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TextInput
              value={quickExpenseNote}
              onChangeText={setQuickExpenseNote}
              placeholder={translate(language, 'Nota', 'Note', 'Nota', 'メモ')}
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TextInput
              value={quickExpenseDate}
              onChangeText={setQuickExpenseDate}
              placeholder="YYYY-MM-DD"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            {quickExpenseValidationMessage ? <Text style={styles.inlineValidationError}>{quickExpenseValidationMessage}</Text> : null}
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={[styles.primaryButton, quickExpenseValidationMessage ? styles.primaryButtonDisabled : undefined]}
              onPress={() => void onSaveQuickExpense()}
              disabled={Boolean(quickExpenseValidationMessage)}
            >
              <Text style={styles.primaryButtonText}>{t.saveExpense}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{translate(language, 'Cerrar', 'Close', 'Chiudi', '閉じる')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={quickActionMode === 'income'} transparent animationType="fade" onRequestClose={requestCloseAnyOpenMenu}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{translate(language, 'Agregar ingreso', 'Add income', 'Aggiungi entrata', '収入を追加')}</Text>
            <Text style={styles.filterLabel}>{translate(language, 'Cuenta destino', 'Destination account', 'Conto di destinazione', '入金先口座')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {accounts.map((account) => (
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`quick-income-account-${account.id}`}
                  style={[styles.accountChoiceChip, quickIncomeAccountId === account.id ? styles.filterChipActive : undefined, { borderColor: account.color }]}
                  onPress={() => setQuickIncomeAccountId(account.id)}
                >
                  <Text style={[styles.filterChipText, quickIncomeAccountId === account.id ? styles.filterChipTextActive : undefined]}>{account.name}</Text>
                  <Text style={styles.accountChoiceAmount}>{displayCurrency(account.balance, account.currencyCode)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              value={quickIncomeAmount}
              onChangeText={(value) => setQuickIncomeAmount(formatEditableAmount(value, accounts.find((account) => account.id === quickIncomeAccountId)?.currencyCode))}
              placeholder={t.amount}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.filterLabel}>{t.category}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {categories.map((category) => (
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`quick-income-category-${category}`}
                  style={[styles.filterChip, quickIncomeCategory === category ? styles.filterChipActive : undefined]}
                  onPress={() => setQuickIncomeCategory(category)}
                >
                  <Text style={[styles.filterChipText, quickIncomeCategory === category ? styles.filterChipTextActive : undefined]}>
                    {getCategoryLabel(category, language)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {quickIncomeValidationMessage ? <Text style={styles.inlineValidationError}>{quickIncomeValidationMessage}</Text> : null}
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={[styles.primaryButton, quickIncomeValidationMessage ? styles.primaryButtonDisabled : undefined]}
              onPress={() => void onSaveQuickIncome()}
              disabled={Boolean(quickIncomeValidationMessage)}
            >
              <Text style={styles.primaryButtonText}>{translate(language, 'Guardar ingreso', 'Save income', 'Salva entrata', '収入を保存')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{translate(language, 'Cerrar', 'Close', 'Chiudi', '閉じる')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isAccountActionModalVisible} transparent animationType="fade" onRequestClose={requestCloseAnyOpenMenu}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <ScrollView style={styles.modalCardScrollable} contentContainerStyle={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t.accountActions}</Text>
            <Text style={styles.helpText}>{selectedAccountForAction ? selectedAccountForAction.name : ''}</Text>

            <View style={styles.modalOptionRow}>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[
                  styles.secondaryButtonCompact,
                  accountActionType === 'add' ? styles.filterChipActive : undefined,
                ]}
                onPress={() => {
                  setAccountActionType('add');
                  setAccountActionAmount('');
                }}
              >
                <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Agregar ingresos', 'Add income')}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={[
                  styles.deleteCategoryButton,
                  accountActionType === 'subtract' ? styles.filterChipActive : undefined,
                ]}
                onPress={() => {
                  setAccountActionType('subtract');
                  setAccountActionAmount('');
                }}
              >
                <Text style={styles.deleteCategoryButtonText}>{localizeLegacy(language, 'Restar ingresos', 'Subtract income')}</Text>
              </TouchableOpacity>
            </View>

            {accountActionType ? (
              <>
                <TextInput
                  placeholder={
                    accountActionType === 'add'
                      ? localizeLegacy(language, 'Cuanto sumar', 'How much to add')
                      : localizeLegacy(language, 'Cuanto restar', 'How much to subtract')
                  }
                  value={accountActionAmount}
                  onChangeText={(value) => setAccountActionAmount(formatEditableAmount(value, selectedAccountForAction?.currencyCode))}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.primaryButton} onPress={onConfirmAccountAction}>
                  <Text style={styles.primaryButtonText}>
                    {accountActionType === 'add'
                      ? localizeLegacy(language, 'Confirmar suma', 'Confirm add')
                      : localizeLegacy(language, 'Confirmar resta', 'Confirm subtract')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            <Text style={styles.filterLabel}>{localizeLegacy(language, 'Color', 'Color')}</Text>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.colorEditCircleButton}
              onPress={() => setIsAccountEditColorTableVisible((prev) => !prev)}
            >
              <Text style={styles.colorEditCircleIcon}>{'\u270E'}</Text>
            </TouchableOpacity>
            {isAccountEditColorTableVisible
              ? renderColorTable(
                  selectedAccountForAction?.color ?? null,
                  (color) => {
                    void onUpdateSelectedAccountColor(color);
                  },
                  'edit-account-color'
                )
              : null}
            <Text style={styles.filterLabel}>
              {translate(language, 'Moneda', 'Currency', 'Valuta', '\u901a\u8ca8')}
            </Text>
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.dropdownButton}
              onPress={() => setIsAccountActionCurrencyDropdownOpen((previous) => !previous)}
            >
              <Text style={styles.dropdownButtonText}>
                {(selectedAccountForAction?.currencyCode ?? DEFAULT_CURRENCY_CODE)} · {getCurrencyLabel(selectedAccountForAction?.currencyCode ?? DEFAULT_CURRENCY_CODE, language)}
              </Text>
              <Text style={styles.dropdownChevron}>{isAccountActionCurrencyDropdownOpen ? '⌃' : '⌄'}</Text>
            </TouchableOpacity>
            {isAccountActionCurrencyDropdownOpen ? (
              <ScrollView style={styles.dropdownMenu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {CURRENCY_OPTIONS.map((currency) => (
                  <TouchableOpacity
                    activeOpacity={BUTTON_ACTIVE_OPACITY}
                    key={`edit-account-currency-${currency.code}`}
                    style={[styles.dropdownOption, (selectedAccountForAction?.currencyCode ?? DEFAULT_CURRENCY_CODE) === currency.code ? styles.dropdownOptionActive : undefined]}
                    onPress={() => void onUpdateSelectedAccountCurrency(currency.code)}
                  >
                    <Text style={[styles.dropdownOptionText, (selectedAccountForAction?.currencyCode ?? DEFAULT_CURRENCY_CODE) === currency.code ? styles.dropdownOptionTextActive : undefined]}>
                      {currency.code} · {getCurrencyLabel(currency.code, language)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.deleteActionButtonFull} onPress={onDeleteSelectedAccount}>
              <Text style={styles.deleteCategoryButtonText}>{t.deleteAccount}</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.secondaryButton}
              onPress={requestCloseAnyOpenMenu}
            >
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={isBudgetAdjustModalVisible}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t.adjustBudget}</Text>
            <Text style={styles.helpText}>
              {selectedBudgetCategoryForAdjust
                ? getCategoryLabel(selectedBudgetCategoryForAdjust, language)
                : ''}
            </Text>
            <TextInput
              placeholder={t.amount}
              value={budgetDeltaInput}
              onChangeText={(value) => setBudgetDeltaInput(formatEditableAmount(value, defaultCurrencyCode))}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <View style={styles.modalOptionRow}>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={styles.secondaryButtonCompact}
                onPress={() => {
                  if (!selectedBudgetCategoryForAdjust) {
                    return;
                  }
                  void onAdjustBudget(selectedBudgetCategoryForAdjust, 1);
                }}
              >
                <Text style={styles.secondaryButtonText}>{t.increase}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                style={styles.deleteCategoryButton}
                onPress={() => {
                  if (!selectedBudgetCategoryForAdjust) {
                    return;
                  }
                  void onAdjustBudget(selectedBudgetCategoryForAdjust, -1);
                }}
              >
                <Text style={styles.deleteCategoryButtonText}>{t.decrease}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.secondaryButton}
              onPress={requestCloseAnyOpenMenu}
            >
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isBudgetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t.budgetByCategory}</Text>
            <Text style={styles.filterLabel}>{t.category}</Text>
            {availableBudgetCategories.length === 0 ? (
              <Text style={styles.empty}>{t.noAvailableBudgetCategories}</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {availableBudgetCategories.map((category) => (
                  <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                    key={`budget-modal-category-${category}`}
                    style={[styles.filterChip, budgetCategory === category ? styles.filterChipActive : undefined]}
                    onPress={() => setBudgetCategory(category)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        budgetCategory === category ? styles.filterChipTextActive : undefined,
                      ]}
                    >
                      {getCategoryLabel(category, language)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TextInput
              placeholder={t.maxBudget}
              value={budgetAmountInput}
              onChangeText={(value) => setBudgetAmountInput(formatEditableAmount(value, defaultCurrencyCode))}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.helpText}>
              {translate(language, 'Moneda de este presupuesto', 'Currency for this budget', 'Valuta di questo budget', 'この予算の通貨')}: {defaultCurrencyCode}
            </Text>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={[styles.primaryButton, availableBudgetCategories.length === 0 ? styles.primaryButtonDisabled : undefined]}
              onPress={async () => {
                const saved = await onSaveBudget();
                if (saved) {
                  setIsBudgetModalVisible(false);
                }
              }}
              disabled={availableBudgetCategories.length === 0}
            >
              <Text style={styles.primaryButtonText}>{t.saveBudget}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isPayableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Nuevo por pagar', 'New payable')}</Text>
            <TextInput
              placeholder={localizeLegacy(language, 'Nombre del gasto fijo', 'Fixed expense name')}
              value={payableName}
              onChangeText={setPayableName}
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TextInput
              placeholder={t.amount}
              value={payableAmountInput}
              onChangeText={(value) => setPayableAmountInput(formatEditableAmount(value, defaultCurrencyCode))}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.helpText}>
              {translate(language, 'Moneda de este pago', 'Currency for this payable', 'Valuta di questo pagamento', 'この支払いの通貨')}: {defaultCurrencyCode}
            </Text>
            <TextInput
              placeholder={localizeLegacy(language, 'Día de pago (1-31)', 'Due day (1-31)')}
              value={payableDueDayInput}
              onChangeText={setPayableDueDayInput}
              keyboardType="number-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.filterLabel}>{t.category}</Text>
            {categories.length === 0 ? (
              <Text style={styles.empty}>
                {localizeLegacy(language, 'Crea una categoría desde Configuración primero.', 'Create a category from Settings first.')}
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {categories.map((category) => (
                  <TouchableOpacity
                    activeOpacity={BUTTON_ACTIVE_OPACITY}
                    key={`payable-category-${category}`}
                    style={[styles.filterChip, payableCategory === category ? styles.filterChipActive : undefined]}
                    onPress={() => setPayableCategory(category)}
                  >
                    <Text style={[styles.filterChipText, payableCategory === category ? styles.filterChipTextActive : undefined]}>
                      {getCategoryLabel(category, language)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={[styles.primaryButton, categories.length === 0 ? styles.primaryButtonDisabled : undefined]}
              onPress={() => void onSavePayable()}
              disabled={categories.length === 0}
            >
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Guardar por pagar', 'Save payable')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={selectedPayableForPayment != null}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Pagar gasto fijo', 'Pay fixed expense')}</Text>
            <Text style={styles.helpText}>
              {selectedPayableForPayment
                ? `${selectedPayableForPayment.name} · ${displayCurrency(selectedPayableForPayment.amount, selectedPayableForPayment.currencyCode)}`
                : ''}
            </Text>
            <Text style={styles.filterLabel}>{localizeLegacy(language, 'Cuenta de pago', 'Payment account')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {accounts.filter((account) => account.currencyCode === selectedPayableForPayment?.currencyCode).map((account) => (
                <TouchableOpacity
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`payable-payment-account-${account.id}`}
                  style={[styles.filterChip, payablePaymentAccountId === account.id ? styles.filterChipActive : undefined]}
                  onPress={() => setPayablePaymentAccountId(account.id)}
                >
                  <Text style={[styles.filterChipText, payablePaymentAccountId === account.id ? styles.filterChipTextActive : undefined]}>
                    {account.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.primaryButton} onPress={() => void onPayPayable()}>
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Confirmar pago', 'Confirm payment')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={() => setSelectedPayableForPayment(null)}>
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isNewAccountModalVisible} transparent animationType="fade" onRequestClose={requestCloseAnyOpenMenu}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Nueva cuenta', 'New account')}</Text>
            <TextInput
              placeholder={localizeLegacy(language, 'Nombre de la cuenta', 'Account name')}
              value={accountName}
              onChangeText={setAccountName}
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TextInput
              placeholder={localizeLegacy(language, 'Saldo inicial', 'Initial balance')}
              value={accountBalanceInput}
              onChangeText={(value) => setAccountBalanceInput(formatEditableAmount(value, selectedAccountCurrencyCode))}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.filterLabel}>
              {translate(language, 'Moneda', 'Currency', 'Valuta', '\u901a\u8ca8')}
            </Text>
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.dropdownButton}
              onPress={() => setIsNewAccountCurrencyDropdownOpen((previous) => !previous)}
            >
              <Text style={styles.dropdownButtonText}>
                {selectedAccountCurrencyCode} · {getCurrencyLabel(selectedAccountCurrencyCode, language)}
              </Text>
              <Text style={styles.dropdownChevron}>{isNewAccountCurrencyDropdownOpen ? '⌃' : '⌄'}</Text>
            </TouchableOpacity>
            {isNewAccountCurrencyDropdownOpen ? (
              <ScrollView style={styles.dropdownMenu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {CURRENCY_OPTIONS.map((currency) => (
                  <TouchableOpacity
                    activeOpacity={BUTTON_ACTIVE_OPACITY}
                    key={`new-account-currency-${currency.code}`}
                    style={[styles.dropdownOption, selectedAccountCurrencyCode === currency.code ? styles.dropdownOptionActive : undefined]}
                    onPress={() => {
                      setSelectedAccountCurrencyCode(currency.code);
                      setIsNewAccountCurrencyDropdownOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, selectedAccountCurrencyCode === currency.code ? styles.dropdownOptionTextActive : undefined]}>
                      {currency.code} · {getCurrencyLabel(currency.code, language)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            <Text style={styles.filterLabel}>{localizeLegacy(language, 'Color', 'Color')}</Text>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.secondaryButton}
              onPress={() => setIsNewAccountColorTableVisible((prev) => !prev)}
            >
              <Text style={styles.secondaryButtonText}>
                {isNewAccountColorTableVisible ? t.hideColors : t.changeColor}
              </Text>
            </TouchableOpacity>
            {isNewAccountColorTableVisible
              ? renderColorTable(selectedAccountColor, setSelectedAccountColor, 'new-account-color')
              : null}

            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.primaryButton} onPress={onAddAccount}>
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Agregar cuenta', 'Add account')}</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={styles.secondaryButton}
              onPress={requestCloseAnyOpenMenu}
            >
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isInternalTransferModalVisible}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>
              {localizeLegacy(language, 'Transferencia entre cuentas', 'Transfer between accounts')}
            </Text>
            <Text style={styles.filterLabel}>{localizeLegacy(language, 'Cuenta origen', 'From account')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {accounts.map((account) => (
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`it-from-${account.id}`}
                  style={[styles.accountChoiceChip, internalTransferFromId === account.id ? styles.filterChipActive : undefined, { borderColor: account.color }]}
                  onPress={() => setInternalTransferFromId(account.id)}
                >
                  <Text style={[styles.filterChipText, internalTransferFromId === account.id ? styles.filterChipTextActive : undefined]}>{account.name}</Text>
                  <Text style={styles.accountChoiceAmount}>{displayCurrency(account.balance, account.currencyCode)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.filterLabel}>{localizeLegacy(language, 'Cuenta destino', 'To account')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {accounts.map((account) => (
                <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY}
                  key={`it-to-${account.id}`}
                  style={[styles.accountChoiceChip, internalTransferToId === account.id ? styles.filterChipActive : undefined, { borderColor: account.color }]}
                  onPress={() => setInternalTransferToId(account.id)}
                >
                  <Text style={[styles.filterChipText, internalTransferToId === account.id ? styles.filterChipTextActive : undefined]}>{account.name}</Text>
                  <Text style={styles.accountChoiceAmount}>{displayCurrency(account.balance, account.currencyCode)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TextInput
              value={internalTransferAmount}
              onChangeText={(value) => setInternalTransferAmount(formatEditableAmount(value, accounts.find((account) => account.id === internalTransferFromId)?.currencyCode))}
              placeholder={localizeLegacy(language, 'Monto', 'Amount')}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />

            {internalTransferValidationMessage ? <Text style={styles.inlineValidationError}>{internalTransferValidationMessage}</Text> : null}
            <TouchableOpacity
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              style={[styles.primaryButton, internalTransferValidationMessage ? styles.primaryButtonDisabled : undefined]}
              onPress={() => void onApplyInternalTransfer()}
              disabled={Boolean(internalTransferValidationMessage)}
            >
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Aplicar transferencia', 'Apply transfer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={appLockEnabled && !isUnlocked} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{localizeLegacy(language, 'MyFinance bloqueada', 'MyFinance locked')}</Text>
            <Text style={styles.helpText}>
              {localizeLegacy(language, 'Ingresa tu PIN para continuar.', 'Enter your PIN to continue.')}
            </Text>
            <TextInput
              value={pinInput}
              onChangeText={setPinInput}
              placeholder={localizeLegacy(language, 'PIN', 'PIN')}
              keyboardType="number-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
              secureTextEntry
            />
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.primaryButton} onPress={onUnlockApp}>
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Desbloquear', 'Unlock')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isRestoreBackupModalVisible}
        transparent
        animationType="fade"
        onRequestClose={requestCloseAnyOpenMenu}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropCloseLayer} onPress={requestCloseAnyOpenMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{localizeLegacy(language, 'Restaurar backup', 'Restore backup')}</Text>
            <Text style={styles.helpText}>
              {localizeLegacy(language, 'Pega aquí el JSON exportado por la app.', 'Paste the JSON exported by the app here.')}
            </Text>
            <TextInput
              multiline
              value={backupJsonInput}
              onChangeText={setBackupJsonInput}
              style={styles.ocrInput}
              placeholder={localizeLegacy(language, 'Pega el JSON...', 'Paste JSON...')}
              placeholderTextColor={theme.placeholder}
              textAlignVertical="top"
            />
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.primaryButton} onPress={() => void onRestoreBackup()}>
              <Text style={styles.primaryButtonText}>{localizeLegacy(language, 'Validar y restaurar', 'Validate and restore')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={BUTTON_ACTIVE_OPACITY} style={styles.secondaryButton} onPress={requestCloseAnyOpenMenu}>
              <Text style={styles.secondaryButtonText}>{localizeLegacy(language, 'Cerrar', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </Animated.View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  mainContent: {
    flex: 1,
  },
  onboardingScreen: {
    flex: 1,
    paddingHorizontal: uiSpacing.md,
    paddingTop: uiSpacing.lg,
    paddingBottom: uiSpacing.md,
    justifyContent: 'space-between',
    backgroundColor: theme.background,
  },
  onboardingHeader: {
    gap: 3,
  },
  onboardingBrand: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  onboardingBuild: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    fontWeight: '700',
  },
  onboardingCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 24,
    backgroundColor: theme.surfaceAlt,
    padding: uiSpacing.lg,
    gap: uiSpacing.sm,
    ...uiElevation.card,
  },
  onboardingVisual: {
    height: 190,
    borderRadius: 22,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: uiSpacing.xs,
  },
  onboardingOrbLarge: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: theme.navActiveBg,
    top: -34,
    right: -28,
  },
  onboardingOrbSmall: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.accent,
    opacity: 0.42,
    bottom: -24,
    left: -18,
  },
  onboardingVisualCard: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: theme.inputBg,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingVisualCurrency: {
    color: theme.amountColor,
    fontSize: 42,
    fontWeight: '900',
  },
  onboardingStepCount: {
    color: theme.accentText,
    fontSize: uiTypography.caption,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  onboardingTitle: {
    color: theme.text,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
  },
  onboardingBody: {
    color: theme.textSoft,
    fontSize: uiTypography.body,
    lineHeight: 22,
    fontWeight: '600',
  },
  onboardingDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: uiSpacing.xs,
  },
  onboardingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: theme.borderStrong,
  },
  onboardingDotActive: {
    width: 26,
    backgroundColor: theme.accentStrong,
  },
  onboardingActions: {
    gap: uiSpacing.xs,
  },
  onboardingSkipButton: {
    minHeight: uiHeight.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingSkipText: {
    color: theme.textMuted,
    fontSize: uiTypography.body,
    fontWeight: '800',
  },
  sectionAnimatedWrap: {
    flex: 1,
  },
  container: {
    paddingHorizontal: uiSpacing.md,
    paddingTop: uiSpacing.md,
    paddingBottom: uiSpacing.xl,
    gap: uiSpacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpacing.sm,
    marginBottom: uiSpacing.sm,
  },
  menuButton: {
    width: uiHeight.iconButton,
    height: uiHeight.iconButton,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    ...uiElevation.card,
  },
  menuIcon: {
    color: theme.text,
    fontSize: 17,
    lineHeight: 18,
    fontWeight: '700',
  },
  headerTitleWrap: {
    flex: 1,
  },
  title: {
    fontSize: uiTypography.title,
    fontWeight: '800',
    color: theme.text,
    letterSpacing: 0.3,
  },
  headerCaption: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    marginTop: 1,
  },
  subtitle: {
    color: theme.textMuted,
    marginBottom: uiSpacing.sm,
    marginTop: -1,
    fontSize: uiTypography.caption,
    lineHeight: 18,
  },
  homeHeroCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.accentStrong,
    borderRadius: uiRadius.lg,
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.sm,
    minHeight: 92,
    position: 'relative',
    overflow: 'hidden',
    ...uiElevation.card,
    shadowColor: theme.accentStrong,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },
  homeHeroGlow: {
    position: 'absolute',
    left: -24,
    right: -24,
    top: -28,
    bottom: -28,
    borderRadius: uiRadius.lg + 10,
    borderWidth: 1,
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
    opacity: 0.2,
  },
  homeHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: uiSpacing.sm,
  },
  homeHeroLogo: {
    width: 46,
    height: 46,
    borderRadius: 14,
    flexShrink: 0,
  },
  homeHeroTextWrap: {
    flex: 1,
    flexShrink: 1,
    justifyContent: 'center',
    gap: 2,
  },
  homeHeroLabel: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    fontWeight: '700',
    opacity: 0.9,
  },
  homeHeroValue: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.3,
    flexShrink: 1,
    includeFontPadding: false,
    lineHeight: 34,
  },
  homeHeroSubLabel: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    opacity: 0.75,
  },
  homeStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: uiSpacing.sm,
    columnGap: uiSpacing.xs,
  },
  homeStatCard: {
    width: '48%',
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: uiRadius.md,
    paddingVertical: 9,
    paddingHorizontal: 9,
    minHeight: 82,
    gap: 3,
    ...uiElevation.card,
  },
  homeSectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: uiSpacing.sm,
    columnGap: uiSpacing.xs,
  },
  homeSectionMiniCard: {
    width: '48%',
    minHeight: 88,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.sm,
    justifyContent: 'center',
    gap: 5,
    ...uiElevation.card,
  },
  homeSectionWideCard: {
    width: '100%',
  },
  annualSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: uiSpacing.sm,
    columnGap: uiSpacing.xs,
  },
  annualSummaryCard: {
    width: '48%',
    minHeight: 76,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.sm,
    justifyContent: 'center',
    gap: 5,
    ...uiElevation.card,
  },
  annualSummaryWideCard: {
    width: '100%',
  },
  homeStatTitle: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  homeStatValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  homeStatPrimaryText: {
    color: theme.textSoft,
    fontSize: uiTypography.caption,
    fontWeight: '700',
  },
  homeStatSub: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
  },
  homeNoDataText: {
    color: theme.textMuted,
    fontSize: uiTypography.body,
    fontWeight: '600',
    marginTop: uiSpacing.xxs,
  },
  accountsTotalLabel: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    fontWeight: '600',
  },
  hormigaName: {
    color: theme.text,
    fontSize: uiTypography.body,
    fontWeight: '700',
    marginTop: 3,
  },
  accountsTotalValue: {
    color: theme.text,
    fontSize: uiTypography.section,
    fontWeight: '800',
    marginTop: 4,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: uiRadius.md,
    padding: uiSpacing.sm,
    gap: uiSpacing.xs,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    ...uiElevation.card,
  },
  homeChartCard: {
    padding: uiSpacing.sm,
    gap: uiSpacing.xs,
  },
  homeBudgetOverview: {
    gap: uiSpacing.sm,
  },
  homePayablesOverview: {
    gap: uiSpacing.sm,
  },
  homeBudgetList: {
    gap: uiSpacing.xs,
  },
  homeBudgetItem: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.surfaceAlt,
    padding: uiSpacing.sm,
    gap: 6,
  },
  homePayableItem: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.surfaceAlt,
    padding: uiSpacing.sm,
    gap: 6,
  },
  homeBudgetTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: uiSpacing.xs,
  },
  homeBudgetRemaining: {
    color: theme.amountColor,
    fontSize: uiTypography.caption,
    fontWeight: '800',
  },
  homeBudgetDetails: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
    fontWeight: '600',
  },
  homeBudgetActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: uiSpacing.xs,
  },
  chartContentRow: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpacing.xs,
  },
  sectionTitle: {
    fontSize: uiTypography.section,
    fontWeight: '800',
    color: theme.text,
    letterSpacing: 0.25,
    marginBottom: uiSpacing.xxs,
  },
  filterWrap: {
    gap: uiSpacing.xs,
  },
  filterLabel: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chipScroll: {
    marginBottom: uiSpacing.xs,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: uiSpacing.sm,
    minHeight: uiHeight.chip,
    borderRadius: uiRadius.pill,
    marginRight: uiSpacing.xs,
    backgroundColor: theme.surfaceAlt,
    justifyContent: 'center',
  },
  filterChipActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  filterChipText: {
    color: theme.textSoft,
    fontSize: uiTypography.caption,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: theme.accentText,
    fontWeight: '700',
  },
  accountChoiceChip: {
    borderWidth: 1.5,
    paddingHorizontal: uiSpacing.sm,
    paddingVertical: 7,
    minHeight: uiHeight.chip,
    borderRadius: uiRadius.md,
    marginRight: uiSpacing.xs,
    backgroundColor: theme.surfaceAlt,
    gap: 2,
  },
  accountChoiceAmount: {
    color: theme.text,
    fontSize: uiTypography.tiny,
    fontWeight: '800',
  },
  inlineValidationError: {
    color: theme.dangerText,
    fontSize: uiTypography.caption,
    fontWeight: '700',
    lineHeight: 17,
  },
  colorChip: {
    width: 25,
    height: 21,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  colorChipActive: {
    borderColor: theme.text,
  },
  colorTableWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.sm,
    padding: uiSpacing.xs,
    backgroundColor: theme.background,
    gap: 3,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.inputBg,
    paddingHorizontal: uiSpacing.sm,
    minHeight: uiHeight.input,
  },
  searchIcon: {
    color: theme.textMuted,
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: uiTypography.body,
  },
  predictionList: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    overflow: 'hidden',
  },
  predictionItem: {
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.sm,
    backgroundColor: theme.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  predictionText: {
    color: theme.textSoft,
  },
  helpText: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
    lineHeight: 20,
  },
  developerSeal: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.accentStrong,
    borderRadius: uiRadius.md,
    backgroundColor: theme.navActiveBg,
    paddingVertical: uiSpacing.md,
    paddingHorizontal: uiSpacing.md,
    shadowColor: theme.accentStrong,
    shadowOpacity: 0.34,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  developerSealGlow: {
    position: 'absolute',
    width: 138,
    height: 138,
    borderRadius: 69,
    top: -74,
    right: -30,
    backgroundColor: theme.accentStrong,
    opacity: 0.18,
  },
  developerSealOverline: {
    color: theme.accentText,
    fontSize: uiTypography.tiny,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  developerSealName: {
    color: theme.text,
    fontSize: uiTypography.body + 2,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginTop: 4,
  },
  developerSealRights: {
    color: theme.textSoft,
    fontSize: uiTypography.tiny,
    lineHeight: 17,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpacing.sm,
    minHeight: uiHeight.input,
    color: theme.text,
    backgroundColor: theme.inputBg,
    fontSize: uiTypography.body,
  },
  ocrInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpacing.sm,
    paddingVertical: uiSpacing.sm,
    color: theme.text,
    backgroundColor: theme.inputBg,
    minHeight: 140,
    fontSize: uiTypography.body,
    lineHeight: 21,
  },
  previewImage: {
    width: '100%',
    height: 190,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpacing.md,
    borderWidth: 1,
    borderColor: theme.accentStrong,
    ...uiElevation.card,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: theme.accentText,
    fontWeight: '800',
    fontSize: uiTypography.body,
    letterSpacing: 0.15,
    textAlign: 'center',
    width: '100%',
    includeFontPadding: false,
    lineHeight: 19,
  },
  secondaryButton: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: uiSpacing.md,
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: uiTypography.body,
    textAlign: 'center',
    width: '100%',
    includeFontPadding: false,
    lineHeight: 19,
  },
  secondaryButtonCompact: {
    flex: 1,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.buttonCompact,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: uiSpacing.sm,
  },
  colorEditCircleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.placeholder,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  colorEditCircleIcon: {
    color: theme.textSoft,
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  categoryActionRow: {
    flexDirection: 'row',
    gap: uiSpacing.xs,
  },
  categoryManagerList: {
    gap: uiSpacing.xs,
  },
  categoryManagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpacing.xs,
  },
  deleteCategorySmallButton: {
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: uiRadius.pill,
    minHeight: uiHeight.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.dangerBg,
    paddingHorizontal: uiSpacing.sm,
  },
  dataActionButton: {
    flexBasis: '100%',
    flexGrow: 0,
    minHeight: uiHeight.button,
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.md,
  },
  dataActionButtonText: {
    flexShrink: 1,
    lineHeight: 20,
  },
  deleteCategoryButton: {
    flex: 1,
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.buttonCompact,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteActionButtonFull: {
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteCategoryButtonText: {
    color: theme.dangerText,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    includeFontPadding: false,
    lineHeight: 18,
  },
  clearButton: {
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: uiRadius.md,
    minHeight: uiHeight.buttonCompact,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.dangerBg,
  },
  clearButtonText: {
    color: theme.dangerText,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    includeFontPadding: false,
    lineHeight: 18,
  },
  quickFabLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: uiSpacing.lg,
    zIndex: 30,
  },
  quickMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  quickFabAnchor: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickFabProgressRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: theme.accentStrong,
    backgroundColor: 'transparent',
  },
  quickFabGlow: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: theme.accentStrong,
    opacity: 0.16,
  },
  quickFabButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.accent,
    borderWidth: 1,
    borderColor: theme.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
    ...uiElevation.card,
  },
  quickFabButtonActive: {
    borderColor: theme.accentText,
    shadowColor: theme.accentStrong,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 13,
  },
  quickFabText: {
    color: theme.accentText,
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '800',
  },
  quickRadialMenu: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 94,
    height: 178,
  },
  quickRadialButton: {
    position: 'absolute',
    minHeight: 42,
    borderRadius: uiRadius.pill,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpacing.sm,
    ...uiElevation.card,
  },
  quickRadialButtonActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
    shadowColor: theme.accentStrong,
    shadowOpacity: 0.52,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  quickRadialIncome: {
    width: 124,
    left: '50%',
    top: 0,
  },
  quickRadialExpense: {
    width: 116,
    left: '50%',
    top: 72,
  },
  quickRadialTransfer: {
    width: 172,
    left: '50%',
    top: 72,
  },
  quickRadialText: {
    color: theme.text,
    fontSize: uiTypography.caption,
    fontWeight: '800',
  },
  quickRadialTextActive: {
    color: theme.accentText,
  },
  quickDirectionGlow: {
    position: 'absolute',
    left: '50%',
    bottom: 22,
    width: 118,
    height: 16,
    marginLeft: -59,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentStrong,
    opacity: 0,
    shadowColor: theme.accentStrong,
    shadowOpacity: 0.65,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  quickDragArrowVisible: {
    opacity: 0.5,
  },
  analysisWrap: {
    gap: uiSpacing.xs,
    paddingTop: uiSpacing.xxs,
  },
  chartWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    minHeight: 154,
  },
  chartSideCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.surfaceAlt,
    padding: uiSpacing.xs,
    justifyContent: 'center',
  },
  annualChartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: uiSpacing.md,
    marginTop: uiSpacing.xxs,
  },
  annualLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  annualLegendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  annualLegendText: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
    fontWeight: '700',
  },
  annualMonthLabels: {
    width: 142,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  annualMonthLabel: {
    width: 11,
    color: theme.textMuted,
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  annualTopCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpacing.xs,
    minHeight: 32,
  },
  annualTopCategoryName: {
    flex: 1,
    color: theme.text,
    fontSize: uiTypography.body,
    fontWeight: '700',
  },
  annualTopCategoryAmount: {
    color: theme.amountColor,
    fontSize: uiTypography.body,
    fontWeight: '800',
  },
  emptyChart: {
    width: 142,
    height: 142,
    borderRadius: 71,
    borderWidth: 17,
    borderColor: theme.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  chartCenterValue: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  chartCenterSub: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
    fontWeight: '600',
  },
  chartEmptyStateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpacing.sm,
  },
  chartEmptyIconPlaceholder: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'transparent',
  },
  chartEmptyTextWrap: {
    flex: 1,
    gap: 2,
  },
  chartEmptyTitle: {
    color: theme.textSoft,
    fontSize: uiTypography.tiny,
    fontWeight: '700',
  },
  chartEmptySubtitle: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
    lineHeight: 14,
  },
  legendWrap: {
    gap: uiSpacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 26,
    paddingVertical: 2,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendText: {
    color: theme.textMuted,
    flex: 1,
    fontWeight: '600',
    fontSize: uiTypography.tiny,
  },
  legendRight: {
    minWidth: 96,
    alignItems: 'flex-end',
    gap: 1,
  },
  legendPercent: {
    color: theme.textMuted,
    fontSize: uiTypography.tiny,
    fontWeight: '600',
  },
  legendAmount: {
    color: theme.text,
    fontSize: uiTypography.tiny,
    fontWeight: '700',
  },
  expenseTopTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpacing.xs,
    marginBottom: uiSpacing.xs,
  },
  expenseNavButton: {
    minHeight: uiHeight.chip,
    borderRadius: uiRadius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: uiSpacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expenseNavButtonActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  expenseNavButtonText: {
    color: theme.textSoft,
    fontSize: uiTypography.caption,
    fontWeight: '700',
  },
  expenseNavButtonTextActive: {
    color: theme.accentText,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: uiSpacing.xs,
  },
  summaryLabel: {
    color: theme.textMuted,
    fontWeight: '600',
  },
  summaryValue: {
    color: theme.text,
    fontWeight: '700',
  },
  receiptWarningsBox: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpacing.sm,
    paddingVertical: uiSpacing.xs,
    gap: uiSpacing.xxs,
  },
  receiptWarningText: {
    color: theme.textMuted,
    fontSize: uiTypography.caption,
  },
  ocrDebugBox: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpacing.sm,
    paddingVertical: uiSpacing.sm,
    gap: uiSpacing.xxs,
  },
  ocrDebugTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: uiTypography.body,
  },
  ocrDebugLabel: {
    color: theme.textMuted,
    fontWeight: '600',
    marginTop: uiSpacing.xxs,
  },
  ocrDebugText: {
    color: theme.textSoft,
    fontSize: uiTypography.caption,
  },
  monthGroup: {
    gap: uiSpacing.xs,
    marginBottom: uiSpacing.xs,
  },
  monthTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 15,
    textTransform: 'capitalize',
  },
  tableWrap: {
    minWidth: 760,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.background,
  },
  tableHeader: {
    backgroundColor: theme.surfaceAlt,
  },
  tableHeaderText: {
    color: theme.textSoft,
    fontWeight: '700',
  },
  tableCell: {
    paddingVertical: 9,
    paddingHorizontal: 8,
    color: theme.textSoft,
    borderRightWidth: 1,
    borderRightColor: theme.border,
  },
  cellProduct: {
    width: 190,
  },
  cellQty: {
    width: 90,
    textAlign: 'center',
  },
  cellAccount: {
    width: 130,
  },
  cellAmount: {
    width: 110,
    textAlign: 'right',
    color: theme.amountColor,
    fontWeight: '700',
  },
  cellDate: {
    width: 110,
  },
  cellAction: {
    width: 110,
    borderRightWidth: 0,
  },
  deleteTableButton: {
    borderWidth: 1,
    borderColor: theme.dangerBorder,
    borderRadius: uiRadius.sm,
    minHeight: 30,
    paddingHorizontal: uiSpacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteTableButtonText: {
    color: theme.dangerText,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    includeFontPadding: false,
    lineHeight: 15,
  },
  adjustBudgetInlineButton: {
    borderColor: theme.placeholder,
    borderWidth: 1,
    borderRadius: uiRadius.sm,
    minHeight: 30,
    paddingHorizontal: uiSpacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  totalLabel: {
    color: theme.textMuted,
    fontWeight: '600',
  },
  totalValue: {
    color: theme.text,
    fontWeight: '700',
    fontSize: uiTypography.section,
  },
  loading: {
    color: theme.textMuted,
  },
  skeletonCardWrap: {
    gap: uiSpacing.sm,
    marginTop: uiSpacing.xs,
  },
  transactionsList: {
    marginTop: uiSpacing.xs,
    gap: uiSpacing.xs,
  },
  itemRow: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    padding: uiSpacing.md,
    marginBottom: uiSpacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: uiSpacing.sm,
  },
  budgetItemRow: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.borderStrong,
  },
  productActionWrap: {
    alignItems: 'flex-end',
    gap: uiSpacing.xs,
  },
  budgetActionsWrap: {
    minWidth: 116,
  },
  itemTextWrap: {
    flex: 1,
    gap: 2,
  },
  budgetCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  budgetCategoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  payableStatusDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  payableStatusPending: {
    backgroundColor: theme.dangerBorder,
  },
  payableStatusPaid: {
    backgroundColor: theme.accentStrong,
  },
  itemDesc: {
    fontSize: uiTypography.body,
    color: theme.text,
    fontWeight: '700',
  },
  itemDate: {
    marginTop: 2,
    color: theme.textMuted,
    fontSize: uiTypography.caption,
  },
  itemAmount: {
    fontWeight: '800',
    color: theme.amountColor,
    fontSize: uiTypography.body,
  },
  accountGrid: {
    gap: uiSpacing.sm,
  },
  accountsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpacing.sm,
  },
  addCircleButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.accentStrong,
  },
  addCircleButtonText: {
    color: theme.accentText,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  accountCard: {
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.md,
    paddingHorizontal: uiSpacing.md,
    borderWidth: 1,
    borderColor: theme.surfaceAlt,
    gap: uiSpacing.xs,
    ...uiElevation.card,
    shadowOpacity: 0.34,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  accountCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpacing.xs,
  },
  accountBadge: {
    borderRadius: uiRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(15,23,42,0.18)',
    paddingHorizontal: uiSpacing.xs,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountBadgeText: {
    color: theme.textSoft,
    fontSize: uiTypography.tiny,
    fontWeight: '700',
  },
  accountName: {
    color: theme.text,
    fontWeight: '800',
    fontSize: uiTypography.body,
  },
  accountBalance: {
    color: theme.text,
    fontWeight: '800',
    fontSize: uiTypography.section,
  },
  budgetProgressTrack: {
    height: 8,
    borderRadius: uiRadius.pill,
    backgroundColor: theme.border,
    marginTop: uiSpacing.xs,
    overflow: 'hidden',
  },
  budgetProgressFill: {
    height: 8,
    borderRadius: uiRadius.pill,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
    color: theme.textMuted,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.md,
    paddingHorizontal: uiSpacing.sm,
    overflow: 'hidden',
  },
  configNotice: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  configNoticeText: {
    color: theme.textSoft,
    fontSize: 12,
  },
  configSectionCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.lg,
    backgroundColor: theme.surfaceAlt,
    padding: uiSpacing.md,
    gap: uiSpacing.sm,
    ...uiElevation.card,
  },
  configSectionTitle: {
    color: theme.text,
    fontSize: uiTypography.section,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  settingsOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpacing.xs,
  },
  dropdownButton: {
    minHeight: uiHeight.button,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.inputBg,
    paddingHorizontal: uiSpacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpacing.xs,
  },
  dropdownButtonText: {
    flex: 1,
    color: theme.text,
    fontSize: uiTypography.body,
    fontWeight: '700',
  },
  dropdownChevron: {
    color: theme.textMuted,
    fontSize: 18,
    fontWeight: '800',
  },
  dropdownMenu: {
    position: 'relative',
    zIndex: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.surfaceAlt,
    overflow: 'hidden',
    maxHeight: 260,
    marginTop: -uiSpacing.xxs,
    marginBottom: uiSpacing.xs,
  },
  dropdownOption: {
    minHeight: uiHeight.buttonCompact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  dropdownOptionActive: {
    backgroundColor: theme.navActiveBg,
  },
  dropdownOptionText: {
    color: theme.textSoft,
    fontSize: uiTypography.body,
    fontWeight: '700',
  },
  dropdownOptionTextActive: {
    color: theme.accentText,
  },
  settingsActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpacing.xs,
  },
  configFooter: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.borderStrong,
    paddingTop: 8,
  },
  configBuildText: {
    color: theme.textMuted,
    fontSize: 12,
  },
  languageRow: {
    flexDirection: 'row',
    gap: uiSpacing.xs,
  },
  numberFormatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpacing.xs,
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
  },
  drawerBackdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  drawerPanel: {
    width: 272,
    height: '100%',
    backgroundColor: theme.surfaceAlt,
    borderRightWidth: 1,
    borderRightColor: theme.border,
    paddingTop: uiSpacing.lg,
    paddingHorizontal: uiSpacing.sm,
    gap: uiSpacing.sm,
    ...uiElevation.modal,
  },
  drawerTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  drawerItem: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: uiRadius.md,
    backgroundColor: theme.surface,
    paddingVertical: uiSpacing.sm,
    paddingHorizontal: uiSpacing.sm,
  },
  drawerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerItemActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  drawerItemIcon: {
    color: theme.textMuted,
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 20,
    width: 16,
    textAlign: 'center',
  },
  drawerBudgetIcon: {
    fontSize: 29,
    lineHeight: 29,
    transform: [{ translateY: -2 }],
  },
  drawerAccountsIcon: {
    transform: [{ translateY: -2 }],
  },
  drawerItemText: {
    color: theme.textMuted,
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 20,
  },
  drawerItemTextActive: {
    color: theme.accentText,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.modalBackdrop,
    justifyContent: 'center',
    padding: uiSpacing.md,
  },
  modalBackdropCloseLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderRadius: uiRadius.lg,
    padding: uiSpacing.lg,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    gap: uiSpacing.sm,
    zIndex: 1,
    ...uiElevation.modal,
  },
  modalCardScrollable: {
    maxHeight: '90%',
  },
  modalOptionRow: {
    flexDirection: 'row',
    gap: uiSpacing.xs,
  },
  negativeBudget: {
    color: '#fca5a5',
    fontWeight: '700',
  },
  budgetWarningText: {
    marginTop: 4,
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
  },
  });
}




import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { initDb } from './src/db/database';
import type { Account } from './src/models/account';
import type { Expense } from './src/models/expense';
import type { IncomeEntry } from './src/models/incomeEntry';
import type { StoredProduct } from './src/models/product';
import {
  createAccount,
  deleteAccountById,
  listAccounts,
  updateAccountBalance,
  updateAccountColor,
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
import {
  getSavedLanguage,
  getSavedNumberFormat,
  getSavedThemeMode,
  saveNumberFormat,
  saveLanguage,
  saveThemeMode,
  type AppLanguage,
  type AppNumberFormat,
  type AppThemeMode,
} from './src/repositories/settingsRepository';
import {
  createProduct,
  createProducts,
  deleteProductById,
  listProducts,
} from './src/repositories/productRepository';
import { DEFAULT_PRODUCT_CATEGORIES, FALLBACK_CATEGORY } from './src/services/categoryService';
import { readTextFromImageLocal } from './src/services/ocrService';
import { analyzeReceiptText, type ReceiptAnalysis, type ReceiptItem } from './src/services/receiptAnalyzer';

type MonthlyProductGroup = {
  monthKey: string;
  monthLabel: string;
  items: StoredProduct[];
};

type SearchPrediction = {
  name: string;
  score: number;
};

type AppSection = 'inicio' | 'gastos' | 'transacciones' | 'cuentas' | 'presupuesto' | 'configuracion';
type GastosTopTab = 'manual' | 'receipt' | 'transfer' | 'total' | 'income_added';
type TransferMode = 'received' | 'sent';

const SECTION_SYMBOLS: Record<AppSection, string> = {
  inicio: '⌂',
  gastos: '₡',
  transacciones: '≣',
  cuentas: '▤',
  presupuesto: '◔',
  configuracion: '⚙',
};

type CategorySlice = {
  category: string;
  total: number;
  percentage: number;
};

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

function getMonthKey(dateIso: string): string {
  const date = new Date(dateIso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthLabel(dateIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(dateIso));
}

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

function formatCurrency(value: number, language: AppLanguage, numberFormat: AppNumberFormat): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue < 0 ? '-' : '';
  const absolute = Math.abs(safeValue);
  const fixed = absolute.toFixed(2);
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

  if (language === 'en') {
    return `${sign}CRC ${integerWithThousands}${selected.decimal}${decimalPart}`;
  }

  return `${sign}\u20A1${integerWithThousands}${selected.decimal}${decimalPart}`;
}

function parseAmountInput(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) {
    return Number.NaN;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : '.';

  if (lastComma === -1 && lastDot === -1) {
    return Number(cleaned);
  }

  const normalized = cleaned
    .replace(new RegExp(`\\${decimalSeparator === ',' ? '.' : ','}`, 'g'), '')
    .replace(decimalSeparator, '.');

  return Number(normalized);
}

function parseMoneyToken(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) {
    return Number.NaN;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) {
    return Number(cleaned);
  }

  const decimalIndex = Math.max(lastComma, lastDot);
  const decimalSeparator = decimalIndex === lastComma ? ',' : '.';
  const digitsAfter = cleaned.length - decimalIndex - 1;

  if (digitsAfter >= 1 && digitsAfter <= 2) {
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
    const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '');
    return Number(`${integerPart}.${decimalPart}`);
  }

  return Number(cleaned.replace(/[.,]/g, ''));
}

function extractReceiptTotal(rawText: string): number {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const amountPattern = /\$?\s*\d[\d.,]*/g;
  const extractAmounts = (line: string): number[] =>
    (line.match(amountPattern) ?? [])
      .map((token) => parseMoneyToken(token))
      .filter((value) => Number.isFinite(value) && value > 0);

  const totalCandidates: number[] = [];
  const totalLikePattern = /\b(total|monto|monto\s+total)\b/i;
  for (const line of lines) {
    if (totalLikePattern.test(line)) {
      totalCandidates.push(...extractAmounts(line));
    }
  }

  if (totalCandidates.length > 0) {
    return Number(Math.max(...totalCandidates).toFixed(2));
  }

  const allAmounts = lines.flatMap(extractAmounts);
  if (allAmounts.length === 0) {
    return 0;
  }

  return Number(Math.max(...allAmounts).toFixed(2));
}

function normalizeForLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractColonesAmounts(line: string): number[] {
  const colonesPattern = /(?:₡|¢|CRC)\s*[\d][\d.,\s]*/gi;
  return (line.match(colonesPattern) ?? [])
    .map((token) => token.replace(/CRC/gi, ''))
    .map((token) => parseMoneyToken(token))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function extractTransferTotal(rawText: string): number {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return 0;
  }

  const normalizedLines = lines.map((line) => normalizeForLookup(line));
  const lineAmounts = lines.map((line) => extractColonesAmounts(line));
  const ignoredFragments = [
    'numero de cuenta',
    'numero de celular',
    'referencia',
    'identificacion',
    'comision',
    'monto a transferir',
  ];
  const candidates: number[] = [];

  for (let i = 0; i < normalizedLines.length; i += 1) {
    const normalized = normalizedLines[i];
    const isIgnored = ignoredFragments.some((fragment) => normalized.includes(fragment));
    if (isIgnored) {
      continue;
    }

    if (normalized.includes('monto total') || normalized.includes('total monto')) {
      candidates.push(...lineAmounts[i]);
      if (i + 1 < lineAmounts.length) {
        candidates.push(...lineAmounts[i + 1]);
      }
      if (i - 1 >= 0) {
        candidates.push(...lineAmounts[i - 1]);
      }
    }
  }

  if (candidates.length > 0) {
    return Number(Math.max(...candidates).toFixed(2));
  }

  const totalLineCandidates: number[] = [];
  for (let i = 0; i < normalizedLines.length; i += 1) {
    const normalized = normalizedLines[i];
    const looksLikeTotal =
      normalized.includes('total') &&
      !normalized.includes('subtotal') &&
      !ignoredFragments.some((fragment) => normalized.includes(fragment));

    if (looksLikeTotal) {
      totalLineCandidates.push(...lineAmounts[i]);
    }
  }

  if (totalLineCandidates.length > 0) {
    return Number(Math.max(...totalLineCandidates).toFixed(2));
  }

  return 0;
}

function shouldUseUnnamedReceiptFallback(rawText: string, analysis: ReceiptAnalysis): boolean {
  if (analysis.items.length === 0) {
    return true;
  }

  const normalizedText = normalizeForLookup(rawText);
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
    const normalizedName = normalizeForLookup(item.name);
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

const MONTH_OPTIONS: Record<AppLanguage, { value: string; label: string }[]> = {
  es: [
    { value: 'all', label: 'Todos' },
    { value: '01', label: 'Enero' },
    { value: '02', label: 'Febrero' },
    { value: '03', label: 'Marzo' },
    { value: '04', label: 'Abril' },
    { value: '05', label: 'Mayo' },
    { value: '06', label: 'Junio' },
    { value: '07', label: 'Julio' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Septiembre' },
    { value: '10', label: 'Octubre' },
    { value: '11', label: 'Noviembre' },
    { value: '12', label: 'Diciembre' },
  ],
  en: [
    { value: 'all', label: 'All' },
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ],
};

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
    navConfig: 'Configuracion',
    subtitleGastos: 'Registro y consulta de gastos',
    subtitleTransacciones: 'Movimientos y productos por mes',
    subtitleCuentas: 'Gestion de cuentas',
    subtitleConfig: 'Configuracion de la app',
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
    receiptHelp: 'Pega o corrige el texto de la factura aqui. La app extrae: nombre, precio, unidades y total.',
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
    transferReceived: 'Recibi una Transferencia',
    transferMade: 'Hice una Transferencia',
    productName: 'Nombre de Producto',
    quantity: 'Cantidad',
    category: 'Categoria',
    newCategory: 'Nueva categoria',
    addCategory: 'Anadir categoria',
    deleteCategory: 'Eliminar categoria',
    amount: 'Monto',
    saveExpense: 'Guardar gasto',
    budgetByCategory: 'Presupuesto por categoria',
    maxBudget: 'Presupuesto maximo',
    saveBudget: 'Guardar presupuesto',
    adjustBudget: 'Ajustar presupuesto',
    increase: 'Aumentar',
    decrease: 'Disminuir',
    monthlySpent: 'Gastado del mes',
    remainingBudget: 'Restante',
    noBudgets: 'Aun no hay presupuestos configurados.',
    noAvailableBudgetCategories: 'Todas las categorias ya tienen presupuesto asignado.',
    budgetCategoryInUse: 'Esta categoria ya tiene un presupuesto asignado.',
    deleteBudget: 'Eliminar presupuesto',
    chartCategoryColors: 'Colores de categorias (grafica)',
    saveCategoryColor: 'Guardar color',
    selectCategoryFirst: 'Selecciona una categoria primero.',
    accountActions: 'Acciones de cuenta',
    editColor: 'Editar color',
    changeColor: 'Cambiar color',
    hideColors: 'Ocultar colores',
    deleteAccount: 'Eliminar cuenta',
    accountDeleted: 'Cuenta eliminada.',
    noExpenses: 'Aun no hay gastos guardados.',
    noIncomeEntries: 'Aun no hay ingresos agregados.',
    createAccountFirst: 'Primero crea una cuenta en la seccion Cuentas.',
    bugNotice: '',
    ocrInProgress: '',
    buildNumber: 'Build Numero 5',
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
    spanish: 'Espanol',
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
    buildNumber: 'Build number 5',
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
} as const;

function getCategoryLabel(category: string, language: AppLanguage): string {
  const map: Record<string, { es: string; en: string }> = {
    varios: { es: 'Varios', en: 'Misc' },
    celular: { es: 'Celular', en: 'Mobile' },
    comida: { es: 'Comida', en: 'Food' },
    hogar: { es: 'Hogar', en: 'Home' },
    transporte: { es: 'Transporte', en: 'Transport' },
  };

  return map[category]?.[language] ?? capitalize(category);
}

function getIncomeSourceLabel(source: IncomeEntry['source'], language: AppLanguage): string {
  if (source === 'transfer_received') {
    return language === 'es' ? 'Transferencia' : 'Transfer';
  }

  return language === 'es' ? 'Ingreso agregado' : 'Added income';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function getFuzzyScore(query: string, target: string): number {
  if (!query) {
    return 0;
  }

  if (target.includes(query)) {
    return 1;
  }

  const targetWords = target.split(/\s+/);
  const wordScores = targetWords.map((word) => {
    const distance = levenshteinDistance(query, word);
    const maxLength = Math.max(query.length, word.length);
    return 1 - distance / maxLength;
  });

  const phraseDistance = levenshteinDistance(query, target);
  const phraseMaxLength = Math.max(query.length, target.length);
  const phraseScore = 1 - phraseDistance / phraseMaxLength;
  const bestWordScore = wordScores.length > 0 ? Math.max(...wordScores) : 0;

  return Math.max(phraseScore, bestWordScore);
}

export default function App() {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const [themeMode, setThemeMode] = useState<AppThemeMode>('dark');
  const [numberFormat, setNumberFormat] = useState<AppNumberFormat>('comma');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [amount, setAmount] = useState('');
  const [manualCategory, setManualCategory] = useState<string>(FALLBACK_CATEGORY);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [categoryColors, setCategoryColors] = useState<CategoryColor[]>([]);
  const [accountName, setAccountName] = useState('');
  const [accountBalanceInput, setAccountBalanceInput] = useState('');
  const [selectedAccountColor, setSelectedAccountColor] = useState<string>(ALL_COLOR_OPTIONS[0]);
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
  const [loading, setLoading] = useState(true);

  const [receiptImageUri, setReceiptImageUri] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [receiptAnalysis, setReceiptAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [isPickingInvoiceImage, setIsPickingInvoiceImage] = useState(false);
  const [receiptCategory, setReceiptCategory] = useState<string>(FALLBACK_CATEGORY);
  const [selectedReceiptAccountId, setSelectedReceiptAccountId] = useState<number | null>(null);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [transferImageUri, setTransferImageUri] = useState<string | null>(null);
  const [transferOcrText, setTransferOcrText] = useState('');
  const [transferTotalAmount, setTransferTotalAmount] = useState(0);
  const [isPickingTransferImage, setIsPickingTransferImage] = useState(false);
  const [selectedTransferAccountId, setSelectedTransferAccountId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<AppSection>('inicio');
  const [gastosTopTab, setGastosTopTab] = useState<GastosTopTab>('manual');
  const [expenseTabsScrollRatio, setExpenseTabsScrollRatio] = useState(0);
  const [expenseTabsViewportWidth, setExpenseTabsViewportWidth] = useState(1);
  const [expenseTabsContentWidth, setExpenseTabsContentWidth] = useState(1);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [productQuery, setProductQuery] = useState('');
  const themeOpacity = useRef(new Animated.Value(1)).current;
  const drawerTranslateX = useRef(new Animated.Value(-280)).current;
  const drawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const budgetWarningTrackerRef = useRef<Set<string>>(new Set());

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
  const dateLocale = language === 'es' ? 'es-CR' : 'en-US';
  const monthOptions = MONTH_OPTIONS[language];

  const total = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses]);
  const totalIncomeAdded = useMemo(
    () => Number(incomeEntries.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    [incomeEntries]
  );
  const totalAccountsBalance = useMemo(
    () => Number(accounts.reduce((sum, account) => sum + account.balance, 0).toFixed(2)),
    [accounts]
  );
  const now = useMemo(() => new Date(), []);
  const currentMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale, {
        month: 'long',
        year: 'numeric',
      }).format(now),
    [dateLocale, now]
  );

  const currentMonthProducts = useMemo(() => {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    return products.filter((product) => {
      const date = new Date(product.createdAt);
      return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
    });
  }, [now, products]);

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
        existing.totalAmount = Number((existing.totalAmount + product.unitPrice).toFixed(2));
        continue;
      }

      aggregated.set(product.name, {
        name: product.name,
        totalUnits: product.quantity,
        totalAmount: Number(product.unitPrice.toFixed(2)),
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

  const yearOptions = useMemo(() => {
    const currentYear = String(new Date().getFullYear());
    const transactionYears = products
      .map((product) => new Date(product.createdAt).getFullYear())
      .filter((year) => Number.isFinite(year))
      .map((year) => String(year));
    const years = Array.from(new Set([currentYear, ...transactionYears]));
    years.sort((a, b) => Number(b) - Number(a));
    return ['all', ...years];
  }, [products]);

  const uniqueProductNames = useMemo(() => {
    return Array.from(new Set(products.map((product) => product.name)));
  }, [products]);

  const normalizedQuery = useMemo(() => normalizeText(productQuery), [productQuery]);

  const predictions = useMemo<SearchPrediction[]>(() => {
    if (!normalizedQuery) {
      return [];
    }

    return uniqueProductNames
      .map((name) => {
        const normalizedName = normalizeText(name);
        return {
          name,
          score: getFuzzyScore(normalizedQuery, normalizedName),
        };
      })
      .filter((item) => item.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [normalizedQuery, uniqueProductNames]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const date = new Date(product.createdAt);
      const productYear = String(date.getFullYear());
      const productMonth = String(date.getMonth() + 1).padStart(2, '0');

      if (selectedYear !== 'all' && productYear !== selectedYear) {
        return false;
      }

      if (selectedMonth !== 'all' && productMonth !== selectedMonth) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const score = getFuzzyScore(normalizedQuery, normalizeText(product.name));
      return score >= 0.35;
    });
  }, [normalizedQuery, products, selectedMonth, selectedYear]);

  const groupedProducts = useMemo<MonthlyProductGroup[]>(() => {
    const groupMap = new Map<string, MonthlyProductGroup>();

    for (const product of filteredProducts) {
      const monthKey = getMonthKey(product.createdAt);
      const existing = groupMap.get(monthKey);

      if (existing) {
        existing.items.push(product);
        continue;
      }

      groupMap.set(monthKey, {
        monthKey,
        monthLabel: getMonthLabel(product.createdAt, dateLocale),
        items: [product],
      });
    }

    return Array.from(groupMap.values());
  }, [dateLocale, filteredProducts]);

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

  const loadAccounts = useCallback(async () => {
    const data = await listAccounts();
    setAccounts(data);
  }, []);

  const loadBudgets = useCallback(async () => {
    const data = await listBudgets();
    setBudgets(data);
  }, []);

  const loadCategoryColors = useCallback(async () => {
    const data = await listCategoryColors();
    setCategoryColors(data);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await initDb();
        await Promise.all([
          loadExpenses(),
          loadIncomeEntries(),
          loadProducts(),
          loadCategories(),
          loadAccounts(),
          loadLanguage(),
          loadThemeMode(),
          loadNumberFormat(),
          loadBudgets(),
          loadCategoryColors(),
        ]);
      } catch (error) {
        Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo iniciar la app' : 'Could not start the app');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAccounts, loadBudgets, loadCategories, loadCategoryColors, loadExpenses, loadIncomeEntries, loadLanguage, loadNumberFormat, loadProducts, loadThemeMode]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(manualCategory)) {
      setManualCategory(FALLBACK_CATEGORY);
    }
    if (categories.length > 0 && !categories.includes(receiptCategory)) {
      setReceiptCategory(FALLBACK_CATEGORY);
    }
  }, [categories, manualCategory, receiptCategory]);

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
      return;
    }

    if (!accounts.some((account) => account.id === selectedExpenseAccountId)) {
      setSelectedExpenseAccountId(accounts[0].id);
    }
    if (!accounts.some((account) => account.id === selectedReceiptAccountId)) {
      setSelectedReceiptAccountId(accounts[0].id);
    }
    if (!accounts.some((account) => account.id === selectedTransferAccountId)) {
      setSelectedTransferAccountId(accounts[0].id);
    }
  }, [accounts, selectedExpenseAccountId, selectedReceiptAccountId, selectedTransferAccountId]);

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
          language === 'es' ? 'Presupuesto excedido' : 'Budget exceeded',
          language === 'es'
          ? `La categoria "${categoryLabel}" supero el presupuesto.\nRestante: ${formatCurrency(remaining, language, numberFormat)}`
            : `Category "${categoryLabel}" exceeded the budget.\nRemaining: ${formatCurrency(remaining, language, numberFormat)}`
        );
        continue;
      }

      Alert.alert(
        language === 'es' ? 'Alerta de presupuesto' : 'Budget alert',
        language === 'es'
          ? `La categoria "${categoryLabel}" llego al ${warningLevel}% restante.`
          : `Category "${categoryLabel}" reached ${warningLevel}% remaining.`
      );
    }
  }, [budgets, currentMonthSpentByCategory, language, now]);

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
      Alert.alert(language === 'es' ? 'Campo requerido' : 'Required field', language === 'es' ? 'Ingresa una descripcion.' : 'Enter a description.');
      return;
    }

    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      Alert.alert(language === 'es' ? 'Cantidad invalida' : 'Invalid quantity', language === 'es' ? 'Ingresa una cantidad entera mayor que 0.' : 'Enter an integer quantity greater than 0.');
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(language === 'es' ? 'Monto invalido' : 'Invalid amount', language === 'es' ? 'Ingresa un monto numerico mayor que 0.' : 'Enter a numeric amount greater than 0.');
      return;
    }

    if (selectedExpenseAccountId == null) {
      Alert.alert(
        language === 'es' ? 'Cuenta requerida' : 'Account required',
        language === 'es'
          ? 'Selecciona la cuenta desde la que se pagaron los productos.'
          : 'Select the account used to pay these products.'
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedExpenseAccountId);
    if (!selectedAccount) {
      Alert.alert(language === 'es' ? 'Cuenta invalida' : 'Invalid account', language === 'es' ? 'La cuenta seleccionada no existe.' : 'Selected account does not exist.');
      return;
    }

    const manualLineTotal = Number((parsedQuantity * parsedAmount).toFixed(2));
    if (selectedAccount.balance < manualLineTotal) {
      Alert.alert(
        language === 'es' ? 'Fondos insuficientes' : 'Insufficient funds',
        language === 'es'
          ? `La cuenta "${selectedAccount.name}" no tiene saldo suficiente.\nSaldo actual: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nIntento de cobro: ${formatCurrency(manualLineTotal, language, numberFormat)}`
          : `Account "${selectedAccount.name}" has insufficient funds.\nCurrent balance: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nAttempted charge: ${formatCurrency(manualLineTotal, language, numberFormat)}`
      );
      return;
    }

    try {
      await createExpense(normalizedDescription, parsedQuantity, parsedAmount, selectedAccount.name);
      await createProduct(
        normalizedDescription,
        parsedQuantity,
        parsedAmount,
        manualLineTotal,
        undefined,
        manualCategory,
        selectedAccount.name
      );
      await updateAccountBalance(selectedAccount.id, Number((selectedAccount.balance - manualLineTotal).toFixed(2)));
      setDescription('');
      setQuantity('1');
      setAmount('');
      setManualCategory(FALLBACK_CATEGORY);
      await Promise.all([loadExpenses(), loadProducts(), loadAccounts()]);
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo guardar el gasto' : 'Could not save expense');
    }
  };

  const onPickInvoiceScreenshot = async () => {
    if (isPickingInvoiceImage) {
      return;
    }

    setIsPickingInvoiceImage(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          language === 'es' ? 'Permiso requerido' : 'Permission required',
          language === 'es'
            ? permission.canAskAgain
              ? 'Activa permisos de galeria para cargar la captura.'
              : 'Debes habilitar el permiso de galeria desde Ajustes del telefono.'
            : permission.canAskAgain
              ? 'Enable gallery permissions to load the screenshot.'
              : 'You must enable gallery permission from your phone settings.'
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

      const imageUri = result.assets[0].uri;
      setReceiptImageUri(imageUri);
      setOcrText('');
      setReceiptAnalysis(null);

      try {
        const ocrResult = await readTextFromImageLocal(imageUri);
        setOcrText(ocrResult.text);
      } catch (error) {
        Alert.alert(
          language === 'es' ? 'Lectura de factura' : 'Receipt reading',
          error instanceof Error
            ? language === 'es'
              ? `${error.message}\n\nPuedes continuar: pega el texto detectado y presiona "${t.analyzeReceipt}".`
              : `${error.message}\n\nYou can continue: paste the detected text and press "${t.analyzeReceipt}".`
            : language === 'es'
              ? 'No se pudo leer la factura'
              : 'Could not read the receipt'
        );
      }
    } finally {
      setIsPickingInvoiceImage(false);
    }
  };

  const onAnalyzeReceipt = () => {
    const analysis = analyzeReceiptText(ocrText);
    const fallbackTotal = extractReceiptTotal(ocrText);
    const useUnnamedFallback =
      fallbackTotal > 0 && shouldUseUnnamedReceiptFallback(ocrText, analysis);

    if (analysis.items.length > 0 && !useUnnamedFallback) {
      setReceiptAnalysis(analysis);
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
      });

      Alert.alert(
        language === 'es' ? 'Solo total detectado' : 'Only total detected',
        language === 'es'
          ? 'No se detectaron productos con nombre. Se usara unicamente el monto como "Recibo sin nombre".'
          : 'No named products were detected. Only the amount will be saved as "Recibo sin nombre".'
      );
      return;
    }

    setReceiptAnalysis(null);
    Alert.alert(
      language === 'es' ? 'Sin productos detectados' : 'No products detected',
      language === 'es'
        ? 'No se detectaron lineas de productos ni total. Corrige o pega el texto de la imagen y reintenta.'
        : 'No product lines or total were detected. Fix or paste image text and try again.'
    );
  };

  const onSaveDetectedProducts = async () => {
    if (!receiptAnalysis || receiptAnalysis.items.length === 0) {
      Alert.alert(
        language === 'es' ? 'Sin datos' : 'No data',
        language === 'es'
          ? 'Primero analiza la factura para obtener productos.'
          : 'Analyze the receipt first to get products.'
      );
      return;
    }

    if (selectedReceiptAccountId == null) {
      Alert.alert(
        language === 'es' ? 'Cuenta requerida' : 'Account required',
        language === 'es'
          ? 'Selecciona la cuenta desde la que se pago esta factura.'
          : 'Select the account used to pay this receipt.'
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedReceiptAccountId);
    if (!selectedAccount) {
      Alert.alert(
        language === 'es' ? 'Cuenta invalida' : 'Invalid account',
        language === 'es' ? 'La cuenta seleccionada no existe.' : 'Selected account does not exist.'
      );
      return;
    }

    const receiptTotal = Number(receiptAnalysis.totalAmount.toFixed(2));
    if (receiptTotal <= 0) {
      Alert.alert(
        language === 'es' ? 'Sin datos' : 'No data',
        language === 'es'
          ? 'No se detecto un monto valido en la captura.'
          : 'No valid amount was detected in the capture.'
      );
      return;
    }

    if (selectedAccount.balance < receiptTotal) {
      Alert.alert(
        language === 'es' ? 'Fondos insuficientes' : 'Insufficient funds',
        language === 'es'
          ? `La cuenta "${selectedAccount.name}" no tiene saldo suficiente.\nSaldo actual: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nIntento de cobro: ${formatCurrency(receiptTotal, language, numberFormat)}`
          : `Account "${selectedAccount.name}" has insufficient funds.\nCurrent balance: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nAttempted charge: ${formatCurrency(receiptTotal, language, numberFormat)}`
      );
      return;
    }

    try {
      await createProducts(receiptAnalysis.items, {
        categoryOverride: receiptCategory,
        accountName: selectedAccount.name,
      });
      await updateAccountBalance(
        selectedAccount.id,
        Number((selectedAccount.balance - receiptTotal).toFixed(2))
      );
      await Promise.all([loadProducts(), loadAccounts()]);
      Alert.alert(
        language === 'es' ? 'Guardado' : 'Saved',
        language === 'es'
          ? `${receiptAnalysis.items.length} productos agregados.`
          : `${receiptAnalysis.items.length} products added.`
      );
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudieron guardar los productos' : 'Could not save products');
    }
  };

  const onClearReceipt = () => {
    setReceiptImageUri(null);
    setOcrText('');
    setReceiptAnalysis(null);
  };

  const onClearTransferCapture = () => {
    setTransferImageUri(null);
    setTransferOcrText('');
    setTransferTotalAmount(0);
  };

  const onPickTransferScreenshot = async () => {
    if (isPickingTransferImage) {
      return;
    }

    setIsPickingTransferImage(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          language === 'es' ? 'Permiso requerido' : 'Permission required',
          language === 'es'
            ? permission.canAskAgain
              ? 'Activa permisos de galeria para cargar la captura.'
              : 'Debes habilitar el permiso de galeria desde Ajustes del telefono.'
            : permission.canAskAgain
              ? 'Enable gallery permissions to load the screenshot.'
              : 'You must enable gallery permission from your phone settings.'
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

      const imageUri = result.assets[0].uri;
      setTransferImageUri(imageUri);
      setTransferOcrText('');
      setTransferTotalAmount(0);

      try {
        const ocrResult = await readTextFromImageLocal(imageUri);
        setTransferOcrText(ocrResult.text);
        const autoDetectedTotal = extractTransferTotal(ocrResult.text);
        setTransferTotalAmount(autoDetectedTotal);
      } catch (error) {
        Alert.alert(
          language === 'es' ? 'Lectura de transferencia' : 'Transfer reading',
          error instanceof Error
            ? language === 'es'
              ? `${error.message}\n\nPuedes continuar: pega el texto detectado y presiona "Detectar monto total".`
              : `${error.message}\n\nYou can continue: paste detected text and press "Detect total amount".`
            : language === 'es'
              ? 'No se pudo leer la transferencia'
              : 'Could not read the transfer'
        );
      }
    } finally {
      setIsPickingTransferImage(false);
    }
  };

  const onAnalyzeTransferTotal = () => {
    const detectedTotal = extractTransferTotal(transferOcrText);
    setTransferTotalAmount(detectedTotal);

    if (detectedTotal > 0) {
      return;
    }

    Alert.alert(
      language === 'es' ? 'Sin monto total detectado' : 'No total amount detected',
      language === 'es'
        ? 'No se detecto "Monto total" con simbolo de colones en la captura. Corrige el texto OCR y reintenta.'
        : 'Could not detect "Total amount" with CRC symbol in the capture. Fix OCR text and retry.'
    );
  };

  const onApplyTransferFromCapture = async () => {
    if (!transferMode) {
      Alert.alert(
        language === 'es' ? 'Tipo de transferencia' : 'Transfer type',
        language === 'es'
          ? 'Selecciona si recibiste o hiciste una transferencia.'
          : 'Select whether you received or made a transfer.'
      );
      return;
    }

    if (selectedTransferAccountId == null) {
      Alert.alert(
        language === 'es' ? 'Cuenta requerida' : 'Account required',
        language === 'es'
          ? 'Selecciona la cuenta para aplicar la transferencia.'
          : 'Select the account to apply this transfer.'
      );
      return;
    }

    const selectedAccount = accounts.find((account) => account.id === selectedTransferAccountId);
    if (!selectedAccount) {
      Alert.alert(
        language === 'es' ? 'Cuenta invalida' : 'Invalid account',
        language === 'es' ? 'La cuenta seleccionada no existe.' : 'Selected account does not exist.'
      );
      return;
    }

    const totalToApply = Number(transferTotalAmount.toFixed(2));
    if (!Number.isFinite(totalToApply) || totalToApply <= 0) {
      Alert.alert(
        language === 'es' ? 'Monto invalido' : 'Invalid amount',
        language === 'es'
          ? 'No se detecto un "Monto total" valido en la captura.'
          : 'No valid "Total amount" was detected in the capture.'
      );
      return;
    }

    if (transferMode === 'sent' && selectedAccount.balance < totalToApply) {
      Alert.alert(
        language === 'es' ? 'Fondos insuficientes' : 'Insufficient funds',
        language === 'es'
          ? `La cuenta "${selectedAccount.name}" no tiene saldo suficiente.\nSaldo actual: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nIntento de rebajo: ${formatCurrency(totalToApply, language, numberFormat)}`
          : `Account "${selectedAccount.name}" has insufficient funds.\nCurrent balance: ${formatCurrency(
              selectedAccount.balance,
              language,
              numberFormat
            )}\nAttempted deduction: ${formatCurrency(totalToApply, language, numberFormat)}`
      );
      return;
    }

    const nextBalance =
      transferMode === 'received'
        ? Number((selectedAccount.balance + totalToApply).toFixed(2))
        : Number((selectedAccount.balance - totalToApply).toFixed(2));

    try {
      await updateAccountBalance(selectedAccount.id, nextBalance);
      if (transferMode === 'received') {
        await createIncomeEntry('transfer_received', totalToApply, selectedAccount.name);
        await Promise.all([loadAccounts(), loadIncomeEntries()]);
      } else {
        await loadAccounts();
      }
      Alert.alert(
        language === 'es' ? 'Transferencia aplicada' : 'Transfer applied',
        language === 'es'
          ? `Se ${transferMode === 'received' ? 'sumo' : 'resto'} ${formatCurrency(
              totalToApply,
              language,
              numberFormat
            )} en "${selectedAccount.name}".`
          : `${formatCurrency(totalToApply, language, numberFormat)} was ${transferMode === 'received' ? 'added to' : 'subtracted from'} "${selectedAccount.name}".`
      );
      onClearTransferCapture();
    } catch (error) {
      Alert.alert(
        language === 'es' ? 'Error' : 'Error',
        error instanceof Error
          ? error.message
          : language === 'es'
            ? 'No se pudo aplicar la transferencia'
            : 'Could not apply transfer'
      );
    }
  };

  const onSelectPrediction = (name: string) => {
    setProductQuery(name);
  };

  const onClearFilters = () => {
    setSelectedYear('all');
    setSelectedMonth('all');
    setProductQuery('');
  };

  const onDeleteProduct = (productId: number) => {
    Alert.alert(language === 'es' ? 'Eliminar producto' : 'Delete product', language === 'es' ? 'Este producto se eliminara de la lista. ¿Deseas continuar?' : 'This product will be removed from the list. Continue?', [
      { text: language === 'es' ? 'Cancelar' : 'Cancel', style: 'cancel' },
      {
        text: language === 'es' ? 'Eliminar' : 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProductById(productId);
            await loadProducts();
          } catch (error) {
            Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo eliminar el producto' : 'Could not delete product');
          }
        },
      },
    ]);
  };

  const onAddCategory = async () => {
    const normalizedName = newCategoryName.trim().toLowerCase();
    if (!normalizedName) {
      Alert.alert(language === 'es' ? 'Categoria invalida' : 'Invalid category', language === 'es' ? 'Ingresa un nombre de categoria.' : 'Enter a category name.');
      return;
    }

    try {
      await addCategory(normalizedName);
      await loadCategories();
      setManualCategory(normalizedName);
      setNewCategoryName('');
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo crear la categoria' : 'Could not create category');
    }
  };

  const onDeleteSelectedCategory = () => {
    if (manualCategory === FALLBACK_CATEGORY) {
      Alert.alert(
        language === 'es' ? 'Categoria protegida' : 'Protected category',
        language === 'es' ? 'No se puede eliminar la categoria "varios".' : 'You cannot delete the "varios" category.'
      );
      return;
    }

    Alert.alert(
      language === 'es' ? 'Eliminar categoria' : 'Delete category',
      language === 'es'
        ? `Se eliminara "${manualCategory}" y sus productos pasaran a "varios".`
        : `"${manualCategory}" will be deleted and its products moved to "varios".`,
      [
      { text: language === 'es' ? 'Cancelar' : 'Cancel', style: 'cancel' },
      {
        text: language === 'es' ? 'Eliminar' : 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(manualCategory);
            await Promise.all([loadCategories(), loadProducts()]);
            setManualCategory(FALLBACK_CATEGORY);
          } catch (error) {
            Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo eliminar la categoria' : 'Could not delete category');
          }
        },
      },
    ]
    );
  };

  const onChangeLanguage = async (nextLanguage: AppLanguage) => {
    try {
      setLanguage(nextLanguage);
      await saveLanguage(nextLanguage);
    } catch (error) {
      Alert.alert('Error', nextLanguage === 'es' ? 'No se pudo guardar el idioma.' : 'Could not save language preference.');
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
        'Error',
        language === 'es' ? 'No se pudo guardar el tema.' : 'Could not save theme preference.'
      );
    }
  };

  const onChangeNumberFormat = async (nextFormat: AppNumberFormat) => {
    if (nextFormat === numberFormat) {
      return;
    }

    try {
      setNumberFormat(nextFormat);
      await saveNumberFormat(nextFormat);
    } catch (error) {
      Alert.alert(
        'Error',
        language === 'es' ? 'No se pudo guardar el formato numerico.' : 'Could not save number format.'
      );
    }
  };

  const onContactPress = async () => {
    const mailToUrl = 'mailto:sebasretana27@gmail.com';
    const canOpen = await Linking.canOpenURL(mailToUrl);
    if (!canOpen) {
      Alert.alert(
        language === 'es' ? 'No disponible' : 'Unavailable',
        language === 'es'
          ? 'No se pudo abrir la app de correo en este dispositivo.'
          : 'Could not open the email app on this device.'
      );
      return;
    }

    await Linking.openURL(mailToUrl);
  };

  const onAddAccount = async () => {
    const normalizedName = accountName.trim();
    const parsedBalance = parseAmountInput(accountBalanceInput || '0');
    const normalizedColor = normalizeHexColor(selectedAccountColor);

    if (!normalizedName) {
      Alert.alert(language === 'es' ? 'Cuenta invalida' : 'Invalid account', language === 'es' ? 'Ingresa el nombre de la cuenta.' : 'Enter account name.');
      return;
    }

    if (!Number.isFinite(parsedBalance)) {
      Alert.alert(language === 'es' ? 'Saldo invalido' : 'Invalid balance', language === 'es' ? 'Ingresa un saldo inicial valido.' : 'Enter a valid initial balance.');
      return;
    }

    if (!normalizedColor) {
      Alert.alert(
        language === 'es' ? 'Color invalido' : 'Invalid color',
        language === 'es'
          ? 'Selecciona un color valido.'
          : 'Select a valid color.'
      );
      return;
    }

    try {
      await createAccount(normalizedName, parsedBalance, normalizedColor);
      await loadAccounts();
      setAccountName('');
      setAccountBalanceInput('');
      setSelectedAccountColor(ALL_COLOR_OPTIONS[0]);
      setIsNewAccountColorTableVisible(false);
      setIsNewAccountModalVisible(false);
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo crear la cuenta' : 'Could not create account');
    }
  };

  const onSaveBudget = async (): Promise<boolean> => {
    if (usedBudgetCategorySet.has(budgetCategory)) {
      Alert.alert(language === 'es' ? 'Categoria en uso' : 'Category in use', t.budgetCategoryInUse);
      return false;
    }

    const parsedAmount = parseAmountInput(budgetAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      Alert.alert(
        language === 'es' ? 'Monto invalido' : 'Invalid amount',
        language === 'es'
          ? 'Ingresa un presupuesto valido (0 o mayor).'
          : 'Enter a valid budget amount (0 or greater).'
      );
      return false;
    }

    try {
      await upsertBudget(budgetCategory, Number(parsedAmount.toFixed(2)));
      setBudgetAmountInput('');
      await loadBudgets();
      return true;
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo guardar el presupuesto' : 'Could not save budget');
      return false;
    }
  };

  const onAdjustBudget = async (category: string, operator: 1 | -1) => {
    const parsedAmount = parseAmountInput(budgetDeltaInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(
        language === 'es' ? 'Monto invalido' : 'Invalid amount',
        language === 'es'
          ? 'Ingresa un ajuste mayor que 0.'
          : 'Enter an adjustment greater than 0.'
      );
      return;
    }

    try {
      await changeBudgetAmount(category, operator * parsedAmount);
      setBudgetDeltaInput('');
      await loadBudgets();
      setIsBudgetAdjustModalVisible(false);
      setSelectedBudgetCategoryForAdjust(null);
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo ajustar el presupuesto' : 'Could not adjust budget');
    }
  };

  const onDeleteBudget = (category: string) => {
    Alert.alert(
      language === 'es' ? 'Eliminar presupuesto' : 'Delete budget',
      language === 'es'
        ? `Se eliminara el presupuesto de "${getCategoryLabel(category, language)}".`
        : `Budget for "${getCategoryLabel(category, language)}" will be deleted.`,
      [
        { text: language === 'es' ? 'Cancelar' : 'Cancel', style: 'cancel' },
        {
          text: language === 'es' ? 'Eliminar' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBudget(category);
              await loadBudgets();
            } catch (error) {
              Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo eliminar el presupuesto' : 'Could not delete budget');
            }
          },
        },
      ]
    );
  };

  const onSaveCategoryColor = async (color: string) => {
    if (!colorCategory) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', t.selectCategoryFirst);
      return;
    }

    try {
      await upsertCategoryColor(colorCategory, color);
      await loadCategoryColors();
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo guardar el color' : 'Could not save category color');
    }
  };

  const onApplyAccountMovement = async (account: Account, operator: 1 | -1, amountInput: string) => {
    const movement = parseAmountInput(amountInput);
    if (!Number.isFinite(movement) || movement <= 0) {
      Alert.alert(language === 'es' ? 'Monto invalido' : 'Invalid amount', language === 'es' ? 'Ingresa un monto de movimiento mayor que 0.' : 'Enter a movement amount greater than 0.');
      return;
    }

    const updatedBalance = Number((account.balance + operator * movement).toFixed(2));
    if (updatedBalance < 0) {
      Alert.alert(
        language === 'es' ? 'Fondos insuficientes' : 'Insufficient funds',
        language === 'es'
          ? `No puedes restar ${formatCurrency(movement, language, numberFormat)} porque la cuenta "${account.name}" solo tiene ${formatCurrency(
              account.balance,
              language,
              numberFormat
            )}.`
          : `You cannot subtract ${formatCurrency(movement, language, numberFormat)} because account "${account.name}" only has ${formatCurrency(
              account.balance,
              language,
              numberFormat
            )}.`
      );
      return;
    }

    try {
      await updateAccountBalance(account.id, updatedBalance);
      if (operator === 1) {
        await createIncomeEntry('manual_add', movement, account.name);
        await Promise.all([loadAccounts(), loadIncomeEntries()]);
      } else {
        await loadAccounts();
      }
      setAccountActionAmount('');
      setAccountActionType(null);
      setIsAccountActionModalVisible(false);
      setSelectedAccountForAction(null);
    } catch (error) {
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo actualizar la cuenta' : 'Could not update account');
    }
  };

  const onPressAccount = (account: Account) => {
    setSelectedAccountForAction(account);
    setAccountActionType(null);
    setAccountActionAmount('');
    setIsAccountEditColorTableVisible(false);
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
      Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo actualizar el color' : 'Could not update color');
    }
  };

  const onDeleteSelectedAccount = () => {
    if (!selectedAccountForAction) {
      return;
    }

    Alert.alert(
      language === 'es' ? 'Eliminar cuenta' : 'Delete account',
      language === 'es'
        ? `Se eliminara la cuenta "${selectedAccountForAction.name}".`
        : `Account "${selectedAccountForAction.name}" will be deleted.`,
      [
        { text: language === 'es' ? 'Cancelar' : 'Cancel', style: 'cancel' },
        {
          text: language === 'es' ? 'Eliminar' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccountById(selectedAccountForAction.id);
              await loadAccounts();
              setIsAccountActionModalVisible(false);
              setSelectedAccountForAction(null);
              setAccountActionType(null);
              setAccountActionAmount('');
              Alert.alert(language === 'es' ? 'Listo' : 'Done', t.accountDeleted);
            } catch (error) {
              Alert.alert(language === 'es' ? 'Error' : 'Error', error instanceof Error ? error.message : language === 'es' ? 'No se pudo eliminar la cuenta' : 'Could not delete account');
            }
          },
        },
      ]
    );
  };

  const onConfirmAccountAction = async () => {
    if (!selectedAccountForAction || !accountActionType) {
      return;
    }

    const operator: 1 | -1 = accountActionType === 'add' ? 1 : -1;
    await onApplyAccountMovement(selectedAccountForAction, operator, accountActionAmount);
  };

  const renderColorTable = (
    selectedColor: string | null,
    onSelect: (color: string) => void,
    keyPrefix: string
  ) => {
    return (
      <View style={styles.colorTableWrap}>
        {COLOR_GROUPS.map((group) => (
          <View key={`${keyPrefix}-${group.key}`} style={styles.colorGroup}>
            <Text style={styles.colorGroupLabel}>{language === 'es' ? group.labelEs : group.labelEn}</Text>
            <View style={styles.colorGroupRow}>
              {group.colors.map((color) => (
                <TouchableOpacity
                  key={`${keyPrefix}-${group.key}-${color}`}
                  style={[
                    styles.colorChip,
                    { backgroundColor: color },
                    selectedColor === color ? styles.colorChipActive : undefined,
                  ]}
                  onPress={() => onSelect(color)}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const chartSize = 220;
  const chartStroke = 24;
  const chartRadius = (chartSize - chartStroke) / 2;
  const chartCircumference = 2 * Math.PI * chartRadius;
  const darkModeChartTrack = '#6b7280';
  const darkModeChartSlice = '#d1d5db';
  const chartTrackColor = themeMode === 'dark' ? darkModeChartTrack : theme.borderStrong;
  const getChartSliceColor = (category: string) =>
    themeMode === 'dark' ? darkModeChartSlice : (categoryColorMap[category] ?? '#94a3b8');
  const expenseTabsHintTrackWidth = 56;
  const expenseTabsHintThumbWidth = Math.max(
    14,
    Math.min(expenseTabsHintTrackWidth * 0.8, (expenseTabsViewportWidth / expenseTabsContentWidth) * expenseTabsHintTrackWidth)
  );
  const expenseTabsHintThumbTranslate =
    (expenseTabsHintTrackWidth - expenseTabsHintThumbWidth) * expenseTabsScrollRatio;
  const statusBarStyle = themeMode === 'light' ? 'dark' : 'light';
  const productsByMonthCard = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t.productsByMonth}</Text>
      <View style={styles.filterWrap}>
        <Text style={styles.filterLabel}>{t.filterYear}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {yearOptions.map((year) => (
            <TouchableOpacity
              key={year}
              style={[styles.filterChip, selectedYear === year ? styles.filterChipActive : undefined]}
              onPress={() => setSelectedYear(year)}
            >
              <Text style={[styles.filterChipText, selectedYear === year ? styles.filterChipTextActive : undefined]}>
                {year === 'all' ? 'Todos' : year}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>{t.filterMonth}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {monthOptions.map((month) => (
            <TouchableOpacity
              key={month.value}
              style={[styles.filterChip, selectedMonth === month.value ? styles.filterChipActive : undefined]}
              onPress={() => setSelectedMonth(month.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedMonth === month.value ? styles.filterChipTextActive : undefined,
                ]}
              >
                {month.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>{t.filterSearch}</Text>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>?</Text>
          <TextInput
            value={productQuery}
            onChangeText={setProductQuery}
            placeholder={t.searchPlaceholder}
            placeholderTextColor={theme.placeholder}
            style={styles.searchInput}
          />
        </View>

        {normalizedQuery && predictions.length > 0 ? (
          <View style={styles.predictionList}>
            {predictions.map((prediction) => (
              <TouchableOpacity
                key={prediction.name}
                style={styles.predictionItem}
                onPress={() => onSelectPrediction(prediction.name)}
              >
                <Text style={styles.predictionText}>{prediction.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TouchableOpacity style={styles.secondaryButton} onPress={onClearFilters}>
          <Text style={styles.secondaryButtonText}>{t.clearFilters}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.loading}>{t.loadingData}</Text>
      ) : groupedProducts.length === 0 ? (
        <Text style={styles.empty}>{t.noProductsForFilters}</Text>
      ) : (
        groupedProducts.map((group) => (
          <View key={group.monthKey} style={styles.monthGroup}>
            <Text style={styles.monthTitle}>{group.monthLabel}</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t.total}</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(group.items.reduce((sum, item) => sum + item.lineTotal, 0), language, numberFormat)}
              </Text>
            </View>

            {group.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemTextWrap}>
                  <Text style={styles.itemDesc}>{item.name}</Text>
                  <Text style={styles.itemDate}>{t.quantity}: {item.quantity}</Text>
                  <Text style={styles.itemDate}>{t.account}: {item.accountName || t.noAccount}</Text>
                  <Text style={styles.itemDate}>{formatDateTime(item.createdAt, dateLocale)}</Text>
                </View>
                <View style={styles.productActionWrap}>
                  <Text style={styles.itemAmount}>{formatCurrency(item.unitPrice, language, numberFormat)}</Text>
                  <TouchableOpacity style={styles.deleteTableButton} onPress={() => onDeleteProduct(item.id)}>
                    <Text style={styles.deleteTableButtonText}>{t.delete}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={statusBarStyle} />
      <Animated.View style={[styles.mainContent, { opacity: themeOpacity }]}>
        <View style={styles.sectionAnimatedWrap}>
          <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.menuButton} onPress={openDrawer}>
              <Text style={styles.menuIcon}>☰</Text>
            </TouchableOpacity>
            <Text style={styles.title}>MyFinance</Text>
          </View>
          {activeSection !== 'inicio' ? (
            <Text style={styles.subtitle}>
              {activeSection === 'gastos'
                ? t.subtitleGastos
                : activeSection === 'transacciones'
                  ? t.subtitleTransacciones
                : activeSection === 'cuentas'
                  ? ''
                  : activeSection === 'configuracion'
                    ? t.subtitleConfig
                    : ''}
            </Text>
          ) : null}

          {activeSection === 'inicio' ? (
            <>
              <View style={styles.topSummaryRow}>
                <View style={styles.leftSummaryColumn}>
                  <View style={[styles.accountsTotalCard, styles.leftSummaryCard]}>
                    <Text style={styles.accountsTotalLabel}>{t.antExpense}</Text>
                    <Text style={styles.hormigaName}>{topVariosProduct ? topVariosProduct.name : t.noData}</Text>
                    <Text style={styles.accountsTotalValue}>
                      {topVariosProduct ? formatCurrency(topVariosProduct.totalAmount, language, numberFormat) : formatCurrency(0, language, numberFormat)}
                    </Text>
                  </View>

                  <View style={[styles.accountsTotalCard, styles.leftSummaryCard]}>
                    <Text style={styles.accountsTotalLabel}>{t.transport}</Text>
                    <Text style={styles.accountsTotalValue}>{formatCurrency(currentMonthTransportTotal, language, numberFormat)}</Text>
                  </View>
                </View>

                <View style={[styles.accountsTotalCard, styles.rightSummaryCard]}>
                  <Text style={styles.accountsTotalLabel}>{t.totalAccounts}</Text>
                  <Text style={styles.accountsTotalValue}>{formatCurrency(totalAccountsBalance, language, numberFormat)}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t.spendingStructure}</Text>
                <Text style={styles.helpText}>{capitalize(currentMonthLabel)}</Text>

                <View style={styles.chartWrap}>
                  {currentMonthTotal > 0 ? (
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
                                key={`${slice.category}-${index}`}
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
                  ) : (
                    <View style={[styles.emptyChart, { borderColor: chartTrackColor }]}></View>
                  )}
                  <View style={styles.chartCenter}>
                    <Text style={styles.chartCenterValue}>{formatCurrency(currentMonthTotal, language, numberFormat)}</Text>
                  </View>
                </View>

                {monthlyCategorySlices.length > 0 ? (
                  <View style={styles.legendWrap}>
                    {monthlyCategorySlices.map((slice) => (
                      <View key={slice.category} style={styles.legendRow}>
                        <View style={[styles.legendDot, { backgroundColor: getChartSliceColor(slice.category) }]} />
                        <Text style={styles.legendText}>{getCategoryLabel(slice.category, language)}</Text>
                        <Text style={styles.legendValue}>
                          {slice.percentage.toFixed(1)}% ({formatCurrency(slice.total, language, numberFormat)})
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

            </>
          ) : null}

          {activeSection === 'gastos' ? (
            <>
              <View style={styles.expenseTopTabs}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.expenseTopTabsScrollContent}
                  onLayout={(event) => setExpenseTabsViewportWidth(event.nativeEvent.layout.width)}
                  onContentSizeChange={(width) => setExpenseTabsContentWidth(width)}
                  onScroll={(event) => {
                    const scrollX = event.nativeEvent.contentOffset.x;
                    const viewportWidth = Math.max(1, event.nativeEvent.layoutMeasurement.width);
                    const contentWidth = Math.max(1, event.nativeEvent.contentSize.width);
                    const maxScroll = Math.max(0, contentWidth - viewportWidth);
                    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollX / maxScroll)) : 0;
                    setExpenseTabsViewportWidth(viewportWidth);
                    setExpenseTabsContentWidth(contentWidth);
                    setExpenseTabsScrollRatio(ratio);
                  }}
                  scrollEventThrottle={16}
                >
                  <TouchableOpacity
                    style={[styles.expenseTopTab, gastosTopTab === 'manual' ? styles.expenseTopTabActive : undefined]}
                    onPress={() => setGastosTopTab('manual')}
                  >
                    <Text style={[styles.expenseTopTabText, gastosTopTab === 'manual' ? styles.expenseTopTabTextActive : undefined]}>
                      {t.tabManualExpense}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.expenseTopTab, gastosTopTab === 'receipt' ? styles.expenseTopTabActive : undefined]}
                    onPress={() => setGastosTopTab('receipt')}
                  >
                    <Text style={[styles.expenseTopTabText, gastosTopTab === 'receipt' ? styles.expenseTopTabTextActive : undefined]}>
                      {t.tabUploadReceipt}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.expenseTopTab, gastosTopTab === 'transfer' ? styles.expenseTopTabActive : undefined]}
                    onPress={() => setGastosTopTab('transfer')}
                  >
                    <Text style={[styles.expenseTopTabText, gastosTopTab === 'transfer' ? styles.expenseTopTabTextActive : undefined]}>
                      {t.tabTransfer}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.expenseTopTab, gastosTopTab === 'total' ? styles.expenseTopTabActive : undefined]}
                    onPress={() => setGastosTopTab('total')}
                  >
                    <Text style={[styles.expenseTopTabText, gastosTopTab === 'total' ? styles.expenseTopTabTextActive : undefined]}>
                      {t.tabTotal}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.expenseTopTab, gastosTopTab === 'income_added' ? styles.expenseTopTabActive : undefined]}
                    onPress={() => setGastosTopTab('income_added')}
                  >
                    <Text style={[styles.expenseTopTabText, gastosTopTab === 'income_added' ? styles.expenseTopTabTextActive : undefined]}>
                      {t.tabIncomeAdded}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
                <View style={styles.expenseTopTabsHintTrack}>
                  <View
                    style={[
                      styles.expenseTopTabsHintThumb,
                      { width: expenseTabsHintThumbWidth, transform: [{ translateX: expenseTabsHintThumbTranslate }] },
                    ]}
                  />
                </View>
              </View>
              {gastosTopTab === 'receipt' ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t.uploadReceipt}</Text>
                <TouchableOpacity
                  style={[styles.primaryButton, isPickingInvoiceImage ? styles.primaryButtonDisabled : undefined]}
                  onPress={onPickInvoiceScreenshot}
                  disabled={isPickingInvoiceImage}
                >
                  <Text style={styles.primaryButtonText}>
                    {isPickingInvoiceImage
                      ? language === 'es'
                        ? 'Abriendo galeria...'
                        : 'Opening gallery...'
                      : t.pickScreenshot}
                  </Text>
                </TouchableOpacity>

                {receiptImageUri ? (
                  <TouchableOpacity style={styles.clearButton} onPress={onClearReceipt}>
                    <Text style={styles.clearButtonText}>{t.removeScreenshot}</Text>
                  </TouchableOpacity>
                ) : null}

                {receiptImageUri ? <Image source={{ uri: receiptImageUri }} style={styles.previewImage} /> : null}

                <Text style={styles.helpText}>{t.receiptHelp}</Text>
                <Text style={styles.filterLabel}>{t.category}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((category) => (
                    <TouchableOpacity
                      key={`receipt-${category}`}
                      style={[styles.filterChip, receiptCategory === category ? styles.filterChipActive : undefined]}
                      onPress={() => setReceiptCategory(category)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          receiptCategory === category ? styles.filterChipTextActive : undefined,
                        ]}
                      >
                        {getCategoryLabel(category, language)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.filterLabel}>{t.account}</Text>
                {accounts.length === 0 ? (
                  <Text style={styles.helpText}>{t.createAccountFirst}</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {accounts.map((account) => (
                      <TouchableOpacity
                        key={`receipt-account-${account.id}`}
                        style={[
                          styles.filterChip,
                          selectedReceiptAccountId === account.id ? styles.filterChipActive : undefined,
                        ]}
                        onPress={() => setSelectedReceiptAccountId(account.id)}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            selectedReceiptAccountId === account.id ? styles.filterChipTextActive : undefined,
                          ]}
                        >
                          {account.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                <TextInput
                  multiline
                  value={ocrText}
                  onChangeText={setOcrText}
                  style={styles.ocrInput}
                  placeholder={
                    'Ejemplo:\n2 x Leche Entera 1.25\nPan Integral 2.40\nArroz x3 0.90\n'
                  }
                  placeholderTextColor={theme.placeholder}
                  textAlignVertical="top"
                />

                <TouchableOpacity style={styles.secondaryButton} onPress={onAnalyzeReceipt}>
                  <Text style={styles.secondaryButtonText}>{t.analyzeReceipt}</Text>
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
                      <Text style={styles.summaryValue}>{formatCurrency(receiptAnalysis.totalAmount, language, numberFormat)}</Text>
                    </View>

                    <TouchableOpacity style={styles.primaryButton} onPress={onSaveDetectedProducts}>
                      <Text style={styles.primaryButtonText}>{t.saveDetectedProducts}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
              ) : null}

              {gastosTopTab === 'manual' ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t.manualExpense}</Text>
                <TextInput
                  placeholder={t.productName}
                  value={description}
                  onChangeText={setDescription}
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <TextInput
                  placeholder={t.quantity}
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <Text style={styles.filterLabel}>{t.category}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((category) => (
                    <TouchableOpacity
                      key={`manual-${category}`}
                      style={[styles.filterChip, manualCategory === category ? styles.filterChipActive : undefined]}
                      onPress={() => setManualCategory(category)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          manualCategory === category ? styles.filterChipTextActive : undefined,
                        ]}
                      >
                        {getCategoryLabel(category, language)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.filterLabel}>{t.account}</Text>
                {accounts.length === 0 ? (
                  <Text style={styles.helpText}>{t.createAccountFirst}</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {accounts.map((account) => (
                      <TouchableOpacity
                        key={`expense-account-${account.id}`}
                        style={[
                          styles.filterChip,
                          selectedExpenseAccountId === account.id ? styles.filterChipActive : undefined,
                        ]}
                        onPress={() => setSelectedExpenseAccountId(account.id)}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            selectedExpenseAccountId === account.id ? styles.filterChipTextActive : undefined,
                          ]}
                        >
                          {account.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <TextInput
                  placeholder={t.newCategory}
                  value={newCategoryName}
                  onChangeText={setNewCategoryName}
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <View style={styles.categoryActionRow}>
                  <TouchableOpacity style={styles.secondaryButtonCompact} onPress={onAddCategory}>
                    <Text style={styles.secondaryButtonText}>{t.addCategory}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteCategoryButton} onPress={onDeleteSelectedCategory}>
                    <Text style={styles.deleteCategoryButtonText}>{t.deleteCategory}</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  placeholder={t.amount}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />

                <TouchableOpacity style={styles.primaryButton} onPress={onSaveExpense}>
                  <Text style={styles.primaryButtonText}>{t.saveExpense}</Text>
                </TouchableOpacity>
              </View>
              ) : null}

              {gastosTopTab === 'total' ? (
              <View style={styles.card}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{t.total}</Text>
                  <Text style={styles.totalValue}>{formatCurrency(total, language, numberFormat)}</Text>
                </View>

                {loading ? (
                  <Text style={styles.loading}>{t.loadingData}</Text>
                ) : (
                  <FlatList
                    data={expenses}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                      <View style={styles.itemRow}>
                        <View style={styles.itemTextWrap}>
                          <Text style={styles.itemDesc}>{item.description}</Text>
                          <Text style={styles.itemDate}>{t.quantity}: {item.quantity}</Text>
                          <Text style={styles.itemDate}>{t.account}: {item.accountName || t.noAccount}</Text>
                          <Text style={styles.itemDate}>{formatDateTime(item.createdAt, dateLocale)}</Text>
                        </View>
                        <Text style={styles.itemAmount}>{formatCurrency(item.amount, language, numberFormat)}</Text>
                      </View>
                    )}
                    scrollEnabled={false}
                    ListEmptyComponent={<Text style={styles.empty}>{t.noExpenses}</Text>}
                    contentContainerStyle={expenses.length === 0 ? styles.emptyWrap : undefined}
                  />
                )}
              </View>
              ) : null}

              {gastosTopTab === 'income_added' ? (
              <View style={styles.card}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{t.tabIncomeAdded}</Text>
                  <Text style={styles.totalValue}>{formatCurrency(totalIncomeAdded, language, numberFormat)}</Text>
                </View>

                {loading ? (
                  <Text style={styles.loading}>{t.loadingData}</Text>
                ) : (
                  <FlatList
                    data={incomeEntries}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                      <View style={styles.itemRow}>
                        <View style={styles.itemTextWrap}>
                          <Text style={styles.itemDesc}>{getIncomeSourceLabel(item.source, language)}</Text>
                          <Text style={styles.itemDate}>{t.account}: {item.accountName || t.noAccount}</Text>
                          <Text style={styles.itemDate}>{formatDateTime(item.createdAt, dateLocale)}</Text>
                        </View>
                        <Text style={styles.itemAmount}>{formatCurrency(item.amount, language, numberFormat)}</Text>
                      </View>
                    )}
                    scrollEnabled={false}
                    ListEmptyComponent={<Text style={styles.empty}>{t.noIncomeEntries}</Text>}
                    contentContainerStyle={incomeEntries.length === 0 ? styles.emptyWrap : undefined}
                  />
                )}
              </View>
              ) : null}

              {gastosTopTab === 'transfer' ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t.tabTransfer}</Text>
                    <View style={styles.modalOptionRow}>
                      <TouchableOpacity
                        style={[
                          styles.secondaryButtonCompact,
                          transferMode === 'received' ? styles.filterChipActive : undefined,
                        ]}
                        onPress={() => {
                          setTransferMode('received');
                          onClearTransferCapture();
                        }}
                      >
                        <Text style={styles.secondaryButtonText}>{t.transferReceived}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.deleteCategoryButton,
                          transferMode === 'sent' ? styles.filterChipActive : undefined,
                        ]}
                        onPress={() => {
                          setTransferMode('sent');
                          onClearTransferCapture();
                        }}
                      >
                        <Text style={styles.deleteCategoryButtonText}>{t.transferMade}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {transferMode ? (
                    <View style={styles.card}>
                      <TouchableOpacity
                        style={[styles.primaryButton, isPickingTransferImage ? styles.primaryButtonDisabled : undefined]}
                        onPress={onPickTransferScreenshot}
                        disabled={isPickingTransferImage}
                      >
                        <Text style={styles.primaryButtonText}>
                          {isPickingTransferImage
                            ? language === 'es'
                              ? 'Abriendo galeria...'
                              : 'Opening gallery...'
                            : t.pickScreenshot}
                        </Text>
                      </TouchableOpacity>

                      {transferImageUri ? (
                        <TouchableOpacity style={styles.clearButton} onPress={onClearTransferCapture}>
                          <Text style={styles.clearButtonText}>{t.removeScreenshot}</Text>
                        </TouchableOpacity>
                      ) : null}

                      {transferImageUri ? <Image source={{ uri: transferImageUri }} style={styles.previewImage} /> : null}

                      <Text style={styles.helpText}>
                        {language === 'es'
                          ? 'Se usara unicamente "Monto total" con simbolo de colones. Se ignoran telefono, cuenta, referencia, monto y comision.'
                          : 'Only "Total amount" with CRC symbol will be used. Phone, account, reference, amount and fee are ignored.'}
                      </Text>

                      <Text style={styles.filterLabel}>{t.account}</Text>
                      {accounts.length === 0 ? (
                        <Text style={styles.helpText}>{t.createAccountFirst}</Text>
                      ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                          {accounts.map((account) => (
                            <TouchableOpacity
                              key={`transfer-account-${account.id}`}
                              style={[
                                styles.filterChip,
                                selectedTransferAccountId === account.id ? styles.filterChipActive : undefined,
                              ]}
                              onPress={() => setSelectedTransferAccountId(account.id)}
                            >
                              <Text
                                style={[
                                  styles.filterChipText,
                                  selectedTransferAccountId === account.id ? styles.filterChipTextActive : undefined,
                                ]}
                              >
                                {account.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}

                      <TextInput
                        multiline
                        value={transferOcrText}
                        onChangeText={setTransferOcrText}
                        style={styles.ocrInput}
                        placeholder={
                          language === 'es'
                            ? 'Texto OCR de la transferencia (debe incluir "Monto total").'
                            : 'Transfer OCR text (must include "Total amount").'
                        }
                        placeholderTextColor={theme.placeholder}
                        textAlignVertical="top"
                      />

                      <TouchableOpacity style={styles.secondaryButton} onPress={onAnalyzeTransferTotal}>
                        <Text style={styles.secondaryButtonText}>
                          {language === 'es' ? 'Detectar monto total' : 'Detect total amount'}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>{language === 'es' ? 'Monto total detectado' : 'Detected total amount'}</Text>
                        <Text style={styles.summaryValue}>{formatCurrency(transferTotalAmount, language, numberFormat)}</Text>
                      </View>

                      <TouchableOpacity style={styles.primaryButton} onPress={onApplyTransferFromCapture}>
                        <Text style={styles.primaryButtonText}>
                          {transferMode === 'received'
                            ? language === 'es'
                              ? 'Agregar a cuenta'
                              : 'Add to account'
                            : language === 'es'
                              ? 'Restar de cuenta'
                              : 'Subtract from account'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {activeSection === 'transacciones' ? (
            <>
              {productsByMonthCard}
            </>
          ) : null}

          {activeSection === 'cuentas' ? (
            <>
              <View style={styles.card}>
                <View style={styles.accountsHeaderRow}>
                  <TouchableOpacity
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
                  {language === 'es'
                    ? 'Toca para agregar o restar ingresos'
                    : 'Tap to add or subtract income'}
                </Text>

                {loading ? (
                  <Text style={styles.loading}>{language === 'es' ? 'Cargando cuentas...' : 'Loading accounts...'}</Text>
                ) : accounts.length === 0 ? (
                  <Text style={styles.empty}>{language === 'es' ? 'Aun no hay cuentas creadas.' : 'No accounts created yet.'}</Text>
                ) : (
                  <View style={styles.accountGrid}>
                    {accounts.map((account) => (
                      <TouchableOpacity
                        key={account.id}
                        style={[styles.accountCard, { backgroundColor: account.color }]}
                        onPress={() => onPressAccount(account)}
                      >
                        <Text style={styles.accountName}>{account.name}</Text>
                        <Text style={styles.accountBalance}>{formatCurrency(account.balance, language, numberFormat)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : null}

          {activeSection === 'presupuesto' ? (
            <>
              <View style={styles.card}>
                <View style={styles.accountsHeaderRow}>
                  <TouchableOpacity
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
                        ? language === 'es'
                          ? 'Presupuesto excedido'
                          : 'Budget exceeded'
                        : warningLevel
                          ? language === 'es'
                            ? `Alerta: ${warningLevel}% restante`
                            : `Alert: ${warningLevel}% remaining`
                          : null;
                    return (
                      <View key={`budget-${budget.category}`} style={styles.itemRow}>
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
                          <Text style={styles.itemDate}>
                            {t.maxBudget}: {formatCurrency(budget.amount, language, numberFormat)}
                          </Text>
                          <Text style={styles.itemDate}>
                            {t.monthlySpent}: {formatCurrency(spent, language, numberFormat)}
                          </Text>
                          <Text style={[styles.itemDate, remaining <= 0 ? styles.negativeBudget : undefined]}>
                            {t.remainingBudget}: {formatCurrency(remaining, language, numberFormat)}
                          </Text>
                          {warningText ? (
                            <Text style={styles.budgetWarningText}>{warningText}</Text>
                          ) : null}
                        </View>
                        <View style={styles.productActionWrap}>
                          <TouchableOpacity
                            style={styles.deleteTableButton}
                            onPress={() => onDeleteBudget(budget.category)}
                          >
                            <Text style={styles.deleteTableButtonText}>{t.deleteBudget}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
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

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t.chartCategoryColors}</Text>
                <Text style={styles.filterLabel}>{t.category}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map((category) => (
                    <TouchableOpacity
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
                <TouchableOpacity
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
            <View style={styles.card}>
              <Text style={styles.filterLabel}>{t.reportError}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={onContactPress}>
                <Text style={styles.secondaryButtonText}>{t.contact}</Text>
              </TouchableOpacity>
              <Text style={styles.filterLabel}>{t.language}</Text>
              <View style={styles.languageRow}>
                <TouchableOpacity
                  style={[styles.filterChip, language === 'es' ? styles.filterChipActive : undefined]}
                  onPress={() => onChangeLanguage('es')}
                >
                  <Text style={[styles.filterChipText, language === 'es' ? styles.filterChipTextActive : undefined]}>
                    {t.spanish}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, language === 'en' ? styles.filterChipActive : undefined]}
                  onPress={() => onChangeLanguage('en')}
                >
                  <Text style={[styles.filterChipText, language === 'en' ? styles.filterChipTextActive : undefined]}>
                    {t.english}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.filterLabel}>{t.theme}</Text>
              <View style={styles.languageRow}>
                <TouchableOpacity
                  style={[styles.filterChip, themeMode === 'dark' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeTheme('dark')}
                >
                  <Text style={[styles.filterChipText, themeMode === 'dark' ? styles.filterChipTextActive : undefined]}>
                    {t.darkMode}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, themeMode === 'light' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeTheme('light')}
                >
                  <Text style={[styles.filterChipText, themeMode === 'light' ? styles.filterChipTextActive : undefined]}>
                    {t.lightMode}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, themeMode === 'original' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeTheme('original')}
                >
                  <Text style={[styles.filterChipText, themeMode === 'original' ? styles.filterChipTextActive : undefined]}>
                    {t.originalMode}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.filterLabel}>{t.numberFormat}</Text>
              <View style={styles.numberFormatRow}>
                <TouchableOpacity
                  style={[styles.filterChip, numberFormat === 'none' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeNumberFormat('none')}
                >
                  <Text style={[styles.filterChipText, numberFormat === 'none' ? styles.filterChipTextActive : undefined]}>
                    {t.numberFormatNone}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, numberFormat === 'comma' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeNumberFormat('comma')}
                >
                  <Text style={[styles.filterChipText, numberFormat === 'comma' ? styles.filterChipTextActive : undefined]}>
                    {t.numberFormatComma}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, numberFormat === 'dot_comma' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeNumberFormat('dot_comma')}
                >
                  <Text style={[styles.filterChipText, numberFormat === 'dot_comma' ? styles.filterChipTextActive : undefined]}>
                    {t.numberFormatDotComma}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, numberFormat === 'space_dot' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeNumberFormat('space_dot')}
                >
                  <Text style={[styles.filterChipText, numberFormat === 'space_dot' ? styles.filterChipTextActive : undefined]}>
                    {t.numberFormatSpaceDot}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, numberFormat === 'space_comma' ? styles.filterChipActive : undefined]}
                  onPress={() => void onChangeNumberFormat('space_comma')}
                >
                  <Text style={[styles.filterChipText, numberFormat === 'space_comma' ? styles.filterChipTextActive : undefined]}>
                    {t.numberFormatSpaceComma}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.configFooter}>
                <Text style={styles.configBuildText}>{t.buildNumber}</Text>
              </View>
            </View>
          ) : null}
          </ScrollView>
        </View>

        {isDrawerOpen ? (
          <Animated.View style={[styles.drawerOverlay, { opacity: drawerBackdropOpacity }]}>
            <TouchableOpacity style={styles.drawerBackdropTouch} onPress={closeDrawer} />
            <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: drawerTranslateX }] }]}>
              <Text style={styles.drawerTitle}>MyFinance</Text>
              <TouchableOpacity
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
              <TouchableOpacity
                style={[styles.drawerItem, activeSection === 'gastos' ? styles.drawerItemActive : undefined]}
                onPress={() => onChangeSection('gastos')}
              >
                <View style={styles.drawerItemRow}>
                  <Text style={[styles.drawerItemIcon, activeSection === 'gastos' ? styles.drawerItemTextActive : undefined]}>
                    {SECTION_SYMBOLS.gastos}
                  </Text>
                  <Text style={[styles.drawerItemText, activeSection === 'gastos' ? styles.drawerItemTextActive : undefined]}>
                    {t.navGastos}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
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
              <TouchableOpacity
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
              <TouchableOpacity
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
                    {t.navPresupuesto}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
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

      <Modal visible={isAccountActionModalVisible} transparent animationType="fade" onRequestClose={() => setIsAccountActionModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalCardScrollable} contentContainerStyle={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t.accountActions}</Text>
            <Text style={styles.helpText}>{selectedAccountForAction ? selectedAccountForAction.name : ''}</Text>

            <View style={styles.modalOptionRow}>
              <TouchableOpacity
                style={[
                  styles.secondaryButtonCompact,
                  accountActionType === 'add' ? styles.filterChipActive : undefined,
                ]}
                onPress={() => {
                  setAccountActionType('add');
                  setAccountActionAmount('');
                }}
              >
                <Text style={styles.secondaryButtonText}>{language === 'es' ? 'Agregar ingresos' : 'Add income'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteCategoryButton,
                  accountActionType === 'subtract' ? styles.filterChipActive : undefined,
                ]}
                onPress={() => {
                  setAccountActionType('subtract');
                  setAccountActionAmount('');
                }}
              >
                <Text style={styles.deleteCategoryButtonText}>{language === 'es' ? 'Restar ingresos' : 'Subtract income'}</Text>
              </TouchableOpacity>
            </View>

            {accountActionType ? (
              <>
                <TextInput
                  placeholder={
                    accountActionType === 'add'
                      ? language === 'es'
                        ? 'Cuanto sumar'
                        : 'How much to add'
                      : language === 'es'
                        ? 'Cuanto restar'
                        : 'How much to subtract'
                  }
                  value={accountActionAmount}
                  onChangeText={setAccountActionAmount}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholderTextColor={theme.placeholder}
                />
                <TouchableOpacity style={styles.primaryButton} onPress={onConfirmAccountAction}>
                  <Text style={styles.primaryButtonText}>
                    {accountActionType === 'add'
                      ? language === 'es'
                        ? 'Confirmar suma'
                        : 'Confirm add'
                      : language === 'es'
                        ? 'Confirmar resta'
                        : 'Confirm subtract'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            <Text style={styles.filterLabel}>{language === 'es' ? 'Color' : 'Color'}</Text>
            <TouchableOpacity
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
            <TouchableOpacity style={styles.deleteActionButtonFull} onPress={onDeleteSelectedAccount}>
              <Text style={styles.deleteCategoryButtonText}>{t.deleteAccount}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setIsAccountActionModalVisible(false);
                setSelectedAccountForAction(null);
                setAccountActionType(null);
                setAccountActionAmount('');
                setIsAccountEditColorTableVisible(false);
              }}
            >
              <Text style={styles.secondaryButtonText}>{language === 'es' ? 'Cerrar' : 'Close'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={isBudgetAdjustModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setIsBudgetAdjustModalVisible(false);
          setSelectedBudgetCategoryForAdjust(null);
        }}
      >
        <View style={styles.modalBackdrop}>
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
              onChangeText={setBudgetDeltaInput}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <View style={styles.modalOptionRow}>
              <TouchableOpacity
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
              <TouchableOpacity
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
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setIsBudgetAdjustModalVisible(false);
                setSelectedBudgetCategoryForAdjust(null);
                setBudgetDeltaInput('');
              }}
            >
              <Text style={styles.secondaryButtonText}>{language === 'es' ? 'Cerrar' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isBudgetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBudgetModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t.budgetByCategory}</Text>
            <Text style={styles.filterLabel}>{t.category}</Text>
            {availableBudgetCategories.length === 0 ? (
              <Text style={styles.empty}>{t.noAvailableBudgetCategories}</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {availableBudgetCategories.map((category) => (
                  <TouchableOpacity
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
              onChangeText={setBudgetAmountInput}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TouchableOpacity
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
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setIsBudgetModalVisible(false)}>
              <Text style={styles.secondaryButtonText}>{language === 'es' ? 'Cerrar' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isNewAccountModalVisible} transparent animationType="fade" onRequestClose={() => setIsNewAccountModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{language === 'es' ? 'Nueva cuenta' : 'New account'}</Text>
            <TextInput
              placeholder={language === 'es' ? 'Nombre de la cuenta' : 'Account name'}
              value={accountName}
              onChangeText={setAccountName}
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <TextInput
              placeholder={language === 'es' ? 'Saldo inicial' : 'Initial balance'}
              value={accountBalanceInput}
              onChangeText={setAccountBalanceInput}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={theme.placeholder}
            />
            <Text style={styles.filterLabel}>{language === 'es' ? 'Color' : 'Color'}</Text>
            <TouchableOpacity
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

            <TouchableOpacity style={styles.primaryButton} onPress={onAddAccount}>
              <Text style={styles.primaryButtonText}>{language === 'es' ? 'Agregar cuenta' : 'Add account'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setIsNewAccountModalVisible(false);
                setIsNewAccountColorTableVisible(false);
              }}
            >
              <Text style={styles.secondaryButtonText}>{language === 'es' ? 'Cerrar' : 'Close'}</Text>
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
  sectionAnimatedWrap: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.textSoft,
  },
  subtitle: {
    color: theme.textMuted,
    marginBottom: 4,
  },
  topSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  leftSummaryColumn: {
    flex: 1,
    gap: 10,
  },
  accountsTotalCard: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flex: 1,
  },
  leftSummaryCard: {
    alignSelf: 'flex-start',
  },
  rightSummaryCard: {
    alignSelf: 'flex-start',
  },
  accountsTotalLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  hormigaName: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  accountsTotalValue: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.text,
  },
  filterWrap: {
    gap: 8,
  },
  filterLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  chipScroll: {
    marginBottom: 2,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: theme.placeholder,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: theme.background,
  },
  filterChipActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  filterChipText: {
    color: theme.textSoft,
    fontSize: 12,
  },
  filterChipTextActive: {
    color: theme.accentText,
    fontWeight: '700',
  },
  colorChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: theme.background,
  },
  colorChipActive: {
    borderColor: theme.text,
  },
  colorTableWrap: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 8,
    backgroundColor: theme.background,
    gap: 8,
  },
  colorGroup: {
    gap: 6,
  },
  colorGroupLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  colorGroupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.placeholder,
    borderRadius: 10,
    backgroundColor: theme.background,
    paddingHorizontal: 10,
    minHeight: 42,
  },
  searchIcon: {
    color: theme.textMuted,
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.textSoft,
  },
  predictionList: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  predictionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: theme.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  predictionText: {
    color: theme.textSoft,
  },
  helpText: {
    color: theme.textMuted,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.placeholder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.textSoft,
    backgroundColor: theme.background,
  },
  ocrInput: {
    borderWidth: 1,
    borderColor: theme.placeholder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.textSoft,
    backgroundColor: theme.background,
    minHeight: 140,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.placeholder,
  },
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: theme.accentText,
    fontWeight: '600',
  },
  secondaryButton: {
    borderColor: theme.placeholder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  secondaryButtonText: {
    color: theme.textSoft,
    fontWeight: '600',
  },
  secondaryButtonCompact: {
    flex: 1,
    borderColor: theme.placeholder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: theme.background,
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
    gap: 8,
  },
  deleteCategoryButton: {
    flex: 1,
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteActionButtonFull: {
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteCategoryButtonText: {
    color: theme.dangerText,
    fontWeight: '700',
  },
  clearButton: {
    borderColor: theme.dangerBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
  },
  clearButtonText: {
    color: theme.dangerText,
    fontWeight: '700',
  },
  analysisWrap: {
    gap: 8,
  },
  chartWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  emptyChart: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 24,
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
    fontSize: 18,
    fontWeight: '700',
  },
  legendWrap: {
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: theme.textSoft,
    flex: 1,
    fontWeight: '600',
  },
  legendValue: {
    color: theme.textMuted,
    fontSize: 12,
  },
  expenseTopTabs: {
    gap: 8,
  },
  expenseTopTabsScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  expenseTopTab: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  expenseTopTabActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  expenseTopTabText: {
    color: theme.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  expenseTopTabTextActive: {
    color: theme.accentText,
  },
  expenseTopTabsHintTrack: {
    alignSelf: 'center',
    width: 56,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.border,
    overflow: 'hidden',
  },
  expenseTopTabsHintThumb: {
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.textMuted,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: theme.textMuted,
    fontWeight: '600',
  },
  summaryValue: {
    color: theme.text,
    fontWeight: '700',
  },
  monthGroup: {
    gap: 8,
    marginBottom: 8,
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
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
  },
  deleteTableButtonText: {
    color: theme.dangerText,
    fontSize: 12,
    fontWeight: '700',
  },
  adjustBudgetInlineButton: {
    borderColor: theme.placeholder,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center',
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
    fontSize: 16,
  },
  loading: {
    color: theme.textMuted,
  },
  itemRow: {
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  productActionWrap: {
    alignItems: 'flex-end',
    gap: 8,
  },
  itemTextWrap: {
    flex: 1,
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
  itemDesc: {
    fontSize: 15,
    color: theme.text,
    fontWeight: '600',
  },
  itemDate: {
    marginTop: 2,
    color: theme.textMuted,
    fontSize: 12,
  },
  itemAmount: {
    fontWeight: '700',
    color: theme.amountColor,
    fontSize: 15,
  },
  accountGrid: {
    gap: 10,
  },
  accountsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.surfaceAlt,
  },
  accountName: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  accountBalance: {
    color: theme.textSoft,
    fontWeight: '700',
    fontSize: 15,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
    color: theme.textMuted,
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
    gap: 8,
  },
  numberFormatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
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
    paddingTop: 16,
    paddingHorizontal: 12,
    gap: 8,
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
    borderRadius: 10,
    backgroundColor: theme.background,
    paddingVertical: 12,
    paddingHorizontal: 12,
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
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 4,
  },
  navButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  navButtonActive: {
    borderColor: theme.accentStrong,
    backgroundColor: theme.navActiveBg,
  },
  navButtonText: {
    color: theme.textMuted,
    fontWeight: '600',
    fontSize: 10,
    textAlign: 'center',
  },
  navButtonTextActive: {
    color: theme.accentText,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.modalBackdrop,
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 10,
  },
  modalCardScrollable: {
    maxHeight: '85%',
  },
  modalOptionRow: {
    flexDirection: 'row',
    gap: 8,
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

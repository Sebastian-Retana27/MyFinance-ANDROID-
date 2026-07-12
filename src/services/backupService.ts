import { getDb } from '../db/database';

type BackupFormat = 'myfinance-backup-v1' | 'myfinance-backup-v2';

export type BackupPayload = {
  format: BackupFormat;
  createdAt: string;
  schemaVersion: number;
  data: {
    expenses: unknown[];
    products: unknown[];
    categories: unknown[];
    accounts: unknown[];
    budgets: unknown[];
    categoryColors: unknown[];
    incomeEntries: unknown[];
    transactions: unknown[];
    accountMovements: unknown[];
    payables?: unknown[];
    appMeta: unknown[];
  };
  metadata?: {
    recordCounts: Record<string, number>;
    totalRecords: number;
    checksum: string;
  };
};

type BackupProgress = {
  stage: 'reading' | 'done';
  tableKey: string;
  tableLabel: string;
  processed: number;
  total: number;
  totalTables: number;
  tableIndex: number;
};

const TABLES = [
  { key: 'expenses', table: 'expenses' },
  { key: 'products', table: 'products' },
  { key: 'categories', table: 'categories' },
  { key: 'accounts', table: 'accounts' },
  { key: 'budgets', table: 'budgets' },
  { key: 'categoryColors', table: 'category_colors' },
  { key: 'incomeEntries', table: 'income_entries' },
  { key: 'transactions', table: 'transactions' },
  { key: 'accountMovements', table: 'account_movements' },
  { key: 'payables', table: 'payables' },
  { key: 'appMeta', table: 'app_meta' },
] as const;

const BACKUP_CHUNK_SIZE = 500;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function buildBackupChecksum(data: BackupPayload['data']): string {
  const source = TABLES.map((item) => {
    const rows = (data[item.key] ?? []) as unknown[];
    return `${item.key}:${rows.length}:${JSON.stringify(rows)}`;
  }).join('|');
  return fnv1aHash(source);
}

function buildLegacyBackupChecksum(data: BackupPayload['data']): string {
  const source = TABLES.filter((item) => item.key !== 'payables').map((item) => {
    const rows = (data[item.key] ?? []) as unknown[];
    return `${item.key}:${rows.length}:${JSON.stringify(rows)}`;
  }).join('|');
  return fnv1aHash(source);
}

function isArrayRecord(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value);
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function countTableRows(tableName: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM ${tableName}`);
  return Number(row?.c ?? 0);
}

async function readTableInChunks(tableName: string, chunkSize = BACKUP_CHUNK_SIZE): Promise<unknown[]> {
  const db = await getDb();
  const total = await countTableRows(tableName);
  if (total === 0) {
    return [];
  }

  const rows: unknown[] = [];
  let offset = 0;
  while (offset < total) {
    const chunk = await db.getAllAsync(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`, chunkSize, offset);
    rows.push(...chunk);
    offset += chunk.length;
    if (chunk.length === 0) {
      break;
    }
    await yieldToUi();
  }
  return rows;
}

export function validateBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Partial<BackupPayload>;
  if (obj.format !== 'myfinance-backup-v1' && obj.format !== 'myfinance-backup-v2') {
    return false;
  }

  if (typeof obj.createdAt !== 'string' || typeof obj.schemaVersion !== 'number' || !obj.data) {
    return false;
  }

  const data = obj.data as BackupPayload['data'];
  const requiredKeys: Array<keyof BackupPayload['data']> = [
    'expenses',
    'products',
    'categories',
    'accounts',
    'budgets',
    'categoryColors',
    'incomeEntries',
    'transactions',
    'accountMovements',
    'appMeta',
  ];

  return requiredKeys.every((key) => isArrayRecord(data[key]));
}

export function validateBackupIntegrity(payload: BackupPayload): { valid: boolean; reason?: string } {
  if (!validateBackupPayload(payload)) {
    return { valid: false, reason: 'Backup structure is invalid.' };
  }

  if (payload.format === 'myfinance-backup-v2') {
    if (!payload.metadata) {
      return { valid: false, reason: 'Backup metadata is missing.' };
    }

    const expectedChecksum = buildBackupChecksum(payload.data);
    if (expectedChecksum !== payload.metadata.checksum) {
      const legacyChecksum = buildLegacyBackupChecksum(payload.data);
      if (legacyChecksum !== payload.metadata.checksum) {
        return { valid: false, reason: 'Backup checksum does not match content.' };
      }
    }
  }

  return { valid: true };
}

export async function createBackupPayload(
  onProgress?: (progress: BackupProgress) => void
): Promise<BackupPayload> {
  const db = await getDb();
  const schemaRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  const schemaVersion = Number(schemaRow?.value ?? '0');

  const data: BackupPayload['data'] = {
    expenses: [],
    products: [],
    categories: [],
    accounts: [],
    budgets: [],
    categoryColors: [],
    incomeEntries: [],
    transactions: [],
    accountMovements: [],
    payables: [],
    appMeta: [],
  };

  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;
  for (let i = 0; i < TABLES.length; i += 1) {
    const item = TABLES[i];
    const total = await countTableRows(item.table);
    onProgress?.({
      stage: 'reading',
      tableKey: item.key,
      tableLabel: item.table,
      processed: 0,
      total,
      totalTables: TABLES.length,
      tableIndex: i + 1,
    });
    const rows = await readTableInChunks(item.table, BACKUP_CHUNK_SIZE);
    (data[item.key] as unknown[]) = rows;
    recordCounts[item.key] = rows.length;
    totalRecords += rows.length;
    onProgress?.({
      stage: 'reading',
      tableKey: item.key,
      tableLabel: item.table,
      processed: rows.length,
      total,
      totalTables: TABLES.length,
      tableIndex: i + 1,
    });
    await yieldToUi();
  }

  const checksum = buildBackupChecksum(data);
  const payload: BackupPayload = {
    format: 'myfinance-backup-v2',
    createdAt: new Date().toISOString(),
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
    data,
    metadata: {
      recordCounts,
      totalRecords,
      checksum,
    },
  };

  onProgress?.({
    stage: 'done',
    tableKey: 'all',
    tableLabel: 'all',
    processed: totalRecords,
    total: totalRecords,
    totalTables: TABLES.length,
    tableIndex: TABLES.length,
  });
  return payload;
}

export async function restoreBackupPayload(payload: BackupPayload, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const integrity = validateBackupIntegrity(payload);
  if (!integrity.valid) {
    throw new Error(integrity.reason ?? 'Invalid backup.');
  }

  const db = await getDb();

  await db.withExclusiveTransactionAsync(async (tx) => {
    if (mode === 'replace') {
      await tx.execAsync(`
        DELETE FROM expenses;
        DELETE FROM products;
        DELETE FROM categories;
        DELETE FROM accounts;
        DELETE FROM budgets;
        DELETE FROM category_colors;
        DELETE FROM income_entries;
        DELETE FROM transactions;
        DELETE FROM account_movements;
        DELETE FROM payables;
      `);
    }

    for (const expense of payload.data.expenses as Array<Record<string, unknown>>) {
      await tx.runAsync(
        `
          INSERT OR IGNORE INTO expenses (id, description, quantity, amount, account_name, created_at, is_deleted, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, ''))
        `,
        asNullableNumber(expense.id),
        asString(expense.description),
        asNumber(expense.quantity, 1),
        asNumber(expense.amount),
        asString(expense.account_name),
        asString(expense.created_at, new Date().toISOString()),
        asNumber(expense.is_deleted),
        asString(expense.deleted_at)
      );
    }

    for (const product of payload.data.products as Array<Record<string, unknown>>) {
      await tx.runAsync(
        `
          INSERT OR IGNORE INTO products (id, name, category, quantity, unit_price, line_total, account_name, created_at, is_deleted, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, ''))
        `,
        asNullableNumber(product.id),
        asString(product.name),
        asString(product.category, 'varios'),
        asNumber(product.quantity, 1),
        asNumber(product.unit_price),
        asNumber(product.line_total),
        asString(product.account_name),
        asString(product.created_at, new Date().toISOString()),
        asNumber(product.is_deleted),
        asString(product.deleted_at)
      );
    }

    for (const account of payload.data.accounts as Array<Record<string, unknown>>) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO accounts (id, name, balance, currency_code, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        asNullableNumber(account.id),
        asString(account.name),
        asNumber(account.balance),
        asString(account.currency_code, 'CRC'),
        asString(account.color, '#94a3b8'),
        asString(account.created_at, new Date().toISOString())
      );
    }

    for (const category of payload.data.categories as Array<Record<string, unknown>>) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)',
        asNullableNumber(category.id),
        asString(category.name)
      );
    }

    for (const budget of payload.data.budgets as Array<Record<string, unknown>>) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO budgets (category, amount) VALUES (?, ?)',
        asString(budget.category),
        asNumber(budget.amount)
      );
    }

    for (const color of payload.data.categoryColors as Array<Record<string, unknown>>) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO category_colors (category, color) VALUES (?, ?)',
        asString(color.category),
        asString(color.color)
      );
    }

    for (const income of payload.data.incomeEntries as Array<Record<string, unknown>>) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO income_entries (id, source, amount, account_name, created_at) VALUES (?, ?, ?, ?, ?)',
        asNullableNumber(income.id),
        asString(income.source),
        asNumber(income.amount),
        asString(income.account_name),
        asString(income.created_at, new Date().toISOString())
      );
    }

    for (const txRow of payload.data.transactions as Array<Record<string, unknown>>) {
      await tx.runAsync(
        `
          INSERT OR IGNORE INTO transactions (id, type, source, amount, quantity, category, account_name, note, related_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        asNullableNumber(txRow.id),
        asString(txRow.type),
        asString(txRow.source),
        asNumber(txRow.amount),
        asNumber(txRow.quantity, 1),
        asString(txRow.category, 'varios'),
        asString(txRow.account_name),
        asString(txRow.note),
        asNullableNumber(txRow.related_id),
        asString(txRow.created_at, new Date().toISOString())
      );
    }

    for (const movement of payload.data.accountMovements as Array<Record<string, unknown>>) {
      await tx.runAsync(
        `
          INSERT OR IGNORE INTO account_movements (id, type, amount, account_name, note, related_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        asNullableNumber(movement.id),
        asString(movement.type),
        asNumber(movement.amount),
        asString(movement.account_name),
        asString(movement.note),
        asNullableNumber(movement.related_id),
        asString(movement.created_at, new Date().toISOString())
      );
    }

    for (const payable of (payload.data.payables ?? []) as Array<Record<string, unknown>>) {
      await tx.runAsync(
        `
          INSERT OR IGNORE INTO payables (
            id,
            name,
            amount,
            category,
            due_day,
            is_paid,
            paid_at,
            paid_account_name,
            created_at
          ) VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, ''), COALESCE(?, ''), ?)
        `,
        asNullableNumber(payable.id),
        asString(payable.name),
        asNumber(payable.amount),
        asString(payable.category, 'varios'),
        Math.min(31, Math.max(1, Math.floor(asNumber(payable.due_day, 1)))),
        asNumber(payable.is_paid),
        asString(payable.paid_at),
        asString(payable.paid_account_name),
        asString(payable.created_at, new Date().toISOString())
      );
    }

    for (const meta of payload.data.appMeta as Array<Record<string, unknown>>) {
      if (meta.key === 'schema_version') {
        continue;
      }
      await tx.runAsync(
        'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
        asString(meta.key),
        asString(meta.value)
      );
    }
  });
}

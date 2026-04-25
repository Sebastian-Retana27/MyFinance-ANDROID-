import { getDb } from '../db/database';

export type BackupPayload = {
  format: 'myfinance-backup-v1';
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
    appMeta: unknown[];
  };
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
  { key: 'appMeta', table: 'app_meta' },
] as const;

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

export function validateBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Partial<BackupPayload>;
  return (
    obj.format === 'myfinance-backup-v1' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.schemaVersion === 'number' &&
    !!obj.data &&
    typeof obj.data === 'object'
  );
}

export async function createBackupPayload(): Promise<BackupPayload> {
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
    appMeta: [],
  };

  for (const item of TABLES) {
    const rows = await db.getAllAsync(`SELECT * FROM ${item.table}`);
    (data[item.key] as unknown[]) = rows;
  }

  return {
    format: 'myfinance-backup-v1',
    createdAt: new Date().toISOString(),
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
    data,
  };
}

export async function restoreBackupPayload(payload: BackupPayload, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  if (!validateBackupPayload(payload)) {
    throw new Error('Backup invalido.');
  }

  const db = await getDb();

  await db.withExclusiveTransactionAsync(async (tx) => {
    if (mode === 'replace') {
      // Replace mode is explicit and dangerous by design.
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
      `);
    }

    // Merge mode keeps existing rows and inserts non-conflicting records.
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
        'INSERT OR IGNORE INTO accounts (id, name, balance, color, created_at) VALUES (?, ?, ?, ?, ?)',
        asNullableNumber(account.id),
        asString(account.name),
        asNumber(account.balance),
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

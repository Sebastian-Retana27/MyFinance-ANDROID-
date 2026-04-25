import { getDb } from '../db/database';

export type UpgradeSmokeSnapshot = {
  schemaVersion: string;
  counts: {
    accounts: number;
    productsVisible: number;
    productsDeleted: number;
    expensesVisible: number;
    incomeEntries: number;
    transactions: number;
    accountMovements: number;
    budgets: number;
    categories: number;
  };
  settings: {
    language: string;
    theme: string;
    numberFormat: string;
  };
};

async function getCount(query: string, ...args: Array<string | number>): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(query, ...args);
  return Number(row?.total ?? 0);
}

export async function getUpgradeSmokeSnapshot(): Promise<UpgradeSmokeSnapshot> {
  const db = await getDb();
  const schemaVersionRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  const languageRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'app_language'"
  );
  const themeRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'app_theme_mode'"
  );
  const numberFormatRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'app_number_format'"
  );

  return {
    schemaVersion: schemaVersionRow?.value ?? '0',
    counts: {
      accounts: await getCount('SELECT COUNT(*) AS total FROM accounts'),
      productsVisible: await getCount('SELECT COUNT(*) AS total FROM products WHERE COALESCE(is_deleted, 0) = 0'),
      productsDeleted: await getCount('SELECT COUNT(*) AS total FROM products WHERE COALESCE(is_deleted, 0) = 1'),
      expensesVisible: await getCount('SELECT COUNT(*) AS total FROM expenses WHERE COALESCE(is_deleted, 0) = 0'),
      incomeEntries: await getCount('SELECT COUNT(*) AS total FROM income_entries'),
      transactions: await getCount('SELECT COUNT(*) AS total FROM transactions'),
      accountMovements: await getCount('SELECT COUNT(*) AS total FROM account_movements'),
      budgets: await getCount('SELECT COUNT(*) AS total FROM budgets'),
      categories: await getCount('SELECT COUNT(*) AS total FROM categories'),
    },
    settings: {
      language: languageRow?.value ?? 'es',
      theme: themeRow?.value ?? 'dark',
      numberFormat: numberFormatRow?.value ?? 'comma',
    },
  };
}

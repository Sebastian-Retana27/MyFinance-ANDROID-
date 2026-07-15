import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';

export type CategoryBudget = {
  category: string;
  amount: number;
  currencyCode: string;
};

export async function listBudgets(currencyCode?: string): Promise<CategoryBudget[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string; amount: number; currency_code: string }>(
    `SELECT category, amount, currency_code FROM category_budgets ${currencyCode ? 'WHERE currency_code = ?' : ''} ORDER BY category COLLATE NOCASE ASC`,
    ...(currencyCode ? [currencyCode] : [])
  );

  return rows.map((row) => ({ category: row.category, amount: row.amount, currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE }));
}

export async function upsertBudget(category: string, amount: number, currencyCode = DEFAULT_CURRENCY_CODE): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO category_budgets (category, currency_code, amount) VALUES (?, ?, ?) ON CONFLICT(category, currency_code) DO UPDATE SET amount = excluded.amount',
    category,
    currencyCode,
    amount
  );
}

export async function changeBudgetAmount(category: string, delta: number, currencyCode = DEFAULT_CURRENCY_CODE): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE category_budgets SET amount = MAX(0, amount + ?) WHERE category = ? AND currency_code = ?',
    delta,
    category,
    currencyCode
  );
}

export async function deleteBudget(category: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM category_budgets WHERE category = ? AND currency_code = ?', category, currencyCode);
}

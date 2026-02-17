import { getDb } from '../db/database';

export type CategoryBudget = {
  category: string;
  amount: number;
};

export async function listBudgets(): Promise<CategoryBudget[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string; amount: number }>(
    'SELECT category, amount FROM budgets ORDER BY category COLLATE NOCASE ASC'
  );

  return rows.map((row) => ({ category: row.category, amount: row.amount }));
}

export async function upsertBudget(category: string, amount: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount',
    category,
    amount
  );
}

export async function changeBudgetAmount(category: string, delta: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE budgets SET amount = MAX(0, amount + ?) WHERE category = ?',
    delta,
    category
  );
}

export async function deleteBudget(category: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM budgets WHERE category = ?', category);
}

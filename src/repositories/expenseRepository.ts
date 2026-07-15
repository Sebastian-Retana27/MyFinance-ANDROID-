import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type { Expense } from '../models/expense';

export async function createExpense(
  description: string,
  quantity: number,
  amount: number,
  accountName: string,
  createdAt?: string,
  currencyCode: string = DEFAULT_CURRENCY_CODE
): Promise<void> {
  const db = await getDb();
  const createdAtValue = createdAt ?? new Date().toISOString();

  await db.runAsync(
    'INSERT INTO expenses (description, quantity, amount, account_name, currency_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    description,
    quantity,
    amount,
    accountName,
    currencyCode,
    createdAtValue
  );
}

export async function listExpenses(): Promise<Expense[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    id: number;
    description: string;
    quantity: number;
    amount: number;
    account_name: string;
    currency_code: string;
    created_at: string;
  }>(
    `
      SELECT id, description, quantity, amount, account_name, currency_code, created_at
      FROM expenses
      WHERE COALESCE(is_deleted, 0) = 0
      ORDER BY id DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    amount: row.amount,
    accountName: row.account_name,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    createdAt: row.created_at,
  }));
}

import { getDb } from '../db/database';
import type { Expense } from '../models/expense';

export async function createExpense(
  description: string,
  quantity: number,
  amount: number,
  accountName: string
): Promise<void> {
  const db = await getDb();
  const createdAt = new Date().toISOString();

  await db.runAsync(
    'INSERT INTO expenses (description, quantity, amount, account_name, created_at) VALUES (?, ?, ?, ?, ?)',
    description,
    quantity,
    amount,
    accountName,
    createdAt
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
    created_at: string;
  }>('SELECT id, description, quantity, amount, account_name, created_at FROM expenses ORDER BY id DESC');

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    amount: row.amount,
    accountName: row.account_name,
    createdAt: row.created_at,
  }));
}

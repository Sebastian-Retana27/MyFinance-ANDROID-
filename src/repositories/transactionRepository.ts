import { getDb } from '../db/database';
import type { MonthlyTransactionSummary, Transaction, TransactionType } from '../models/transaction';

type CreateTransactionInput = {
  type: TransactionType;
  source?: string;
  amount: number;
  quantity?: number;
  category?: string;
  accountName?: string;
  note?: string;
  relatedId?: number | null;
  createdAt?: string;
};

export async function createTransaction(input: CreateTransactionInput): Promise<void> {
  const db = await getDb();
  const quantity = input.quantity ?? 1;
  const category = input.category ?? 'varios';
  const createdAt = input.createdAt ?? new Date().toISOString();

  await db.runAsync(
    `
      INSERT INTO transactions (
        type,
        source,
        amount,
        quantity,
        category,
        account_name,
        note,
        related_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.type,
    input.source ?? '',
    Number(input.amount.toFixed(2)),
    quantity,
    category,
    input.accountName ?? '',
    input.note ?? '',
    input.relatedId ?? null,
    createdAt
  );
}

export async function listTransactions(limit?: number): Promise<Transaction[]> {
  const db = await getDb();
  const cap = limit && limit > 0 ? Math.floor(limit) : null;

  const rows = await db.getAllAsync<{
    id: number;
    type: string;
    source: string;
    amount: number;
    quantity: number;
    category: string;
    account_name: string;
    note: string;
    related_id: number | null;
    created_at: string;
  }>(
    cap
      ? `
        SELECT id, type, source, amount, quantity, category, account_name, note, related_id, created_at
        FROM transactions
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
      : `
        SELECT id, type, source, amount, quantity, category, account_name, note, related_id, created_at
        FROM transactions
        ORDER BY created_at DESC, id DESC
      `,
    ...(cap ? [cap] : [])
  );

  return rows.map((row) => ({
    id: row.id,
    type:
      row.type === 'expense' || row.type === 'income' || row.type === 'transfer_in' || row.type === 'transfer_out'
        ? row.type
        : 'expense',
    source: row.source,
    amount: row.amount,
    quantity: row.quantity,
    category: row.category,
    accountName: row.account_name,
    note: row.note,
    relatedId: row.related_id,
    createdAt: row.created_at,
  }));
}

export async function listMonthlySummary(): Promise<MonthlyTransactionSummary[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    month_key: string;
    total_expense: number;
    total_income: number;
  }>(`
    SELECT
      strftime('%Y-%m', created_at) AS month_key,
      ROUND(SUM(CASE WHEN type IN ('expense', 'transfer_out') THEN amount ELSE 0 END), 2) AS total_expense,
      ROUND(SUM(CASE WHEN type IN ('income', 'transfer_in') THEN amount ELSE 0 END), 2) AS total_income
    FROM transactions
    GROUP BY month_key
    ORDER BY month_key DESC
  `);

  return rows.map((row) => {
    const totalExpense = Number(row.total_expense ?? 0);
    const totalIncome = Number(row.total_income ?? 0);

    return {
      monthKey: row.month_key,
      totalExpense,
      totalIncome,
      net: Number((totalIncome - totalExpense).toFixed(2)),
    };
  });
}

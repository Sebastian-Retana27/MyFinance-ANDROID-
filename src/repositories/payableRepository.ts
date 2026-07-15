import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type { Payable } from '../models/payable';

type PayableRow = {
  id: number;
  name: string;
  amount: number;
  currency_code: string;
  category: string;
  due_day: number;
  is_paid: number;
  paid_at: string;
  paid_account_name: string;
  created_at: string;
};

function mapPayable(row: PayableRow): Payable {
  const now = new Date();
  const paidDate = row.paid_at ? new Date(row.paid_at) : null;
  const isPaidThisMonth =
    row.is_paid === 1 &&
    paidDate != null &&
    !Number.isNaN(paidDate.getTime()) &&
    paidDate.getFullYear() === now.getFullYear() &&
    paidDate.getMonth() === now.getMonth();

  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    category: row.category,
    dueDay: row.due_day,
    isPaid: isPaidThisMonth,
    paidAt: row.paid_at,
    paidAccountName: row.paid_account_name,
    createdAt: row.created_at,
  };
}

export async function createPayable(name: string, amount: number, category: string, dueDay: number, currencyCode: string = DEFAULT_CURRENCY_CODE): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `
      INSERT INTO payables (name, amount, currency_code, category, due_day, is_paid, paid_at, paid_account_name, created_at)
      VALUES (?, ?, ?, ?, ?, 0, '', '', ?)
    `,
    name.trim(),
    Number(amount.toFixed(2)),
    currencyCode,
    category,
    Math.min(31, Math.max(1, Math.floor(dueDay))),
    new Date().toISOString()
  );
}

export async function listPayables(): Promise<Payable[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PayableRow>(
    `
      SELECT id, name, amount, currency_code, category, due_day, is_paid, paid_at, paid_account_name, created_at
      FROM payables
      ORDER BY
        CASE
          WHEN is_paid = 1 AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now') THEN 1
          ELSE 0
        END ASC,
        due_day ASC,
        name COLLATE NOCASE ASC
    `
  );
  return rows.map(mapPayable);
}

export async function markPayablePaid(id: number, accountName: string, paidAt?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `
      UPDATE payables
      SET is_paid = 1, paid_at = ?, paid_account_name = ?
      WHERE id = ?
    `,
    paidAt ?? new Date().toISOString(),
    accountName,
    id
  );
}

export async function deletePayable(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM payables WHERE id = ?', id);
}

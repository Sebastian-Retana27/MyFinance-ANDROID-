import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type { AccountMovement, AccountMovementType } from '../models/accountMovement';

type CreateAccountMovementInput = {
  type: AccountMovementType;
  amount: number;
  accountName: string;
  currencyCode?: string;
  note?: string;
  relatedId?: number | null;
  createdAt?: string;
};

export async function createAccountMovement(input: CreateAccountMovementInput): Promise<void> {
  const db = await getDb();
  const createdAt = input.createdAt ?? new Date().toISOString();

  await db.runAsync(
    `
      INSERT INTO account_movements (type, amount, account_name, currency_code, note, related_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    input.type,
    Number(input.amount.toFixed(2)),
    input.accountName,
    input.currencyCode ?? DEFAULT_CURRENCY_CODE,
    input.note ?? '',
    input.relatedId ?? null,
    createdAt
  );
}

export async function listAccountMovements(limit = 100): Promise<AccountMovement[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    type: string;
    amount: number;
    account_name: string;
    currency_code: string;
    note: string;
    related_id: number | null;
    created_at: string;
  }>(
    `
      SELECT id, type, amount, account_name, currency_code, note, related_id, created_at
      FROM account_movements
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    Math.max(1, Math.floor(limit))
  );

  return rows.map((row) => ({
    id: row.id,
    type: (row.type as AccountMovementType) ?? 'account_adjustment',
    amount: row.amount,
    accountName: row.account_name,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    note: row.note,
    relatedId: row.related_id,
    createdAt: row.created_at,
  }));
}

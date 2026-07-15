import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type { IncomeEntry, IncomeEntrySource } from '../models/incomeEntry';

export async function createIncomeEntry(
  source: IncomeEntrySource,
  amount: number,
  accountName: string,
  createdAt?: string,
  currencyCode: string = DEFAULT_CURRENCY_CODE
): Promise<void> {
  const db = await getDb();
  const createdAtValue = createdAt ?? new Date().toISOString();

  await db.runAsync(
    'INSERT INTO income_entries (source, amount, account_name, currency_code, created_at) VALUES (?, ?, ?, ?, ?)',
    source,
    amount,
    accountName,
    currencyCode,
    createdAtValue
  );
}

export async function listIncomeEntries(): Promise<IncomeEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    source: string;
    amount: number;
    account_name: string;
    currency_code: string;
    created_at: string;
  }>('SELECT id, source, amount, account_name, currency_code, created_at FROM income_entries ORDER BY created_at DESC, id DESC');

  return rows.map((row) => ({
    id: row.id,
    source: row.source === 'transfer_received' ? 'transfer_received' : 'manual_add',
    amount: row.amount,
    accountName: row.account_name,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    createdAt: row.created_at,
  }));
}

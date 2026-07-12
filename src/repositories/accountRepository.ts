import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type { Account } from '../models/account';

export async function createAccount(
  name: string,
  balance: number,
  color: string,
  currencyCode = DEFAULT_CURRENCY_CODE
): Promise<void> {
  const db = await getDb();
  const createdAt = new Date().toISOString();

  await db.runAsync(
    'INSERT INTO accounts (name, balance, color, currency_code, created_at) VALUES (?, ?, ?, ?, ?)',
    name.trim(),
    balance,
    color,
    currencyCode,
    createdAt
  );
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    balance: number;
    currency_code: string;
    color: string;
    created_at: string;
  }>('SELECT id, name, balance, currency_code, color, created_at FROM accounts ORDER BY id DESC');

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    balance: row.balance,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    color: row.color,
    createdAt: row.created_at,
  }));
}

export async function updateAccountBalance(id: number, newBalance: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE accounts SET balance = ? WHERE id = ?', newBalance, id);
}

export async function updateAccountColor(id: number, color: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE accounts SET color = ? WHERE id = ?', color, id);
}

export async function updateAccountCurrency(id: number, currencyCode: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE accounts SET currency_code = ? WHERE id = ?', currencyCode, id);
}

export async function deleteAccountById(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
}

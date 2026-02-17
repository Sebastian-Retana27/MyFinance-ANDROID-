import { getDb } from '../db/database';
import type { StoredProduct } from '../models/product';
import type { ReceiptItem } from '../services/receiptAnalyzer';
import { detectProductCategory } from '../services/categoryService';

export async function createProduct(
  name: string,
  quantity: number,
  unitPrice: number,
  lineTotal: number,
  createdAt?: string,
  categoryOverride?: string,
  accountName?: string
): Promise<void> {
  const db = await getDb();
  const category = categoryOverride ?? detectProductCategory(name);
  const createdAtValue = createdAt ?? new Date().toISOString();

  await db.runAsync(
    'INSERT INTO products (name, category, quantity, unit_price, line_total, account_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name,
    category,
    quantity,
    unitPrice,
    lineTotal,
    accountName ?? '',
    createdAtValue
  );
}

type CreateProductsOptions = {
  categoryOverride?: string;
  accountName?: string;
  createdAt?: string;
};

export async function createProducts(items: ReceiptItem[], options?: CreateProductsOptions): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const db = await getDb();
  const createdAt = options?.createdAt ?? new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const item of items) {
      const category = options?.categoryOverride ?? detectProductCategory(item.name);
      await tx.runAsync(
        'INSERT INTO products (name, category, quantity, unit_price, line_total, account_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        item.name,
        category,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        options?.accountName ?? '',
        createdAt
      );
    }
  });
}

export async function listProducts(): Promise<StoredProduct[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    category: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    account_name: string;
    created_at: string;
  }>(
    'SELECT id, name, category, quantity, unit_price, line_total, account_name, created_at FROM products ORDER BY created_at DESC, id DESC'
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    accountName: row.account_name,
    createdAt: row.created_at,
  }));
}

export async function deleteProductById(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM products WHERE id = ?', id);
}

export async function syncProductsFromExpenses(): Promise<void> {
  const db = await getDb();
  const syncState = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'expenses_sync_done'"
  );

  if (syncState?.value === '1') {
    return;
  }

  await db.runAsync(`
    INSERT INTO products (name, category, quantity, unit_price, line_total, account_name, created_at)
    SELECT
      e.description,
      'varios',
      e.quantity,
      e.amount,
      ROUND(e.amount * e.quantity, 2),
      e.account_name,
      e.created_at
    FROM expenses e
    WHERE NOT EXISTS (
      SELECT 1
      FROM products p
      WHERE p.name = e.description
        AND p.created_at = e.created_at
    )
  `);

  await db.runAsync(
    "INSERT INTO app_meta (key, value) VALUES ('expenses_sync_done', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
  );
}

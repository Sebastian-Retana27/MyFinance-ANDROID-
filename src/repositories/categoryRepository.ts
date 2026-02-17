import { getDb } from '../db/database';
import { FALLBACK_CATEGORY } from '../services/categoryService';

export async function listCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM categories ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, name COLLATE NOCASE ASC',
    FALLBACK_CATEGORY
  );

  return rows.map((row) => row.name);
}

export async function addCategory(name: string): Promise<void> {
  const db = await getDb();
  const normalizedName = name.trim().toLowerCase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO categories (name) VALUES (?)', normalizedName);
    await tx.runAsync(
      "INSERT OR IGNORE INTO category_colors (category, color) VALUES (?, '#94a3b8')",
      normalizedName
    );
  });
}

export async function deleteCategory(name: string): Promise<void> {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName === FALLBACK_CATEGORY) {
    throw new Error('No se puede eliminar la categoria "varios".');
  }

  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE products SET category = ? WHERE category = ?', FALLBACK_CATEGORY, normalizedName);
    await tx.runAsync('DELETE FROM budgets WHERE category = ?', normalizedName);
    await tx.runAsync('DELETE FROM category_colors WHERE category = ?', normalizedName);
    await tx.runAsync('DELETE FROM categories WHERE name = ?', normalizedName);
  });
}

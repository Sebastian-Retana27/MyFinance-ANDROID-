import { getDb } from '../db/database';

export type CategoryColor = {
  category: string;
  color: string;
};

export async function listCategoryColors(): Promise<CategoryColor[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string; color: string }>(
    'SELECT category, color FROM category_colors'
  );

  return rows.map((row) => ({ category: row.category, color: row.color }));
}

export async function upsertCategoryColor(category: string, color: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO category_colors (category, color) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET color = excluded.color',
    category,
    color
  );
}

export async function deleteCategoryColor(category: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM category_colors WHERE category = ?', category);
}

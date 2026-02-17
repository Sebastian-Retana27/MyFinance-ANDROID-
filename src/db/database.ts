import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

const DB_NAME = 'myfinance.db';
let dbInstance: SQLiteDatabase | null = null;

async function hasColumn(db: SQLiteDatabase, tableName: string, columnName: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

export async function getDb(): Promise<SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDatabaseAsync(DB_NAME);
  return dbInstance;
}

export async function initDb(): Promise<void> {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      amount REAL NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'varios',
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_colors (
      category TEXT PRIMARY KEY,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  // Non-destructive migrations for previous builds.
  if (!(await hasColumn(db, 'expenses', 'quantity'))) {
    await db.runAsync('ALTER TABLE expenses ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1');
  }

  if (!(await hasColumn(db, 'expenses', 'account_name'))) {
    await db.runAsync("ALTER TABLE expenses ADD COLUMN account_name TEXT NOT NULL DEFAULT ''");
  }

  if (!(await hasColumn(db, 'products', 'category'))) {
    await db.runAsync("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'varios'");
  }

  if (!(await hasColumn(db, 'products', 'account_name'))) {
    await db.runAsync("ALTER TABLE products ADD COLUMN account_name TEXT NOT NULL DEFAULT ''");
  }

  await db.runAsync(
    "INSERT OR IGNORE INTO categories (name) VALUES ('varios'), ('celular'), ('comida'), ('hogar'), ('transporte')"
  );

  await db.runAsync(`
    INSERT OR IGNORE INTO category_colors (category, color) VALUES
    ('varios', '#94a3b8'),
    ('celular', '#38bdf8'),
    ('comida', '#34d399'),
    ('hogar', '#f59e0b'),
    ('transporte', '#f97316')
  `);
}

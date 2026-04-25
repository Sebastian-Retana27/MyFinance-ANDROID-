import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

const DB_NAME = 'myfinance.db';
const SCHEMA_VERSION = 8;
let dbInstance: SQLiteDatabase | null = null;

async function hasColumn(db: SQLiteDatabase, tableName: string, columnName: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  const parsed = Number(row?.value ?? '0');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function setSchemaVersion(db: SQLiteDatabase, version: number): Promise<void> {
  await db.runAsync(
    "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    String(version)
  );
}

async function bootstrapTables(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL DEFAULT 'varios',
      account_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      related_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      related_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_account_name ON transactions(account_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

    CREATE INDEX IF NOT EXISTS idx_account_movements_created_at ON account_movements(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_movements_account_name ON account_movements(account_name);
    CREATE INDEX IF NOT EXISTS idx_account_movements_type ON account_movements(type);
  `);
}

async function migrateToV2(db: SQLiteDatabase): Promise<void> {
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
}

async function migrateToV3(db: SQLiteDatabase): Promise<void> {
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

async function migrateToV4(db: SQLiteDatabase): Promise<void> {
  const txSyncState = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'transactions_backfill_done'"
  );

  if (txSyncState?.value === '1') {
    return;
  }

  await db.withExclusiveTransactionAsync(async (tx) => {
    // Manual expenses backfill.
    await tx.runAsync(`
      INSERT INTO transactions (type, source, amount, quantity, category, account_name, note, related_id, created_at)
      SELECT
        'expense',
        'manual_expense',
        ROUND(e.amount * e.quantity, 2),
        e.quantity,
        COALESCE((
          SELECT p.category
          FROM products p
          WHERE p.name = e.description
            AND p.created_at = e.created_at
          ORDER BY p.id ASC
          LIMIT 1
        ), 'varios'),
        e.account_name,
        e.description,
        e.id,
        e.created_at
      FROM expenses e
      WHERE NOT EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.type = 'expense'
          AND t.source = 'manual_expense'
          AND t.related_id = e.id
      )
    `);

    // Product-only entries backfill (mostly OCR receipt details).
    await tx.runAsync(`
      INSERT INTO transactions (type, source, amount, quantity, category, account_name, note, related_id, created_at)
      SELECT
        'expense',
        'product_item',
        p.line_total,
        p.quantity,
        p.category,
        p.account_name,
        p.name,
        p.id,
        p.created_at
      FROM products p
      WHERE NOT EXISTS (
          SELECT 1
          FROM expenses e
          WHERE e.created_at = p.created_at
            AND e.description = p.name
            AND e.account_name = p.account_name
            AND e.quantity = p.quantity
            AND ABS(ROUND(e.amount * e.quantity, 2) - p.line_total) <= 0.01
        )
        AND NOT EXISTS (
          SELECT 1
          FROM transactions t
          WHERE t.type = 'expense'
            AND t.source = 'product_item'
            AND t.related_id = p.id
        )
    `);

    // Income entries backfill.
    await tx.runAsync(`
      INSERT INTO transactions (type, source, amount, quantity, category, account_name, note, related_id, created_at)
      SELECT
        CASE
          WHEN ie.source = 'transfer_received' THEN 'transfer_in'
          ELSE 'income'
        END,
        ie.source,
        ie.amount,
        1,
        'varios',
        ie.account_name,
        '',
        ie.id,
        ie.created_at
      FROM income_entries ie
      WHERE NOT EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.type IN ('income', 'transfer_in')
          AND t.source = ie.source
          AND t.related_id = ie.id
      )
    `);

    await tx.runAsync(
      "INSERT INTO app_meta (key, value) VALUES ('transactions_backfill_done', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
    );
  });
}

async function migrateToV5(db: SQLiteDatabase): Promise<void> {
  if (!(await hasColumn(db, 'products', 'is_deleted'))) {
    await db.runAsync('ALTER TABLE products ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'products', 'deleted_at'))) {
    await db.runAsync("ALTER TABLE products ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
  }
  if (!(await hasColumn(db, 'expenses', 'is_deleted'))) {
    await db.runAsync('ALTER TABLE expenses ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'expenses', 'deleted_at'))) {
    await db.runAsync("ALTER TABLE expenses ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
  }
}

async function migrateToV6(db: SQLiteDatabase): Promise<void> {
  const movementSyncState = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'account_movements_backfill_done'"
  );
  if (movementSyncState?.value === '1') {
    return;
  }

  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(`
      INSERT INTO account_movements (type, amount, account_name, note, related_id, created_at)
      SELECT
        'expense_manual',
        -ROUND(e.amount * e.quantity, 2),
        e.account_name,
        e.description,
        e.id,
        e.created_at
      FROM expenses e
      WHERE COALESCE(e.is_deleted, 0) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM account_movements am
          WHERE am.type = 'expense_manual'
            AND am.related_id = e.id
        )
    `);

    await tx.runAsync(`
      INSERT INTO account_movements (type, amount, account_name, note, related_id, created_at)
      SELECT
        CASE WHEN ie.source = 'transfer_received' THEN 'transfer_in' ELSE 'income_manual' END,
        ie.amount,
        ie.account_name,
        '',
        ie.id,
        ie.created_at
      FROM income_entries ie
      WHERE NOT EXISTS (
        SELECT 1
        FROM account_movements am
        WHERE am.type IN ('income_manual', 'transfer_in')
          AND am.related_id = ie.id
      )
    `);

    await tx.runAsync(
      "INSERT INTO app_meta (key, value) VALUES ('account_movements_backfill_done', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
    );
  });
}

async function migrateToV7(db: SQLiteDatabase): Promise<void> {
  // Placeholder for future migrations. Kept intentional for ordered versioning.
  await db.runAsync(
    "INSERT INTO app_meta (key, value) VALUES ('migration_v7_ready', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
  );
}

async function migrateToV8(db: SQLiteDatabase): Promise<void> {
  // Ensure indexes exist for large history queries.
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_account_name ON transactions(account_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_account_movements_created_at ON account_movements(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_movements_account_name ON account_movements(account_name);
    CREATE INDEX IF NOT EXISTS idx_account_movements_type ON account_movements(type);
  `);
}

type Migration = {
  version: number;
  run: (db: SQLiteDatabase) => Promise<void>;
};

const MIGRATIONS: Migration[] = [
  { version: 2, run: migrateToV2 },
  { version: 3, run: migrateToV3 },
  { version: 4, run: migrateToV4 },
  { version: 5, run: migrateToV5 },
  { version: 6, run: migrateToV6 },
  { version: 7, run: migrateToV7 },
  { version: 8, run: migrateToV8 },
];

export async function getDb(): Promise<SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDatabaseAsync(DB_NAME);
  return dbInstance;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  await bootstrapTables(db);

  // Legacy-safe guards: some previous builds stored schema_version values
  // that may skip intermediate migrations. These checks are idempotent.
  await migrateToV2(db);
  await migrateToV5(db);

  let currentVersion = await getSchemaVersion(db);

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version) {
      await migration.run(db);
      await setSchemaVersion(db, migration.version);
      currentVersion = migration.version;
    }
  }

  if (currentVersion < SCHEMA_VERSION) {
    await setSchemaVersion(db, SCHEMA_VERSION);
  }
}

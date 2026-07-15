import { getDb } from '../db/database';
import { DEFAULT_CURRENCY_CODE } from '../constants/currencies';
import type {
  AccountMovementTotal,
  AnnualMonthlySummary,
  CategoryTotal,
  MonthlyFinancialSummary,
  MonthlyTransactionSummary,
  SortDirection,
  Transaction,
  TransactionCursor,
  TransactionPageResult,
  TransactionQueryFilters,
  TransactionSortField,
  TransactionType,
} from '../models/transaction';

type CreateTransactionInput = {
  type: TransactionType;
  source?: string;
  amount: number;
  currencyCode?: string;
  quantity?: number;
  category?: string;
  accountName?: string;
  note?: string;
  relatedId?: number | null;
  createdAt?: string;
};

const DEFAULT_PAGE_SIZE = 60;

function mapTransactionRow(row: {
  id: number;
  type: string;
  source: string;
  amount: number;
  currency_code: string;
  quantity: number;
  category: string;
  account_name: string;
  note: string;
  related_id: number | null;
  created_at: string;
}): Transaction {
  return {
    id: row.id,
    type:
      row.type === 'expense' || row.type === 'income' || row.type === 'transfer_in' || row.type === 'transfer_out'
        ? row.type
        : 'expense',
    source: row.source,
    amount: row.amount,
    currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
    quantity: row.quantity,
    category: row.category,
    accountName: row.account_name,
    note: row.note,
    relatedId: row.related_id,
    createdAt: row.created_at,
  };
}

function normalizeSortField(sortField?: TransactionSortField): TransactionSortField {
  return sortField === 'amount' ? 'amount' : 'date';
}

function normalizeSortDirection(sortDirection?: SortDirection): SortDirection {
  return sortDirection === 'asc' ? 'asc' : 'desc';
}

function buildTransactionWhere(filters?: TransactionQueryFilters): { whereSql: string; args: Array<string | number> } {
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filters?.fromDate) {
    clauses.push('created_at >= ?');
    args.push(filters.fromDate);
  }

  if (filters?.toDate) {
    clauses.push('created_at <= ?');
    args.push(filters.toDate);
  }

  if (filters?.type) {
    clauses.push('type = ?');
    args.push(filters.type);
  }

  if (filters?.accountName && filters.accountName.trim().length > 0) {
    clauses.push('account_name = ?');
    args.push(filters.accountName.trim());
  }

  if (filters?.category && filters.category.trim().length > 0) {
    clauses.push('category = ?');
    args.push(filters.category.trim());
  }

  if (filters?.search && filters.search.trim().length > 0) {
    const token = `%${filters.search.trim()}%`;
    clauses.push('(note LIKE ? OR source LIKE ? OR category LIKE ? OR account_name LIKE ?)');
    args.push(token, token, token, token);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    args,
  };
}

function buildOrderBy(sortField: TransactionSortField, sortDirection: SortDirection): string {
  const directionSql = sortDirection === 'asc' ? 'ASC' : 'DESC';
  if (sortField === 'amount') {
    return `ORDER BY amount ${directionSql}, created_at ${directionSql}, id ${directionSql}`;
  }
  return `ORDER BY created_at ${directionSql}, id ${directionSql}`;
}

function buildCursorClause(
  sortField: TransactionSortField,
  sortDirection: SortDirection,
  cursor: TransactionCursor
): { sql: string; args: Array<string | number> } {
  if (sortField === 'date') {
    if (sortDirection === 'asc') {
      return {
        sql: '(created_at > ? OR (created_at = ? AND id > ?))',
        args: [cursor.createdAt, cursor.createdAt, cursor.id],
      };
    }
    return {
      sql: '(created_at < ? OR (created_at = ? AND id < ?))',
      args: [cursor.createdAt, cursor.createdAt, cursor.id],
    };
  }

  if (sortDirection === 'asc') {
    return {
      sql: `(
        amount > ?
        OR (amount = ? AND created_at > ?)
        OR (amount = ? AND created_at = ? AND id > ?)
      )`,
      args: [cursor.amount, cursor.amount, cursor.createdAt, cursor.amount, cursor.createdAt, cursor.id],
    };
  }

  return {
    sql: `(
      amount < ?
      OR (amount = ? AND created_at < ?)
      OR (amount = ? AND created_at = ? AND id < ?)
    )`,
    args: [cursor.amount, cursor.amount, cursor.createdAt, cursor.amount, cursor.createdAt, cursor.id],
  };
}

function toMonthBounds(referenceDate?: string): { start: string; end: string } {
  const base = referenceDate ? new Date(referenceDate) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toYearBounds(referenceDate?: string): { start: string; end: string } {
  const base = referenceDate ? new Date(referenceDate) : new Date();
  const start = new Date(base.getFullYear(), 0, 1);
  const end = new Date(base.getFullYear() + 1, 0, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

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
        currency_code,
        quantity,
        category,
        account_name,
        note,
        related_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.type,
    input.source ?? '',
    Number(input.amount.toFixed(2)),
    input.currencyCode ?? DEFAULT_CURRENCY_CODE,
    quantity,
    category,
    input.accountName ?? '',
    input.note ?? '',
    input.relatedId ?? null,
    createdAt
  );
}

export async function listTransactions(limit?: number): Promise<Transaction[]> {
  const page = await listTransactionsPage(
    {
      limit: limit && limit > 0 ? Math.floor(limit) : undefined,
      sortField: 'date',
      sortDirection: 'desc',
    },
    null
  );
  return page.items;
}

export async function listTransactionsPage(
  filters?: TransactionQueryFilters,
  cursor?: TransactionCursor | null
): Promise<TransactionPageResult> {
  const db = await getDb();
  const sortField = normalizeSortField(filters?.sortField);
  const sortDirection = normalizeSortDirection(filters?.sortDirection);
  const pageSize =
    filters?.limit && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.min(Math.floor(filters.limit), 200)
      : DEFAULT_PAGE_SIZE;

  const baseWhere = buildTransactionWhere(filters);
  const whereClauses: string[] = [];
  const args: Array<string | number> = [];

  if (baseWhere.whereSql) {
    whereClauses.push(baseWhere.whereSql.replace(/^WHERE\s+/i, ''));
    args.push(...baseWhere.args);
  }

  if (cursor) {
    const cursorWhere = buildCursorClause(sortField, sortDirection, cursor);
    whereClauses.push(cursorWhere.sql);
    args.push(...cursorWhere.args);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderSql = buildOrderBy(sortField, sortDirection);

  const rows = await db.getAllAsync<{
    id: number;
    type: string;
    source: string;
    amount: number;
    currency_code: string;
    quantity: number;
    category: string;
    account_name: string;
    note: string;
    related_id: number | null;
    created_at: string;
  }>(
    `
      SELECT id, type, source, amount, currency_code, quantity, category, account_name, note, related_id, created_at
      FROM transactions
      ${whereSql}
      ${orderSql}
      LIMIT ?
    `,
    ...args,
    pageSize + 1
  );

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map(mapTransactionRow);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? {
          id: last.id,
          createdAt: last.createdAt,
          amount: last.amount,
        }
      : null;

  return {
    items,
    nextCursor,
    hasMore,
  };
}

export async function listMonthlySummary(): Promise<MonthlyTransactionSummary[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    month_key: string;
    currency_code: string;
    total_expense: number;
    total_income: number;
  }>(`
    SELECT
      strftime('%Y-%m', created_at) AS month_key,
      currency_code,
      ROUND(SUM(CASE WHEN type IN ('expense', 'transfer_out') THEN amount ELSE 0 END), 2) AS total_expense,
      ROUND(SUM(CASE WHEN type IN ('income', 'transfer_in') THEN amount ELSE 0 END), 2) AS total_income
    FROM transactions
    GROUP BY month_key, currency_code
    ORDER BY month_key DESC, currency_code ASC
  `);

  return rows.map((row) => {
    const totalExpense = Number(row.total_expense ?? 0);
    const totalIncome = Number(row.total_income ?? 0);

    return {
      monthKey: row.month_key,
      currencyCode: row.currency_code || DEFAULT_CURRENCY_CODE,
      totalExpense,
      totalIncome,
      net: Number((totalIncome - totalExpense).toFixed(2)),
    };
  });
}

export async function getMonthlyFinancialSummary(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<MonthlyFinancialSummary> {
  const db = await getDb();
  const bounds = toMonthBounds(referenceDate);

  const row = await db.getFirstAsync<{
    income: number;
    expense: number;
  }>(
    `
      SELECT
        ROUND(SUM(CASE WHEN type IN ('income', 'transfer_in') THEN amount ELSE 0 END), 2) AS income,
        ROUND(SUM(CASE WHEN type IN ('expense', 'transfer_out') THEN amount ELSE 0 END), 2) AS expense
      FROM transactions
      WHERE created_at >= ? AND created_at < ? AND currency_code = ?
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );

  const income = Number(row?.income ?? 0);
  const expense = Number(row?.expense ?? 0);
  return {
    income,
    expense,
    balance: Number((income - expense).toFixed(2)),
  };
}

export async function getAnnualFinancialSummary(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<MonthlyFinancialSummary> {
  const db = await getDb();
  const bounds = toYearBounds(referenceDate);
  const row = await db.getFirstAsync<{ income: number; expense: number }>(
    `
      SELECT
        ROUND(SUM(CASE WHEN type IN ('income', 'transfer_in') THEN amount ELSE 0 END), 2) AS income,
        ROUND(SUM(CASE WHEN type IN ('expense', 'transfer_out') THEN amount ELSE 0 END), 2) AS expense
      FROM transactions
      WHERE created_at >= ? AND created_at < ? AND currency_code = ?
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );
  const income = Number(row?.income ?? 0);
  const expense = Number(row?.expense ?? 0);
  return { income, expense, balance: Number((income - expense).toFixed(2)) };
}

export async function listAnnualMonthlySummary(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<AnnualMonthlySummary[]> {
  const db = await getDb();
  const bounds = toYearBounds(referenceDate);
  const rows = await db.getAllAsync<{ month: string; income: number; expense: number }>(
    `
      SELECT
        strftime('%m', created_at) AS month,
        ROUND(SUM(CASE WHEN type IN ('income', 'transfer_in') THEN amount ELSE 0 END), 2) AS income,
        ROUND(SUM(CASE WHEN type IN ('expense', 'transfer_out') THEN amount ELSE 0 END), 2) AS expense
      FROM transactions
      WHERE created_at >= ? AND created_at < ? AND currency_code = ?
      GROUP BY month
      ORDER BY month ASC
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );
  return rows.map((row) => {
    const income = Number(row.income ?? 0);
    const expense = Number(row.expense ?? 0);
    return {
      month: Number(row.month),
      income,
      expense,
      balance: Number((income - expense).toFixed(2)),
    };
  });
}

export async function listAnnualCategoryTotals(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<CategoryTotal[]> {
  const db = await getDb();
  const bounds = toYearBounds(referenceDate);
  const rows = await db.getAllAsync<{ category: string; total: number }>(
    `
      SELECT category, ROUND(SUM(amount), 2) AS total
      FROM transactions
      WHERE type IN ('expense', 'transfer_out')
        AND created_at >= ? AND created_at < ?
        AND currency_code = ?
      GROUP BY category
      ORDER BY total DESC
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );
  return rows.map((row) => ({
    category: row.category || 'varios',
    total: Number(row.total ?? 0),
  }));
}

export async function listMonthlyCategoryTotals(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<CategoryTotal[]> {
  const db = await getDb();
  const bounds = toMonthBounds(referenceDate);

  const rows = await db.getAllAsync<{ category: string; total: number }>(
    `
      SELECT category, ROUND(SUM(amount), 2) AS total
      FROM transactions
      WHERE type IN ('expense', 'transfer_out')
        AND created_at >= ? AND created_at < ?
        AND currency_code = ?
      GROUP BY category
      ORDER BY total DESC
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );

  return rows.map((row) => ({
    category: row.category || 'varios',
    total: Number(row.total ?? 0),
  }));
}

export async function listMonthlyAccountMovementTotals(referenceDate?: string, currencyCode = DEFAULT_CURRENCY_CODE): Promise<AccountMovementTotal[]> {
  const db = await getDb();
  const bounds = toMonthBounds(referenceDate);

  const rows = await db.getAllAsync<{ account_name: string; total_movement: number }>(
    `
      SELECT account_name, ROUND(SUM(ABS(amount)), 2) AS total_movement
      FROM transactions
      WHERE created_at >= ? AND created_at < ?
        AND account_name IS NOT NULL
        AND TRIM(account_name) <> ''
        AND currency_code = ?
      GROUP BY account_name
      ORDER BY total_movement DESC
    `,
    bounds.start,
    bounds.end,
    currencyCode
  );

  return rows.map((row) => ({
    accountName: row.account_name,
    totalMovement: Number(row.total_movement ?? 0),
  }));
}

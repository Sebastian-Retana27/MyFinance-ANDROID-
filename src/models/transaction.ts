export type TransactionType = 'expense' | 'income' | 'transfer_in' | 'transfer_out';

export type Transaction = {
  id: number;
  type: TransactionType;
  source: string;
  amount: number;
  currencyCode: string;
  quantity: number;
  category: string;
  accountName: string;
  note: string;
  relatedId: number | null;
  createdAt: string;
};

export type MonthlyTransactionSummary = {
  monthKey: string;
  currencyCode: string;
  totalExpense: number;
  totalIncome: number;
  net: number;
};

export type TransactionSortField = 'date' | 'amount';
export type SortDirection = 'desc' | 'asc';

export type TransactionQueryFilters = {
  fromDate?: string;
  toDate?: string;
  type?: TransactionType;
  accountName?: string;
  category?: string;
  search?: string;
  sortField?: TransactionSortField;
  sortDirection?: SortDirection;
  limit?: number;
};

export type TransactionCursor = {
  id: number;
  createdAt: string;
  amount: number;
};

export type TransactionPageResult = {
  items: Transaction[];
  nextCursor: TransactionCursor | null;
  hasMore: boolean;
};

export type MonthlyFinancialSummary = {
  income: number;
  expense: number;
  balance: number;
};

export type AnnualMonthlySummary = {
  month: number;
  income: number;
  expense: number;
  balance: number;
};

export type CategoryTotal = {
  category: string;
  total: number;
};

export type AccountMovementTotal = {
  accountName: string;
  totalMovement: number;
};

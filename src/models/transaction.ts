export type TransactionType = 'expense' | 'income' | 'transfer_in' | 'transfer_out';

export type Transaction = {
  id: number;
  type: TransactionType;
  source: string;
  amount: number;
  quantity: number;
  category: string;
  accountName: string;
  note: string;
  relatedId: number | null;
  createdAt: string;
};

export type MonthlyTransactionSummary = {
  monthKey: string;
  totalExpense: number;
  totalIncome: number;
  net: number;
};

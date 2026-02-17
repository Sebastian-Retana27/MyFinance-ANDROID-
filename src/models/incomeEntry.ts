export type IncomeEntrySource = 'manual_add' | 'transfer_received';

export type IncomeEntry = {
  id: number;
  source: IncomeEntrySource;
  amount: number;
  accountName: string;
  createdAt: string;
};

export type AccountMovementType =
  | 'income_manual'
  | 'expense_manual'
  | 'expense_receipt'
  | 'transfer_in'
  | 'transfer_out'
  | 'account_adjustment';

export type AccountMovement = {
  id: number;
  type: AccountMovementType;
  amount: number;
  accountName: string;
  note: string;
  relatedId: number | null;
  createdAt: string;
};

export type Payable = {
  id: number;
  name: string;
  amount: number;
  currencyCode: string;
  category: string;
  dueDay: number;
  isPaid: boolean;
  paidAt: string;
  paidAccountName: string;
  createdAt: string;
};

/** All money values are integer cents. Positive = inflow, negative = outflow. */
export type Cents = number;
/** Month key, e.g. "2026-11". */
export type MonthKey = string;
/** ISO date, e.g. "2026-11-01". */
export type DateStr = string;

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit'
  | 'loan'
  | 'asset'
  | 'liability';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Budget accounts feed the budget; tracking accounts only count toward net worth. */
  onBudget: boolean;
  closed: boolean;
  note?: string;
}

export interface CategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  /** System groups (credit card payments) can't be renamed or deleted. */
  system?: boolean;
}

export type TargetType = 'monthly' | 'refill' | 'byDate' | 'balance';

export interface Target {
  type: TargetType;
  amount: Cents;
  /** Month the target is due (byDate only). */
  month?: MonthKey;
}

export interface Category {
  id: string;
  groupId: string;
  name: string;
  hidden: boolean;
  note?: string;
  target?: Target;
  /** Set on credit-card payment categories: the card this category pays. */
  ccAccountId?: string;
}

export type Cleared = 'uncleared' | 'cleared' | 'reconciled';

export interface Transaction {
  id: string;
  accountId: string;
  date: DateStr;
  payee: string;
  /** Category id, READY_TO_ASSIGN for income, or null (transfers / starting debt). */
  categoryId: string | null;
  memo: string;
  amount: Cents;
  cleared: Cleared;
  /** For transfers: the other account and the id of the matching transaction. */
  transferAccountId?: string;
  transferTxId?: string;
}

export interface BudgetData {
  version: 1;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  /** assigned[month][categoryId] = cents assigned that month. */
  assigned: Record<MonthKey, Record<string, Cents>>;
  /** Payee name -> last category used, to auto-fill new transactions. */
  payeeCategory: Record<string, string>;
  currency: string;
}

export const READY_TO_ASSIGN = 'rta';

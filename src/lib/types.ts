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
  /** For credit cards and loans: used by the debt payoff planner. */
  debt?: { apr: number; minPayment: Cents };
}

export interface CategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  /** System groups (credit card payments) can't be renamed or deleted. */
  system?: boolean;
}

/**
 * Target types (YNAB's names in quotes):
 * - weekly / monthly / yearly: "Set aside another…" (behavior 'setAside') or
 *   "Refill up to…" (behavior 'refill') each week, month or year.
 * - refill: older saved form of monthly + refill.
 * - custom: an amount due on a date ("Due on"), repeating monthly, yearly or not.
 * - byDate: "Have a balance of…" by a month. balance: "Have a balance of…".
 */
export type TargetType = 'weekly' | 'monthly' | 'refill' | 'yearly' | 'custom' | 'byDate' | 'balance';

export type TargetBehavior = 'setAside' | 'refill';

export interface Target {
  type: TargetType;
  amount: Cents;
  /** Month the target is due (byDate only). */
  month?: MonthKey;
  /** weekly / yearly / custom: set aside another, or refill (fill) up to. Default setAside. */
  behavior?: TargetBehavior;
  /** weekly: day of the week the week starts over (0 = Sunday). */
  weekday?: number;
  /** yearly: "MM-DD" each year; custom: "YYYY-MM-DD" (the first due date when repeating). */
  due?: string;
  /** custom only. */
  repeat?: 'none' | 'monthly' | 'yearly';
  /** Month the target was set up (for one-time "set aside" targets). */
  start?: MonthKey;
  /** Snoozed for this month only: it asks for nothing until the next month. */
  snoozed?: MonthKey;
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

/** One part of a split transaction. Amounts of all parts add up to the transaction amount. */
export interface Split {
  categoryId: string | null;
  amount: Cents;
  memo: string;
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
  /** When set, the amount is divided across categories (categoryId is null). */
  splits?: Split[];
  /** The person said this isn't one side of a transfer; don't suggest it again. */
  notTransfer?: boolean;
  /** Optional colored flag for grouping across categories. */
  flag?: FlagColor;
  /** Bank's id for this transaction (OFX FITID), used to skip re-imports. */
  importId?: string;
}

export const FLAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type FlagColor = (typeof FLAG_COLORS)[number];

export type Frequency =
  | 'once'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannually'
  | 'yearly';

/** A recurring (or one-time future) transaction that's entered automatically when due. */
export interface Scheduled {
  id: string;
  accountId: string;
  payee: string;
  categoryId: string | null;
  memo: string;
  amount: Cents;
  transferAccountId?: string;
  splits?: Split[];
  frequency: Frequency;
  /** First occurrence; later ones are computed from it so monthly dates don't drift. */
  startDate: DateStr;
  /** How many occurrences have been entered or skipped. */
  count: number;
  /** Optional last date to repeat on. */
  endDate?: DateStr;
}

export interface BudgetData {
  version: 1;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  scheduled: Scheduled[];
  /** assigned[month][categoryId] = cents assigned that month. */
  assigned: Record<MonthKey, Record<string, Cents>>;
  /** Payee name -> last category used, to auto-fill new transactions. */
  payeeCategory: Record<string, string>;
  currency: string;
  /** Optional names for flag colors, e.g. { blue: 'Reimbursable' }. */
  flagNames: Partial<Record<FlagColor, string>>;
}

export const READY_TO_ASSIGN = 'rta';

import { addDays, addMonths, monthLabel, monthOf, today } from './dates';
import { uid } from './id';
import { addAccount } from './ops';
import type { BudgetData, Cents, DateStr, LoanKind } from './types';

export const LOAN_KINDS: { value: LoanKind; label: string }[] = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'auto', label: 'Auto loan' },
  { value: 'student', label: 'Student loan' },
  { value: 'personal', label: 'Personal loan' },
  { value: 'medical', label: 'Medical debt' },
  { value: 'other', label: 'Other debt' },
];

export const LOAN_GROUP_NAME = 'Loan Payments';

export interface LoanInput {
  name: string;
  kind: LoanKind;
  /** Amount owed (positive). */
  owed: Cents;
  date: DateStr;
  /** Interest rate, percent per year. */
  apr: number;
  /** Required monthly payment toward the loan. */
  payment: Cents;
  escrow?: Cents;
}

/**
 * A loan is a tracking account plus a "<loan> Payment" category whose monthly
 * target is the payment (plus escrow). Paying the loan from a budget account
 * is a transfer categorized to that payment category.
 */
export function addLoan(data: BudgetData, input: LoanInput): BudgetData {
  const d = addAccount(data, { name: input.name, type: 'loan', onBudget: false, balance: -Math.abs(input.owed), date: input.date });
  const account = d.accounts[d.accounts.length - 1];
  account.debt = { apr: input.apr, minPayment: input.payment };
  account.loan = { kind: input.kind, interestThrough: monthOf(input.date), ...(input.escrow ? { escrow: input.escrow } : {}) };
  ensurePaymentCategory(d, account.id, input.payment + (input.escrow ?? 0));
  return d;
}

/** Change a loan's rate, payment or escrow; the payment category's target follows. */
export function updateLoan(data: BudgetData, id: string, patch: { apr: number; payment: Cents; escrow?: Cents; kind: LoanKind }): BudgetData {
  const d = structuredClone(data);
  const a = d.accounts.find((x) => x.id === id);
  if (!a) return data;
  a.debt = { apr: patch.apr, minPayment: patch.payment };
  a.loan = { interestThrough: a.loan?.interestThrough ?? monthOf(today()), kind: patch.kind };
  if (patch.escrow) a.loan.escrow = patch.escrow;
  ensurePaymentCategory(d, id, patch.payment + (patch.escrow ?? 0));
  return d;
}

/** Create (or update the target of) a loan's "<loan> Payment" category. Mutates `d`. */
function ensurePaymentCategory(d: BudgetData, accountId: string, monthly: Cents) {
  const existing = d.categories.find((c) => c.loanAccountId === accountId);
  if (existing) {
    existing.target = { type: 'monthly', amount: monthly };
    return;
  }
  let group = d.groups.find((g) => !g.system && g.name === LOAN_GROUP_NAME);
  if (!group) {
    group = { id: uid(), name: LOAN_GROUP_NAME, hidden: false };
    d.groups.push(group);
  }
  d.categories.push({
    id: uid(),
    groupId: group.id,
    name: `${d.accounts.find((a) => a.id === accountId)!.name} Payment`,
    hidden: false,
    loanAccountId: accountId,
    target: { type: 'monthly', amount: monthly },
  });
}

/** Last day of a month: "2026-02" -> "2026-02-28". */
const lastDay = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/**
 * Record a month's interest on each loan once the month is over, as an
 * "Interest" transaction on its last day. Catches up on missed months.
 */
export function postLoanInterest(data: BudgetData, today: DateStr): { data: BudgetData; posted: number } {
  const thisMonth = monthOf(today);
  const due = data.accounts.filter(
    (a) => !a.closed && a.loan && a.debt && a.debt.apr > 0 && addMonths(a.loan.interestThrough, 1) < thisMonth,
  );
  if (!due.length) return { data, posted: 0 };
  const d = structuredClone(data);
  let posted = 0;
  for (const original of due) {
    const a = d.accounts.find((x) => x.id === original.id)!;
    const loan = a.loan!;
    // Months after interestThrough that have fully ended.
    for (let m = addMonths(loan.interestThrough, 1), guard = 0; m < thisMonth && guard < 600; m = addMonths(m, 1), guard++) {
      const end = lastDay(m);
      const balance = d.transactions.filter((t) => t.accountId === a.id && t.date <= end).reduce((s, t) => s + t.amount, 0);
      const interest = balance < 0 ? Math.round((balance * a.debt!.apr) / 100 / 12) : 0;
      if (interest !== 0) {
        d.transactions.push({
          id: uid(),
          accountId: a.id,
          date: end,
          payee: 'Interest',
          categoryId: null,
          memo: `${monthLabel(m)} interest`,
          amount: interest,
          cleared: 'cleared',
        });
        posted++;
      }
      loan.interestThrough = m;
    }
  }
  return { data: d, posted };
}

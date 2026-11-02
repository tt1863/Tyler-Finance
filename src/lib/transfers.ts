import type { BudgetData, Transaction } from './types';

/** Two transactions that look like money moving between the person's own accounts. */
export interface TransferPair {
  /** Money leaving (negative amount). */
  from: Transaction;
  /** Money arriving (positive amount). */
  to: Transaction;
}

/** How many days apart the two sides of a transfer can be dated. */
const MAX_DAYS = 4;

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * Find likely transfers: opposite amounts in two different accounts, a few
 * days apart, where at least one side has no category yet (so transactions the
 * person entered and categorized on purpose aren't flagged).
 */
export function findTransferPairs(data: BudgetData): TransferPair[] {
  const closed = new Set(data.accounts.filter((a) => a.closed).map((a) => a.id));
  const eligible = (t: Transaction) =>
    !t.transferAccountId &&
    !t.splits?.length &&
    !t.notTransfer &&
    t.amount !== 0 &&
    t.payee !== 'Starting Balance' &&
    !closed.has(t.accountId);

  // Incoming money, grouped by amount.
  const incoming = new Map<number, Transaction[]>();
  for (const t of data.transactions) {
    if (eligible(t) && t.amount > 0) {
      const list = incoming.get(t.amount) ?? [];
      list.push(t);
      incoming.set(t.amount, list);
    }
  }

  // Pair closest dates first so each transaction is used at most once.
  const options: { from: Transaction; to: Transaction; gap: number }[] = [];
  for (const from of data.transactions) {
    if (!eligible(from) || from.amount >= 0) continue;
    for (const to of incoming.get(-from.amount) ?? []) {
      if (to.accountId === from.accountId) continue;
      if (from.categoryId !== null && to.categoryId !== null) continue;
      const gap = dayDiff(from.date, to.date);
      if (gap <= MAX_DAYS) options.push({ from, to, gap });
    }
  }
  options.sort((a, b) => a.gap - b.gap || b.from.date.localeCompare(a.from.date));

  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const o of options) {
    if (used.has(o.from.id) || used.has(o.to.id)) continue;
    used.add(o.from.id);
    used.add(o.to.id);
    pairs.push({ from: o.from, to: o.to });
  }
  return pairs.sort((a, b) => b.from.date.localeCompare(a.from.date));
}

/** Turn two existing transactions into the two sides of one transfer. */
export function linkAsTransfer(data: BudgetData, fromId: string, toId: string): BudgetData {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const from = data.transactions.find((t) => t.id === fromId);
  const to = data.transactions.find((t) => t.id === toId);
  if (!from || !to || from.accountId === to.accountId) return data;
  const fromAcct = accounts.get(from.accountId);
  const toAcct = accounts.get(to.accountId);
  // Between two budget accounts no category is needed. Between a budget and a
  // tracking account (e.g. a loan payment) the budget side keeps its category.
  const sameKind = fromAcct?.onBudget === toAcct?.onBudget;
  const side = (t: Transaction, other: Transaction, acct = accounts.get(t.accountId)): Transaction => ({
    ...t,
    payee: `Transfer : ${accounts.get(other.accountId)?.name ?? ''}`,
    // Keep the bank's description so nothing is lost.
    memo: t.memo || t.payee,
    categoryId: sameKind || !acct?.onBudget ? null : t.categoryId,
    transferAccountId: other.accountId,
    transferTxId: other.id,
  });
  const next = { [from.id]: side(from, to), [to.id]: side(to, from) };
  return { ...data, transactions: data.transactions.map((t) => next[t.id] ?? t) };
}

/** Remember that these two aren't a transfer, so they aren't suggested again. */
export function dismissTransfer(data: BudgetData, fromId: string, toId: string): BudgetData {
  return {
    ...data,
    transactions: data.transactions.map((t) => (t.id === fromId || t.id === toId ? { ...t, notTransfer: true } : t)),
  };
}

import { ruleMatches, suggestMatch } from '../../supabase/functions/_shared/payeeRules';
import { uid } from './id';
import type { BudgetData, PayeeRule, Transaction } from './types';

export { suggestMatch };

/** Imported transactions still waiting to be reviewed. */
export const isUnapproved = (t: Transaction) => t.approved === false;

export function approveTransactions(data: BudgetData, ids: string[]): BudgetData {
  const set = new Set(ids);
  return {
    ...data,
    transactions: data.transactions.map((t) => {
      if (!set.has(t.id) || t.approved !== false) return t;
      const { approved: _approved, ...rest } = t;
      return rest;
    }),
  };
}

/** Add or update a rule, then apply it to transactions that still need attention. */
export function saveRule(data: BudgetData, rule: Omit<PayeeRule, 'id'> & { id?: string }): { data: BudgetData; applied: number } {
  const full: PayeeRule = { ...rule, id: rule.id ?? uid(), match: rule.match.trim(), rename: rule.rename?.trim() || undefined };
  const exists = data.payeeRules.some((r) => r.id === full.id);
  const payeeRules = exists ? data.payeeRules.map((r) => (r.id === full.id ? full : r)) : [...data.payeeRules, full];
  return applyRule({ ...data, payeeRules }, full);
}

export function deleteRule(data: BudgetData, id: string): BudgetData {
  return { ...data, payeeRules: data.payeeRules.filter((r) => r.id !== id) };
}

/**
 * Apply a rule to transactions that haven't been reviewed or still need a
 * category. Reviewed, categorized transactions are left alone.
 */
export function applyRule(data: BudgetData, rule: PayeeRule): { data: BudgetData; applied: number } {
  let applied = 0;
  const transactions = data.transactions.map((t) => {
    if (t.transferAccountId || t.splits?.length) return t;
    if (!(t.approved === false || t.categoryId === null)) return t;
    if (!ruleMatches(rule, t.bankPayee ?? t.payee) && !ruleMatches(rule, t.payee)) return t;
    const next = { ...t, payee: rule.rename || t.payee, categoryId: rule.categoryId ?? t.categoryId };
    if (next.payee === t.payee && next.categoryId === t.categoryId) return t;
    applied++;
    return next;
  });
  return { data: applied ? { ...data, transactions } : data, applied };
}

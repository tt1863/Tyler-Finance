import { parseCsv } from './csv';
import { parseDate } from './dates';
import { uid } from './id';
import { parseMoney } from './money';
import { CC_GROUP_NAME, emptyData, normalize } from './ops';
import type { Account, AccountType, BudgetData, Category, Cleared, FlagColor, MonthKey, Split, Transaction } from './types';
import { FLAG_COLORS, READY_TO_ASSIGN } from './types';

/**
 * Import from YNAB's "Export Plan" files: the Register (every transaction)
 * and the Plan (assigned amounts per category per month).
 */

export interface YnabRow {
  account: string;
  flag: FlagColor | undefined;
  date: string;
  payee: string;
  group: string;
  category: string;
  memo: string;
  amount: number;
  cleared: Cleared;
}

export interface YnabPlanRow {
  month: MonthKey;
  group: string;
  category: string;
  assigned: number;
}

const col = (headers: string[], ...names: string[]) => headers.findIndex((h) => names.includes(h.trim().toLowerCase()));

export function parseRegister(text: string): { rows: YnabRow[]; errors: number } {
  const table = parseCsv(text.replace(/^﻿/, ''));
  if (table.length < 1) return { rows: [], errors: 0 };
  const h = table[0];
  const i = {
    account: col(h, 'account'),
    flag: col(h, 'flag'),
    date: col(h, 'date'),
    payee: col(h, 'payee'),
    groupCat: col(h, 'category group/category'),
    group: col(h, 'category group'),
    category: col(h, 'category'),
    memo: col(h, 'memo'),
    outflow: col(h, 'outflow'),
    inflow: col(h, 'inflow'),
    cleared: col(h, 'cleared'),
  };
  if (i.account < 0 || i.date < 0 || i.outflow < 0 || i.inflow < 0) throw new Error("This doesn't look like YNAB's Register file.");
  const rows: YnabRow[] = [];
  let errors = 0;
  for (const r of table.slice(1)) {
    const date = parseDate(r[i.date] ?? '');
    const out = parseMoney(r[i.outflow] ?? '') ?? null;
    const inn = parseMoney(r[i.inflow] ?? '') ?? null;
    if (!date || out === null || inn === null) {
      errors++;
      continue;
    }
    let group = i.group >= 0 ? (r[i.group] ?? '').trim() : '';
    let category = i.category >= 0 ? (r[i.category] ?? '').trim() : '';
    // Older exports only have the combined "Group: Category" column.
    if (!category && i.groupCat >= 0 && r[i.groupCat]) {
      const [g, ...c] = r[i.groupCat].split(':');
      group = g.trim();
      category = c.join(':').trim();
    }
    const flag = (r[i.flag] ?? '').trim().toLowerCase();
    const cleared = (r[i.cleared] ?? '').trim().toLowerCase();
    rows.push({
      account: (r[i.account] ?? '').trim(),
      flag: (FLAG_COLORS as readonly string[]).includes(flag) ? (flag as FlagColor) : undefined,
      date,
      payee: (r[i.payee] ?? '').trim(),
      group,
      category,
      memo: (r[i.memo] ?? '').trim(),
      amount: inn - Math.abs(out),
      cleared: cleared === 'reconciled' ? 'reconciled' : cleared === 'cleared' ? 'cleared' : 'uncleared',
    });
  }
  return { rows, errors };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseMonth(s: string): MonthKey | null {
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  const d = parseDate(s);
  return d ? d.slice(0, 7) : null;
}

export function parsePlan(text: string): YnabPlanRow[] {
  const table = parseCsv(text.replace(/^﻿/, ''));
  if (table.length < 1) return [];
  const h = table[0];
  const i = {
    month: col(h, 'month'),
    groupCat: col(h, 'category group/category'),
    group: col(h, 'category group'),
    category: col(h, 'category'),
    assigned: col(h, 'assigned', 'budgeted'),
  };
  if (i.month < 0 || i.assigned < 0) throw new Error("This doesn't look like YNAB's Plan file.");
  const out: YnabPlanRow[] = [];
  for (const r of table.slice(1)) {
    const month = parseMonth(r[i.month] ?? '');
    const assigned = parseMoney(r[i.assigned] ?? '');
    let group = i.group >= 0 ? (r[i.group] ?? '').trim() : '';
    let category = i.category >= 0 ? (r[i.category] ?? '').trim() : '';
    if (!category && i.groupCat >= 0 && r[i.groupCat]) {
      const [g, ...c] = r[i.groupCat].split(':');
      group = g.trim();
      category = c.join(':').trim();
    }
    if (!month || assigned === null || !category) continue;
    out.push({ month, group, category, assigned });
  }
  return out;
}

/** Pick out the two files from an export (zip contents or chosen files) by name. */
export function pickFiles(files: Record<string, string>): { register?: string; plan?: string } {
  const out: { register?: string; plan?: string } = {};
  for (const [name, text] of Object.entries(files)) {
    const n = name.toLowerCase();
    if (n.includes('register')) out.register = text;
    else if (n.includes('plan') || n.includes('budget')) out.plan = text;
  }
  return out;
}

const TRANSFER = /^Transfer\s*:\s*(.+)$/i;
const SPLIT = /^Split \((\d+)\/(\d+)\)\s*/;
const isRta = (group: string, category: string) =>
  /^inflow/i.test(group) || /ready to assign|to be budgeted/i.test(category);

export interface AccountGuess {
  name: string;
  type: AccountType;
  onBudget: boolean;
  transactions: number;
}

/** Guess each account's type from the files (the person can change it in the preview). */
export function guessAccounts(rows: YnabRow[], plan: YnabPlanRow[]): AccountGuess[] {
  const cardNames = new Set(plan.filter((p) => p.group === CC_GROUP_NAME).map((p) => p.category));
  for (const r of rows) if (r.group === CC_GROUP_NAME) cardNames.add(r.category);
  const byAccount = new Map<string, YnabRow[]>();
  for (const r of rows) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  return [...byAccount.entries()].map(([name, list]) => {
    const categorized = list.some((r) => r.category && !TRANSFER.test(r.payee));
    const balance = list.reduce((s, r) => s + r.amount, 0);
    let type: AccountType = /saving/i.test(name) ? 'savings' : /cash|wallet/i.test(name) ? 'cash' : 'checking';
    let onBudget = true;
    if (cardNames.has(name)) type = 'credit';
    else if (!categorized) {
      // No categorized spending: a tracking account (loan, investment, house…).
      onBudget = false;
      type = balance < 0 ? 'loan' : 'asset';
    }
    return { name, type, onBudget, transactions: list.length };
  });
}

export interface ImportSummary {
  accounts: number;
  categories: number;
  transactions: number;
  months: number;
  from: string;
  to: string;
  unmatchedTransfers: number;
}

/**
 * Build a budget from YNAB's export. With `base`, accounts, groups and
 * categories with the same names are reused and the rest added.
 */
export function buildFromYnab(
  rows: YnabRow[],
  plan: YnabPlanRow[],
  accounts: AccountGuess[],
  base: BudgetData | null,
): { data: BudgetData; summary: ImportSummary } {
  const d: BudgetData = base ? structuredClone(base) : emptyData();

  // Accounts (credit cards get their payment category).
  const accountId = new Map<string, string>();
  const ensureCcGroup = () => {
    let g = d.groups.find((x) => x.system);
    if (!g) d.groups.unshift((g = { id: uid(), name: CC_GROUP_NAME, hidden: false, system: true }));
    return g.id;
  };
  for (const a of accounts) {
    const existing = d.accounts.find((x) => x.name === a.name);
    if (existing) {
      accountId.set(a.name, existing.id);
      continue;
    }
    const acct: Account = { id: uid(), name: a.name, type: a.type, onBudget: a.onBudget, closed: false };
    d.accounts.push(acct);
    accountId.set(a.name, acct.id);
    if (a.type === 'credit' && a.onBudget) {
      d.categories.push({ id: uid(), groupId: ensureCcGroup(), name: a.name, hidden: false, ccAccountId: acct.id });
    }
  }

  // Categories: in the Plan's order, then any only seen in the Register.
  const catKey = (g: string, c: string) => `${g}\u0000${c}`;
  const catId = new Map<string, string>();
  const paymentByCard = new Map(d.categories.filter((c) => c.ccAccountId).map((c) => [d.accounts.find((a) => a.id === c.ccAccountId)?.name ?? '', c.id]));
  const ensureCategory = (group: string, name: string): string | null => {
    if (!name || isRta(group, name)) return null;
    const key = catKey(group, name);
    if (catId.has(key)) return catId.get(key)!;
    if (group === CC_GROUP_NAME && paymentByCard.has(name)) {
      catId.set(key, paymentByCard.get(name)!);
      return catId.get(key)!;
    }
    const groupName = group || 'Imported';
    let g = d.groups.find((x) => x.name === groupName && !x.system);
    if (!g) d.groups.push((g = { id: uid(), name: groupName, hidden: false }));
    let c: Category | undefined = d.categories.find((x) => x.groupId === g!.id && x.name === name);
    if (!c) d.categories.push((c = { id: uid(), groupId: g.id, name, hidden: false }));
    catId.set(key, c.id);
    return c.id;
  };
  for (const p of plan) ensureCategory(p.group, p.category);
  const categoryFor = (r: YnabRow): string | null => (isRta(r.group, r.category) ? READY_TO_ASSIGN : ensureCategory(r.group, r.category));

  // Transactions: rebuild splits from "Split (1/3)" rows, then pair transfers.
  const txs: Transaction[] = [];
  const pendingTransfers: { tx: Transaction; other: string }[] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const acct = accountId.get(r.account);
    if (!acct) continue;
    const split = r.memo.match(SPLIT);
    if (split && Number(split[1]) === 1) {
      const total = Number(split[2]);
      const parts = rows.slice(k, k + total);
      const same = parts.length === total && parts.every((p) => p.account === r.account && p.date === r.date && SPLIT.test(p.memo));
      if (same && !parts.some((p) => TRANSFER.test(p.payee))) {
        const splits: Split[] = parts.map((p) => ({ categoryId: categoryFor(p), amount: p.amount, memo: p.memo.replace(SPLIT, '') }));
        txs.push({
          id: uid(),
          accountId: acct,
          date: r.date,
          payee: r.payee,
          categoryId: null,
          memo: '',
          amount: parts.reduce((s, p) => s + p.amount, 0),
          cleared: r.cleared,
          splits,
          ...(r.flag ? { flag: r.flag } : {}),
        });
        k += total - 1;
        continue;
      }
    }
    const tx: Transaction = {
      id: uid(),
      accountId: acct,
      date: r.date,
      payee: r.payee,
      categoryId: categoryFor(r),
      memo: r.memo.replace(SPLIT, ''),
      amount: r.amount,
      cleared: r.cleared,
      ...(r.flag ? { flag: r.flag } : {}),
    };
    const t = r.payee.match(TRANSFER);
    if (t && accountId.has(t[1].trim())) pendingTransfers.push({ tx, other: t[1].trim() });
    txs.push(tx);
  }

  // Pair each transfer with the opposite transaction in the other account.
  const open = new Map<string, Transaction[]>();
  for (const { tx } of pendingTransfers) {
    const key = `${tx.accountId}|${tx.amount}`;
    open.set(key, [...(open.get(key) ?? []), tx]);
  }
  let unmatched = 0;
  const done = new Set<string>();
  for (const { tx, other } of pendingTransfers) {
    if (done.has(tx.id)) continue;
    const otherId = accountId.get(other)!;
    const candidates = (open.get(`${otherId}|${-tx.amount}`) ?? []).filter(
      (c) => !done.has(c.id) && c.payee.match(TRANSFER)?.[1].trim() === d.accounts.find((a) => a.id === tx.accountId)?.name,
    );
    const match = candidates.sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(tx.date)) - Math.abs(Date.parse(b.date) - Date.parse(tx.date)))[0];
    if (!match) {
      unmatched++;
      continue;
    }
    tx.transferAccountId = otherId;
    tx.transferTxId = match.id;
    match.transferAccountId = tx.accountId;
    match.transferTxId = tx.id;
    // Budget-to-budget transfers have no category.
    const onBudget = (id: string) => d.accounts.find((a) => a.id === id)?.onBudget;
    if (onBudget(tx.accountId) === onBudget(otherId)) {
      tx.categoryId = null;
      match.categoryId = null;
    }
    done.add(tx.id);
    done.add(match.id);
  }
  d.transactions.push(...txs);

  // Assigned amounts.
  const months = new Set<string>();
  for (const p of plan) {
    if (!p.assigned) continue;
    const id = ensureCategory(p.group, p.category);
    if (!id) continue;
    const row = (d.assigned[p.month] ??= {});
    row[id] = (row[id] ?? 0) + p.assigned;
    months.add(p.month);
  }

  // Remember each payee's latest category, for auto-fill.
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.payee && t.categoryId && t.categoryId !== READY_TO_ASSIGN && !t.transferAccountId) d.payeeCategory[t.payee] = t.categoryId;
  }

  const dates = txs.map((t) => t.date).sort();
  return {
    data: normalize(d),
    summary: {
      accounts: accounts.length,
      categories: catId.size,
      transactions: txs.length,
      months: months.size,
      from: dates[0] ?? '',
      to: dates[dates.length - 1] ?? '',
      unmatchedTransfers: unmatched,
    },
  };
}

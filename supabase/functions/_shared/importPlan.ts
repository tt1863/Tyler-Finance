import { findRule, type PayeeRule } from './payeeRules.ts';

/**
 * Turns bank transactions from Plaid into the app's budget transactions.
 * Pure logic (no network), shared by the server functions and unit tests.
 */

export interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  /** Plaid: positive = money out. */
  amount: number;
  date: string;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
}

/** The app's transaction shape (see src/lib/types.ts). */
export interface AppTxn {
  id: string;
  accountId: string;
  date: string;
  payee: string;
  categoryId: string | null;
  memo: string;
  amount: number;
  cleared: 'uncleared' | 'cleared' | 'reconciled';
  transferAccountId?: string;
  transferTxId?: string;
  splits?: { categoryId: string | null; amount: number; memo: string }[];
  /** Plaid transaction id this transaction came from or was matched to. */
  bankId?: string;
  /** The bank's own description, before payee rules. */
  bankPayee?: string;
  /** false = imported and waiting for the person to review it. */
  approved?: boolean;
}

export interface AccountLink {
  /** App account that receives this bank account's transactions. */
  appAccountId: string;
  /** Ignore bank transactions dated before this (YYYY-MM-DD). */
  importFrom: string;
}

export interface PlanInput {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: { transaction_id: string }[];
  /** Bank account id -> app account. Unlinked accounts are skipped. */
  links: Record<string, AccountLink>;
  /** All current app transactions (any account). */
  existing: AppTxn[];
  /** Payee -> category the user picked last time. */
  payeeCategory: Record<string, string>;
  /** Bank transaction ids the user deleted after import; never re-add them. */
  deletedBankIds?: Set<string>;
  /** Payee rules (rename + category). */
  rules?: PayeeRule[];
}

export interface PlanOutput {
  upserts: AppTxn[];
  deletes: string[];
}

/** How many days apart a bank transaction and a hand-entered one can be and still match. */
const MATCH_DAYS = 4;

const toCents = (plaidAmount: number) => -Math.round(plaidAmount * 100);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

export function planImport(input: PlanInput): PlanOutput {
  const byId = new Map(input.existing.map((t) => [t.id, t]));
  const byBankId = new Map<string, AppTxn>();
  for (const t of input.existing) if (t.bankId) byBankId.set(t.bankId, t);

  const changed = new Map<string, AppTxn>();
  const deletes = new Set<string>();
  const save = (t: AppTxn) => {
    changed.set(t.id, t);
    byId.set(t.id, t);
    if (t.bankId) byBankId.set(t.bankId, t);
  };

  /** Update an existing app transaction from the bank, keeping the user's own edits. */
  const refresh = (t: AppTxn, p: PlaidTxn): AppTxn => ({
    ...t,
    bankId: p.transaction_id,
    amount: t.splits?.length ? t.amount : toCents(p.amount),
    date: p.date,
    // Reconciled stays reconciled; otherwise follow the bank.
    cleared: t.cleared === 'reconciled' ? 'reconciled' : p.pending ? 'uncleared' : 'cleared',
  });

  const handle = (p: PlaidTxn) => {
    const link = input.links[p.account_id];
    if (!link) return;

    // Already imported: update it.
    const known = byBankId.get(p.transaction_id);
    if (known) {
      const next = refresh(known, p);
      if (JSON.stringify(next) !== JSON.stringify(known)) save(next);
      return;
    }
    // A pending charge that has now posted: update the pending one in place so
    // its category and memo carry over.
    if (p.pending_transaction_id) {
      const pending = byBankId.get(p.pending_transaction_id);
      if (pending) {
        byBankId.delete(p.pending_transaction_id);
        save(refresh(pending, p));
        return;
      }
    }
    if (p.date < link.importFrom) return;
    const deleted = input.deletedBankIds;
    if (deleted && (deleted.has(p.transaction_id) || (p.pending_transaction_id && deleted.has(p.pending_transaction_id)))) return;

    // A transaction the user already entered by hand: link it instead of adding a duplicate.
    const amount = toCents(p.amount);
    const manual = [...byId.values()]
      .filter((t) => t.accountId === link.appAccountId && !t.bankId && t.amount === amount && dayDiff(t.date, p.date) <= MATCH_DAYS)
      .sort((a, b) => dayDiff(a.date, p.date) - dayDiff(b.date, p.date))[0];
    if (manual) {
      save({ ...manual, bankId: p.transaction_id, cleared: manual.cleared === 'reconciled' ? 'reconciled' : p.pending ? 'uncleared' : 'cleared' });
      return;
    }

    // A rule may match either the clean merchant name or the bank's full description.
    const merchant = (p.merchant_name || p.name || '').trim();
    const description = (p.name || merchant).trim();
    const rules = input.rules ?? [];
    const rule = findRule(rules, merchant) ?? findRule(rules, description);
    const payee = rule?.rename?.trim() || merchant;
    const categoryId = rule?.categoryId ?? input.payeeCategory[payee] ?? input.payeeCategory[merchant] ?? null;
    save({
      id: `bank-${p.transaction_id}`,
      accountId: link.appAccountId,
      date: p.date,
      payee,
      categoryId,
      memo: '',
      amount,
      cleared: p.pending ? 'uncleared' : 'cleared',
      bankId: p.transaction_id,
      bankPayee: description,
      approved: false,
    });
  };

  for (const p of input.added) handle(p);
  for (const p of input.modified) handle(p);

  for (const r of input.removed) {
    const t = byBankId.get(r.transaction_id);
    if (!t) continue;
    byBankId.delete(r.transaction_id);
    if (t.id.startsWith('bank-') && t.cleared !== 'reconciled') {
      changed.delete(t.id);
      deletes.add(t.id);
      // If it was one side of a transfer, the other side becomes a normal
      // transaction again instead of pointing at nothing.
      const partner = t.transferTxId ? byId.get(t.transferTxId) : undefined;
      if (partner && !deletes.has(partner.id)) {
        const { transferAccountId: _a, transferTxId: _b, ...rest } = partner;
        save({ ...rest, payee: rest.memo || rest.payee, categoryId: null });
      }
    } else {
      // Entered by hand or reconciled: keep it, just unlink it from the bank.
      const { bankId: _unlinked, ...rest } = t;
      save(rest);
    }
  }

  return { upserts: [...changed.values()], deletes: [...deletes] };
}

/** Bank balance in app terms (cents; debts negative). */
export function appBalance(current: number | null | undefined, type: string): number {
  const cents = Math.round((current ?? 0) * 100);
  return type === 'credit' || type === 'loan' ? -cents : cents;
}

/**
 * New app accounts start with a "Starting Balance" of 0. After the first
 * import, set it so the account's total matches the bank balance.
 */
export function startingBalanceFix(
  all: AppTxn[],
  appAccountId: string,
  bankBalance: number,
): AppTxn | null {
  const inAccount = all.filter((t) => t.accountId === appAccountId);
  const start = inAccount.find((t) => t.payee === 'Starting Balance' && !t.bankId);
  if (!start) return null;
  const others = inAccount.filter((t) => t !== start).reduce((s, t) => s + t.amount, 0);
  const firstDate = inAccount.filter((t) => t !== start).map((t) => t.date).sort()[0];
  const amount = bankBalance - others;
  const date = firstDate && firstDate <= start.date ? prevDay(firstDate) : start.date;
  if (amount === start.amount && date === start.date) return null;
  return { ...start, amount, date };
}

function prevDay(date: string): string {
  const d = new Date(Date.parse(date) - 86400000);
  return d.toISOString().slice(0, 10);
}

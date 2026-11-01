import { useMemo, useState } from 'react';
import AccountForm, { accountTypeLabel } from '../components/AccountForm';
import { categoryName } from '../components/CategorySelect';
import ImportModal from '../components/ImportModal';
import Modal from '../components/Modal';
import TransactionForm from '../components/TransactionForm';
import { accountBalances } from '../lib/budget';
import { dateLabel } from '../lib/dates';
import { fmt, parseMoney } from '../lib/money';
import { deleteTransactions, needsCategory, reconcile, setCleared } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { Transaction } from '../lib/types';

export default function AccountPage({ accountId }: { accountId: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isAll = accountId === 'all';
  const account = data.accounts.find((a) => a.id === accountId);
  const balances = useMemo(() => accountBalances(data), [data]);
  const [search, setSearch] = useState('');
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);

  const accountName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);
  const uncategorized = useMemo(
    () => needsCategory(data).filter((t) => isAll || t.accountId === accountId),
    [data, isAll, accountId],
  );
  const uncategorizedIds = useMemo(() => new Set(uncategorized.map((t) => t.id)), [uncategorized]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.transactions
      .filter((t) => isAll || t.accountId === accountId)
      .filter((t) => !onlyUncategorized || uncategorizedIds.has(t.id))
      .filter(
        (t) =>
          !q ||
          t.payee.toLowerCase().includes(q) ||
          t.memo.toLowerCase().includes(q) ||
          categoryName(data, t.categoryId).toLowerCase().includes(q) ||
          (t.amount / 100).toFixed(2).includes(q),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [data, accountId, isAll, search, onlyUncategorized, uncategorizedIds]);

  if (!isAll && !account) {
    return <p className="empty">Account not found.</p>;
  }

  const totals = isAll
    ? data.accounts.reduce(
        (t, a) => ({
          cleared: t.cleared + balances[a.id].cleared,
          uncleared: t.uncleared + balances[a.id].uncleared,
          working: t.working + balances[a.id].working,
        }),
        { cleared: 0, uncleared: 0, working: 0 },
      )
    : balances[accountId];

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cycleCleared = (t: Transaction) => {
    if (t.cleared === 'reconciled') return;
    update((d) => setCleared(d, t.id, t.cleared === 'cleared' ? 'uncleared' : 'cleared'));
  };

  return (
    <div className="account-page">
      <div className="account-header">
        <div>
          <h1>
            {isAll ? 'All Accounts' : account!.name}
            {account && (
              <button className="link-btn small" onClick={() => setEditingAccount(true)}>
                Edit
              </button>
            )}
          </h1>
          {account && (
            <p className="muted small">
              {accountTypeLabel(account.type)} · {account.onBudget ? 'Budget account' : 'Tracking account'}
              {account.closed && ' · Closed'}
            </p>
          )}
        </div>
        <div className="balances">
          <div>
            <span className="label">Cleared</span>
            <span className={totals.cleared < 0 ? 'neg' : ''}>{fmt(totals.cleared)}</span>
          </div>
          <span className="op">+</span>
          <div>
            <span className="label">Uncleared</span>
            <span className={totals.uncleared < 0 ? 'neg' : ''}>{fmt(totals.uncleared)}</span>
          </div>
          <span className="op">=</span>
          <div>
            <span className="label">Working Balance</span>
            <b className={totals.working < 0 ? 'neg' : ''}>{fmt(totals.working)}</b>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!data.accounts.length}>
          + Add Transaction
        </button>
        {account && (
          <>
            <button className="btn" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn" onClick={() => setReconciling(true)}>
              Reconcile
            </button>
          </>
        )}
        {selected.size > 0 && (
          <button
            className="btn danger-outline"
            onClick={() => {
              if (!confirm(`Delete ${selected.size} transactions?`)) return;
              update((d) => deleteTransactions(d, [...selected]));
              setSelected(new Set());
            }}
          >
            Delete {selected.size} selected
          </button>
        )}
        <span className="spacer" />
        <label className="checkbox inline small">
          <input type="checkbox" checked={onlyUncategorized} onChange={(e) => setOnlyUncategorized(e.target.checked)} />
          Needs category ({uncategorized.length})
        </label>
        <input className="search" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className={`register ${isAll ? 'with-account' : ''}`}>
        <div className="reg-row head">
          <span />
          <span>Date</span>
          {isAll && <span>Account</span>}
          <span>Payee</span>
          <span>Category</span>
          <span>Memo</span>
          <span className="num">Outflow</span>
          <span className="num">Inflow</span>
          <span className="center" title="Cleared">
            C
          </span>
        </div>
        {rows.slice(0, limit).map((t) => {
          const needs = uncategorizedIds.has(t.id);
          return (
            <div key={t.id} className={`reg-row ${selected.has(t.id) ? 'selected' : ''}`} onClick={() => setEditing(t)}>
              <span onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Select" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
              </span>
              <span className="date">{dateLabel(t.date)}</span>
              {isAll && <span className="acct truncate">{accountName.get(t.accountId)}</span>}
              <span className="payee truncate">{t.payee || <i className="muted">No payee</i>}</span>
              <span className={`category truncate ${needs ? 'needs' : ''}`}>
                {needs ? 'Needs category' : t.transferAccountId && !t.categoryId ? '' : categoryName(data, t.categoryId)}
              </span>
              <span className="memo truncate muted">{t.memo}</span>
              <span className="num out">{t.amount < 0 ? fmt(-t.amount) : ''}</span>
              <span className="num in">{t.amount > 0 ? fmt(t.amount) : ''}</span>
              <span className="center" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`cleared ${t.cleared}`}
                  aria-label={t.cleared}
                  title={t.cleared === 'reconciled' ? 'Reconciled' : t.cleared === 'cleared' ? 'Cleared' : 'Uncleared'}
                  onClick={() => cycleCleared(t)}
                >
                  {t.cleared === 'reconciled' ? '🔒' : 'C'}
                </button>
              </span>
              <span className="amount-mobile">
                <span className={t.amount < 0 ? 'neg' : 'pos'}>{fmt(t.amount)}</span>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <p className="empty">No transactions{search ? ' match your search' : ' yet'}.</p>}
        {rows.length > limit && (
          <button className="btn more" onClick={() => setLimit((l) => l + 200)}>
            Show more ({rows.length - limit} remaining)
          </button>
        )}
      </div>

      {editing && (
        <TransactionForm
          transaction={editing === 'new' ? undefined : editing}
          defaultAccountId={isAll ? undefined : accountId}
          onClose={() => setEditing(null)}
        />
      )}
      {editingAccount && account && <AccountForm account={account} onClose={() => setEditingAccount(false)} />}
      {importing && account && <ImportModal accountId={account.id} onClose={() => setImporting(false)} />}
      {reconciling && account && (
        <ReconcileModal
          cleared={balances[account.id].cleared}
          onClose={() => setReconciling(false)}
          onReconcile={(bank) => {
            update((d) => reconcile(d, account.id, bank));
            setReconciling(false);
          }}
        />
      )}
    </div>
  );
}

function ReconcileModal({
  cleared,
  onClose,
  onReconcile,
}: {
  cleared: number;
  onClose: () => void;
  onReconcile: (bankBalance: number) => void;
}) {
  const [step, setStep] = useState<'ask' | 'enter'>('ask');
  const [value, setValue] = useState('');
  const bank = parseMoney(value);
  return (
    <Modal title="Reconcile Account" onClose={onClose}>
      {step === 'ask' ? (
        <div className="form center">
          <p>Is your current bank balance</p>
          <p className="big">{fmt(cleared)}?</p>
          <div className="row">
            <button className="btn primary" onClick={() => onReconcile(cleared)}>
              Yes
            </button>
            <button className="btn" onClick={() => setStep('enter')}>
              No
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => (e.preventDefault(), bank !== null && onReconcile(bank))}>
          <label>
            What is your bank balance? (negative for money owed)
            <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {bank !== null && bank !== cleared && (
            <p className="hint">
              Difference: <b>{fmt(bank - cleared)}</b>. Check for missing or uncleared transactions first — otherwise an adjustment
              will be added.
            </p>
          )}
          <button className="btn primary" type="submit" disabled={bank === null}>
            {bank !== null && bank !== cleared ? 'Create adjustment & finish' : 'Finish'}
          </button>
        </form>
      )}
    </Modal>
  );
}

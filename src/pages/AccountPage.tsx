import { useMemo, useState } from 'react';
import AccountForm, { accountTypeLabel } from '../components/AccountForm';
import CategorySelect, { transactionCategoryLabel } from '../components/CategorySelect';
import { FlagDot } from '../components/FlagPicker';
import BulkBar from '../components/BulkBar';
import ImportModal from '../components/ImportModal';
import { FLAG_COLORS, flagLabel } from '../lib/flags';
import { EMPTY_FILTER, isFiltering, matches, totals, type TxFilter } from '../lib/search';
import ScheduledList from '../components/ScheduledList';
import TransferSuggestions from '../components/TransferSuggestions';
import Modal from '../components/Modal';
import TransactionForm from '../components/TransactionForm';
import { accountBalances } from '../lib/budget';
import { dateLabel } from '../lib/dates';
import { fmt, parseMoney } from '../lib/money';
import { needsCategory, reconcile, setCleared } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { Transaction } from '../lib/types';

export default function AccountPage({ accountId }: { accountId: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isAll = accountId === 'all';
  const account = data.accounts.find((a) => a.id === accountId);
  const balances = useMemo(() => accountBalances(data), [data]);
  const [filter, setFilter] = useState<TxFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const setF = (patch: Partial<TxFilter>) => setFilter((f) => ({ ...f, ...patch }));
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
    const label = (t: Transaction) => transactionCategoryLabel(data, t);
    return data.transactions
      .filter((t) => isAll || t.accountId === accountId)
      .filter((t) => !onlyUncategorized || uncategorizedIds.has(t.id))
      .filter((t) => matches(data, t, filter, label))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [data, accountId, isAll, filter, onlyUncategorized, uncategorizedIds]);
  const filtering = isFiltering(filter) || onlyUncategorized;
  const activeFilters = [filter.categoryId, filter.flag, filter.from || filter.to || null, filter.min ?? filter.max, filter.cleared !== 'all' ? 1 : null].filter((x) => x !== null && x !== '').length;

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
        <span className="spacer" />
        <label className="checkbox inline small">
          <input type="checkbox" checked={onlyUncategorized} onChange={(e) => setOnlyUncategorized(e.target.checked)} />
          Needs category ({uncategorized.length})
        </label>
        <input className="search" type="search" placeholder="Search…" value={filter.text} onChange={(e) => setF({ text: e.target.value })} />
        <button className={`btn small ${activeFilters ? 'primary' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="filter-panel">
          <label className="wide">
            Category
            <CategorySelect data={data} value={filter.categoryId} onChange={(id) => setF({ categoryId: id })} includeRta includeNone="Any category" />
          </label>
          <label className="wide">
            Flag
            <select value={filter.flag ?? ''} onChange={(e) => setF({ flag: (e.target.value || null) as TxFilter['flag'] })}>
              <option value="">Any or none</option>
              <option value="any">Any flag</option>
              {FLAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {flagLabel(data, c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={filter.from} onChange={(e) => setF({ from: e.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={filter.to} onChange={(e) => setF({ to: e.target.value })} />
          </label>
          <label>
            Amount from
            <input inputMode="decimal" placeholder="0.00" defaultValue="" onChange={(e) => setF({ min: e.target.value.trim() ? parseMoney(e.target.value) : null })} />
          </label>
          <label>
            Amount to
            <input inputMode="decimal" placeholder="Any" defaultValue="" onChange={(e) => setF({ max: e.target.value.trim() ? parseMoney(e.target.value) : null })} />
          </label>
          <label className="wide">
            Status
            <select value={filter.cleared} onChange={(e) => setF({ cleared: e.target.value as TxFilter['cleared'] })}>
              <option value="all">Cleared and uncleared</option>
              <option value="cleared">Cleared</option>
              <option value="uncleared">Uncleared</option>
            </select>
          </label>
          <button className="btn small" onClick={() => setFilter({ ...EMPTY_FILTER, text: filter.text })}>
            Reset filters
          </button>
        </div>
      )}
      {filtering && <FilterTotals list={rows} />}

      <TransferSuggestions accountId={accountId} />
      <ScheduledList accountId={accountId} />

      <div className={`register ${isAll ? 'with-account' : ''}`}>
        <div className="reg-row head">
          <span>
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={rows.length > 0 && rows.slice(0, limit).every((t) => selected.has(t.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(rows.slice(0, limit).map((t) => t.id)) : new Set())}
            />
          </span>
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
              <span className="payee truncate">
                <FlagDot data={data} color={t.flag} />{t.payee || <i className="muted">No payee</i>}</span>
              <span className={`category truncate ${needs ? 'needs' : ''}`}>
                {needs && !t.splits ? 'Needs category' : t.transferAccountId && !t.categoryId ? '' : transactionCategoryLabel(data, t)}
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
        {rows.length === 0 && <p className="empty">No transactions{filtering ? ' match' : ' yet'}.</p>}
        {rows.length > limit && (
          <button className="btn more" onClick={() => setLimit((l) => l + 200)}>
            Show more ({rows.length - limit} remaining)
          </button>
        )}
      </div>

      {selected.size > 0 && <BulkBar selected={selected} onClear={() => setSelected(new Set())} />}
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

/** Count and totals of the transactions a search or filter matched. */
function FilterTotals({ list }: { list: Transaction[] }) {
  const t = totals(list);
  return (
    <div className="filter-totals" role="status">
      <span>
        <b>{t.count}</b> matching
      </span>
      <span>
        Out <b className="neg">{fmt(t.outflow)}</b>
      </span>
      <span>
        In <b className="pos">{fmt(t.inflow)}</b>
      </span>
      <span>
        Net <b className={t.net < 0 ? 'neg' : 'pos'}>{fmt(t.net)}</b>
      </span>
    </div>
  );
}

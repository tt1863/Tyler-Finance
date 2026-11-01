import { useMemo, useState } from 'react';
import { today } from '../lib/dates';
import { parseMoney, toInput } from '../lib/money';
import { deleteTransactions, saveTransaction } from '../lib/ops';
import { deleteScheduled, FREQUENCIES, nextDate, processDue, saveScheduled } from '../lib/scheduled';
import { useData, useStore } from '../lib/store';
import type { BudgetData, Frequency, Scheduled, Transaction } from '../lib/types';
import { READY_TO_ASSIGN } from '../lib/types';
import CategorySelect from './CategorySelect';
import Modal from './Modal';

const TRANSFER_PREFIX = 'Transfer : ';

export default function TransactionForm({
  transaction: tx,
  scheduled,
  defaultAccountId,
  onClose,
}: {
  transaction?: Transaction;
  /** When set, the form edits this scheduled transaction instead. */
  scheduled?: Scheduled;
  defaultAccountId?: string;
  onClose: () => void;
}) {
  const data = useData();
  const update = useStore((s) => s.update);
  // A schedule is edited with the same fields as a transaction.
  const transaction: Transaction | undefined = scheduled
    ? { ...scheduled, date: nextDate(scheduled) ?? scheduled.startDate, cleared: 'uncleared' }
    : tx;
  const [repeat, setRepeat] = useState<Frequency | 'never'>(scheduled?.frequency ?? 'never');
  const [endDate, setEndDate] = useState(scheduled?.endDate ?? '');
  const openAccounts = data.accounts.filter((a) => !a.closed || a.id === transaction?.accountId);
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaultAccountId ?? openAccounts[0]?.id ?? '');
  const [date, setDate] = useState(transaction?.date ?? today());
  const [payee, setPayee] = useState(transaction?.payee ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(transaction?.categoryId ?? null);
  const [memo, setMemo] = useState(transaction?.memo ?? '');
  const [direction, setDirection] = useState<'out' | 'in'>(transaction && transaction.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(toInput(Math.abs(transaction?.amount ?? 0)));
  const [cleared, setCleared] = useState(transaction?.cleared ?? 'uncleared');
  const [error, setError] = useState('');

  const account = data.accounts.find((a) => a.id === accountId);
  const payees = useMemo(() => {
    const set = new Set<string>();
    for (const t of data.transactions) if (!t.transferAccountId && t.payee) set.add(t.payee);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data.transactions]);

  const transferTarget = payee.startsWith(TRANSFER_PREFIX)
    ? data.accounts.find((a) => a.name === payee.slice(TRANSFER_PREFIX.length).trim() && a.id !== accountId)
    : undefined;
  // Transfers between two budget accounts (or two tracking accounts) don't use a category.
  const needsCategory = account?.onBudget && (!transferTarget || !transferTarget.onBudget);

  const onPayeeChange = (value: string) => {
    setPayee(value);
    const remembered = data.payeeCategory[value];
    if (remembered && !categoryId) setCategoryId(remembered);
  };

  const save = (addAnother = false) => {
    if (!account) return setError('Choose an account.');
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter a valid amount.');
    if (payee.startsWith(TRANSFER_PREFIX) && !transferTarget) return setError('Choose a valid account to transfer to.');
    const signed = direction === 'out' ? -Math.abs(cents) : Math.abs(cents);
    const fields = {
      accountId,
      payee: transferTarget ? `${TRANSFER_PREFIX}${transferTarget.name}` : payee.trim(),
      categoryId: needsCategory ? categoryId : null,
      memo: memo.trim(),
      amount: signed,
      transferAccountId: transferTarget?.id,
    };
    // Repeating transactions, and one-time transactions dated in the future,
    // become scheduled transactions. Anything already due is entered now.
    const frequency: Frequency | null = repeat !== 'never' ? repeat : !tx && date > today() ? 'once' : null;
    if (frequency) {
      if (endDate && endDate < date) return setError('End date must be after the first date.');
      const unchanged = scheduled && date === nextDate(scheduled) && frequency === scheduled.frequency;
      update((d: BudgetData) => {
        let next = saveScheduled(d, {
          id: scheduled?.id,
          ...fields,
          frequency,
          startDate: unchanged ? scheduled.startDate : date,
          endDate: frequency !== 'once' && endDate ? endDate : undefined,
        });
        if (unchanged) next = { ...next, scheduled: next.scheduled.map((x) => (x.id === scheduled.id ? { ...x, count: scheduled.count } : x)) };
        return processDue(next, today()).data;
      });
      return onClose();
    }
    update((d) =>
      saveTransaction(d, {
        id: transaction?.id,
        accountId,
        date,
        payee,
        categoryId: needsCategory ? categoryId : null,
        memo,
        amount: signed,
        cleared,
        transferAccountId: transferTarget?.id,
      }),
    );
    if (addAnother) {
      setPayee('');
      setCategoryId(null);
      setMemo('');
      setAmount('');
      setError('');
    } else onClose();
  };

  return (
    <Modal
      title={scheduled ? 'Edit Scheduled Transaction' : transaction ? 'Edit Transaction' : 'Add Transaction'}
      onClose={onClose}
      footer={
        <>
          {(tx || scheduled) && (
            <button
              className="btn danger-outline"
              onClick={() => {
                if (scheduled) update((d) => deleteScheduled(d, scheduled.id));
                else if (tx) update((d) => deleteTransactions(d, [tx.id]));
                onClose();
              }}
            >
              {scheduled ? 'Delete schedule' : 'Delete'}
            </button>
          )}
          <span className="spacer" />
          {!transaction && repeat === 'never' && (
            <button className="btn" onClick={() => save(true)}>
              Save & add another
            </button>
          )}
          <button className="btn primary" onClick={() => save()}>
            Save
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="segmented">
          <button type="button" className={direction === 'out' ? 'active out' : ''} onClick={() => setDirection('out')}>
            − Outflow
          </button>
          <button type="button" className={direction === 'in' ? 'active in' : ''} onClick={() => setDirection('in')}>
            + Inflow
          </button>
        </div>
        <label>
          Amount
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </label>
        <label>
          Payee
          <input list="payee-list" value={payee} onChange={(e) => onPayeeChange(e.target.value)} placeholder="Who did you pay?" />
          <datalist id="payee-list">
            {data.accounts
              .filter((a) => a.id !== accountId && !a.closed)
              .map((a) => (
                <option key={a.id} value={TRANSFER_PREFIX + a.name} />
              ))}
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          Category
          {needsCategory ? (
            <CategorySelect data={data} value={categoryId} onChange={setCategoryId} includeRta includeNone="Uncategorized" />
          ) : (
            <select disabled>
              <option>{transferTarget ? 'No category needed for transfers' : 'Tracking account — no category'}</option>
            </select>
          )}
        </label>
        {needsCategory && categoryId === READY_TO_ASSIGN && direction === 'out' && (
          <p className="hint">Outflows to Ready to Assign reduce money available to assign.</p>
        )}
        <div className="row">
          <label>
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {openAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {scheduled ? 'Next date' : 'Date'}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {!tx && (
          <div className="row">
            <label>
              Repeat
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as Frequency | 'never')}>
                {!scheduled && <option value="never">Never</option>}
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {repeat !== 'never' && repeat !== 'once' && (
              <label>
                Ends (optional)
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            )}
          </div>
        )}
        {!tx && (repeat !== 'never' || date > today()) && (
          <p className="hint">
            {date > today()
              ? 'This will be entered automatically on its date. Until then it shows under Scheduled.'
              : 'The first one is entered now; the rest are entered automatically when due.'}
          </p>
        )}
        <label>
          Memo
          <input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        {!scheduled && <label className="checkbox">
          <input
            type="checkbox"
            checked={cleared !== 'uncleared'}
            disabled={cleared === 'reconciled'}
            onChange={(e) => setCleared(e.target.checked ? 'cleared' : 'uncleared')}
          />
          <span>{cleared === 'reconciled' ? 'Reconciled' : 'Cleared (shows on your bank statement)'}</span>
        </label>}
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}

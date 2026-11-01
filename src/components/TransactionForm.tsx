import { useMemo, useState } from 'react';
import { today } from '../lib/dates';
import { parseMoney, toInput } from '../lib/money';
import { deleteTransactions, saveTransaction } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { Transaction } from '../lib/types';
import { READY_TO_ASSIGN } from '../lib/types';
import CategorySelect from './CategorySelect';
import Modal from './Modal';

const TRANSFER_PREFIX = 'Transfer : ';

export default function TransactionForm({
  transaction,
  defaultAccountId,
  onClose,
}: {
  transaction?: Transaction;
  defaultAccountId?: string;
  onClose: () => void;
}) {
  const data = useData();
  const update = useStore((s) => s.update);
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
      title={transaction ? 'Edit Transaction' : 'Add Transaction'}
      onClose={onClose}
      footer={
        <>
          {transaction && (
            <button
              className="btn danger-outline"
              onClick={() => {
                update((d) => deleteTransactions(d, [transaction.id]));
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          {!transaction && (
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
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label>
          Memo
          <input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={cleared !== 'uncleared'}
            disabled={cleared === 'reconciled'}
            onChange={(e) => setCleared(e.target.checked ? 'cleared' : 'uncleared')}
          />
          <span>{cleared === 'reconciled' ? 'Reconciled' : 'Cleared (shows on your bank statement)'}</span>
        </label>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}

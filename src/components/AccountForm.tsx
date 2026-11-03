import { useState } from 'react';
import { today } from '../lib/dates';
import { LOAN_KINDS, addLoan, updateLoan } from '../lib/loans';
import { parseMoney, toInput } from '../lib/money';
import { addAccount, deleteAccount, isDebtType, updateAccount } from '../lib/ops';
import { go } from '../lib/route';
import { useData, useStore } from '../lib/store';
import type { Account, AccountType, LoanKind } from '../lib/types';
import Modal from './Modal';

const TYPES: { value: AccountType; label: string; onBudget: boolean }[] = [
  { value: 'checking', label: 'Checking', onBudget: true },
  { value: 'savings', label: 'Savings', onBudget: true },
  { value: 'cash', label: 'Cash', onBudget: true },
  { value: 'credit', label: 'Credit Card', onBudget: true },
  { value: 'loan', label: 'Loan (mortgage, auto, student…)', onBudget: false },
  { value: 'asset', label: 'Asset (investments, home, car)', onBudget: false },
  { value: 'liability', label: 'Other Liability', onBudget: false },
];

export const accountTypeLabel = (t: AccountType) => TYPES.find((x) => x.value === t)?.label ?? t;

export default function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [onBudget, setOnBudget] = useState(account?.onBudget ?? true);
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState(account?.note ?? '');
  const [error, setError] = useState('');
  const [loanKind, setLoanKind] = useState<LoanKind>(account?.loan?.kind ?? 'mortgage');
  const [apr, setApr] = useState(account?.debt ? String(account.debt.apr) : '');
  const [payment, setPayment] = useState(account?.debt?.minPayment ? toInput(account.debt.minPayment) : '');
  const [escrow, setEscrow] = useState(account?.loan?.escrow ? toInput(account.loan.escrow) : '');
  const isLoan = (account?.type ?? type) === 'loan';

  /** Loan fields, or an error message. */
  const readLoan = () => {
    const rate = apr.trim() === '' ? 0 : Number(apr.replace('%', ''));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'Enter the interest rate as a percent, e.g. 6.5.';
    const pay = parseMoney(payment);
    if (pay === null || pay < 0) return 'Enter the required monthly payment.';
    const esc = loanKind === 'mortgage' && escrow.trim() ? parseMoney(escrow) : 0;
    if (esc === null || esc < 0) return 'Enter a valid escrow amount.';
    return { apr: rate, payment: Math.abs(pay), escrow: esc || undefined, kind: loanKind };
  };

  const save = () => {
    if (!name.trim()) return setError('Give the account a name.');
    if (account) {
      const loan = isLoan ? readLoan() : null;
      if (typeof loan === 'string') return setError(loan);
      update((d) => {
        const next = updateAccount(d, account.id, { name: name.trim(), note });
        return loan ? updateLoan(next, account.id, loan) : next;
      });
      return onClose();
    }
    const amount = parseMoney(balance);
    if (amount === null) return setError('Enter a valid balance.');
    // Debts are entered as the amount owed and stored as a negative balance.
    const signed = isDebtType(type) ? -Math.abs(amount) : amount;
    let newId = '';
    const loan = isLoan ? readLoan() : null;
    if (typeof loan === 'string') return setError(loan);
    update((d) => {
      const next = loan
        ? addLoan(d, { name, owed: Math.abs(amount), date, ...loan })
        : addAccount(d, { name, type, onBudget, balance: signed, date });
      newId = next.accounts[next.accounts.length - 1].id;
      return next;
    });
    onClose();
    if (newId) go(`accounts/${newId}`);
  };

  const remove = () => {
    if (!account) return;
    const count = data.transactions.filter((t) => t.accountId === account.id).length;
    if (!confirm(`Delete "${account.name}" and its ${count} transactions? This can't be undone except with Undo.`)) return;
    update((d) => deleteAccount(d, account.id));
    onClose();
    go('budget');
  };

  return (
    <Modal
      title={account ? 'Edit Account' : 'Add Account'}
      onClose={onClose}
      footer={
        <>
          {account && (
            <>
              <button className="btn danger-outline" onClick={remove}>
                Delete
              </button>
              <button
                className="btn"
                onClick={() => {
                  update((d) => updateAccount(d, account.id, { closed: !account.closed }));
                  onClose();
                }}
              >
                {account.closed ? 'Reopen' : 'Close account'}
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Account name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase Checking" />
        </label>
        {!account && (
          <>
            <label>
              Type
              <select
                value={type}
                onChange={(e) => {
                  const t = e.target.value as AccountType;
                  setType(t);
                  setOnBudget(TYPES.find((x) => x.value === t)!.onBudget);
                }}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {!isLoan && (
              <label className="checkbox">
                <input type="checkbox" checked={onBudget} onChange={(e) => setOnBudget(e.target.checked)} />
                <span>
                  <b>Budget account</b> — money here is part of your budget. Uncheck for tracking accounts (investments,
                  loans) that only count toward net worth.
                </span>
              </label>
            )}
            <div className="row">
              <label>
                {isDebtType(type) ? 'Amount owed' : 'Current balance'}
                <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
              </label>
              <label>
                As of
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
          </>
        )}
        {isLoan && (
          <>
            <label>
              Loan type
              <select value={loanKind} onChange={(e) => setLoanKind(e.target.value as LoanKind)}>
                {LOAN_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <label>
                Interest rate (%)
                <input inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="6.5" />
              </label>
              <label>
                Monthly payment
                <input inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="0.00" />
              </label>
            </div>
            {loanKind === 'mortgage' && (
              <label>
                Monthly escrow (optional)
                <input inputMode="decimal" value={escrow} onChange={(e) => setEscrow(e.target.value)} placeholder="Taxes and insurance" />
              </label>
            )}
            <p className="hint">
              {account ? 'The' : 'A'} <b>{name.trim() || 'loan'} Payment</b> category {account ? 'targets' : 'will target'} the
              payment{loanKind === 'mortgage' && escrow.trim() ? ' plus escrow' : ''} each month. To pay the loan, add a
              transfer from checking to this account; interest is added at the end of each month.
              {loanKind === 'mortgage' && escrow.trim() && (
                <> Record the escrow part as a separate payment from checking in the same category, since it doesn't lower the balance.</>
              )}
            </p>
          </>
        )}
        {account && (
          <label>
            Note
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}


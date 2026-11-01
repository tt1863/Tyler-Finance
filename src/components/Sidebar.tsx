import { useMemo, useState } from 'react';
import { accountBalances } from '../lib/budget';
import { fmt } from '../lib/money';
import { useData } from '../lib/store';
import type { Account } from '../lib/types';
import AccountForm from './AccountForm';

export default function Sidebar({
  open,
  current,
  currentArg,
  onClose,
}: {
  open: boolean;
  current: string;
  currentArg?: string;
  onClose: () => void;
}) {
  const data = useData();
  const balances = useMemo(() => accountBalances(data), [data]);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const section = (title: string, accounts: Account[]) => {
    if (!accounts.length) return null;
    const total = accounts.reduce((s, a) => s + balances[a.id].working, 0);
    return (
      <div className="nav-section">
        <div className="nav-section-head">
          <span>{title}</span>
          <span className={total < 0 ? 'neg' : ''}>{fmt(total)}</span>
        </div>
        {accounts.map((a) => (
          <a
            key={a.id}
            href={`#/accounts/${a.id}`}
            className={`nav-account ${current === 'accounts' && currentArg === a.id ? 'active' : ''}`}
          >
            <span className="truncate">{a.name}</span>
            <span className={balances[a.id].working < 0 ? 'neg' : ''}>{fmt(balances[a.id].working)}</span>
          </a>
        ))}
      </div>
    );
  };

  const openAccounts = data.accounts.filter((a) => !a.closed);
  const closed = data.accounts.filter((a) => a.closed);

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <nav className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">Tyler Finance</div>
        <a href="#/budget" className={`nav-link ${current === 'budget' ? 'active' : ''}`}>
          ✉️ Budget
        </a>
        <a href="#/reports" className={`nav-link ${current === 'reports' ? 'active' : ''}`}>
          📊 Reports
        </a>
        <a href="#/accounts" className={`nav-link ${current === 'accounts' && !currentArg ? 'active' : ''}`}>
          🏦 All Accounts
        </a>
        {section('Budget', openAccounts.filter((a) => a.onBudget))}
        {section('Tracking', openAccounts.filter((a) => !a.onBudget))}
        {closed.length > 0 && (
          <button className="link-btn small" onClick={() => setShowClosed((s) => !s)}>
            {showClosed ? 'Hide' : 'Show'} closed accounts ({closed.length})
          </button>
        )}
        {showClosed && section('Closed', closed)}
        <button className="btn sidebar-add" onClick={() => setAdding(true)}>
          + Add Account
        </button>
        <a href="#/settings" className={`nav-link settings-link ${current === 'settings' ? 'active' : ''}`}>
          ⚙️ Settings & Data
        </a>
      </nav>
      {adding && <AccountForm onClose={() => setAdding(false)} />}
    </>
  );
}

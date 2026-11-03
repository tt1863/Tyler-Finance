import { useRef } from 'react';
import { categoryName } from '../components/CategorySelect';
import FlagsPanel from '../components/FlagsPanel';
import SyncPanel from '../components/SyncPanel';
import { signOut, useSync } from '../lib/sync/cloud';
import { today } from '../lib/dates';
import { demoData } from '../lib/demo';
import { setCurrency } from '../lib/money';
import { useData, useStore } from '../lib/store';
import type { BudgetData } from '../lib/types';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'MXN', 'INR', 'CHF', 'SEK'];

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export default function SettingsPage() {
  const data = useData();
  const update = useStore((s) => s.update);
  const replace = useStore((s) => s.replace);
  const undo = useStore((s) => s.undo);
  const canUndo = useStore((s) => s.history.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const syncStatus = useSync((s) => s.status);
  const signedIn = syncStatus !== 'disabled' && syncStatus !== 'signed-out';

  const exportCsv = () => {
    const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
    const lines = [['Account', 'Date', 'Payee', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'].join(',')];
    for (const t of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      // Split transactions are exported as one row per part.
      const parts = t.splits?.length
        ? t.splits.map((p) => ({ categoryId: p.categoryId, amount: p.amount, memo: [t.memo, p.memo].filter(Boolean).join(' / ') }))
        : [{ categoryId: t.categoryId, amount: t.amount, memo: t.memo }];
      for (const p of parts) {
        lines.push(
          [
            accounts.get(t.accountId) ?? '',
            t.date,
            t.payee,
            categoryName(data, p.categoryId),
            p.memo,
            p.amount < 0 ? (-p.amount / 100).toFixed(2) : '',
            p.amount > 0 ? (p.amount / 100).toFixed(2) : '',
            t.cleared,
          ]
            .map((v) => csvCell(String(v)))
            .join(','),
        );
      }
    }
    download(`transactions-${today()}.csv`, lines.join('\n'), 'text/csv');
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as BudgetData;
      if (parsed.version !== 1 || !Array.isArray(parsed.transactions)) throw new Error('bad file');
      if (!confirm('Replace all current data with this backup?')) return;
      replace(parsed);
      alert('Backup restored.');
    } catch {
      alert("That file doesn't look like a Tyler Finance backup.");
    }
  };

  return (
    <div className="settings-page">
      <h1>Settings & Data</h1>

      <SyncPanel />

      <section className="card">
        <h3>Payees</h3>
        <p className="hint">Rename or merge payees, and choose the category filled in for each.</p>
        <a className="btn" href="#/payees">
          Manage payees
        </a>
      </section>

      <FlagsPanel />

      <section className="card">
        <h3>Currency</h3>
        <select
          value={data.currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            update((d) => ({ ...d, currency: e.target.value }));
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </section>

      <section className="card">
        <h3>Your data</h3>
        <p className="hint">
          {signedIn
            ? 'Your budget is saved on this device and synced to your account. A backup file is still a good idea now and then.'
            : 'Everything is stored privately in this browser on this device. Export a backup regularly, or sign in above to sync.'}
        </p>
        <div className="toolbar">
          <button className="btn primary" onClick={() => download(`tyler-finance-backup-${today()}.json`, JSON.stringify(data), 'application/json')}>
            Export backup (JSON)
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Restore backup…
          </button>
          <button className="btn" onClick={exportCsv}>
            Export transactions (CSV)
          </button>
          <button className="btn" disabled={!canUndo} onClick={undo}>
            Undo last change
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </div>
        <p className="muted small">
          {data.accounts.length} accounts · {data.categories.length} categories · {data.transactions.length} transactions
        </p>
      </section>

      <section className="card danger-zone">
        <h3>Start over</h3>
        <div className="toolbar">
          <button
            className="btn"
            onClick={() =>
              confirm(signedIn ? 'Replace your budget with sample data? This also replaces it on your other devices.' : 'Replace your data with sample data?') &&
              replace(demoData())
            }
          >
            Load sample data
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (signedIn) {
                if (confirm('Remove the budget from this device and sign out? Your cloud copy and other devices are not affected.')) void signOut(true);
              } else if (confirm('Delete ALL data in this browser? Export a backup first if you want to keep it.')) replace(null);
            }}
          >
            {signedIn ? 'Remove from this device' : 'Delete everything'}
          </button>
        </div>
      </section>
    </div>
  );
}

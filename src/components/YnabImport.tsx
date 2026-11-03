import { useState } from 'react';
import { dateLabel } from '../lib/dates';
import { go } from '../lib/route';
import { useData, useStore } from '../lib/store';
import type { AccountType } from '../lib/types';
import { unzipText } from '../lib/unzip';
import { buildFromYnab, guessAccounts, parsePlan, parseRegister, pickFiles, type AccountGuess, type YnabPlanRow, type YnabRow } from '../lib/ynabImport';
import Modal from './Modal';

const TYPES: { value: AccountType; label: string; onBudget: boolean }[] = [
  { value: 'checking', label: 'Checking', onBudget: true },
  { value: 'savings', label: 'Savings', onBudget: true },
  { value: 'cash', label: 'Cash', onBudget: true },
  { value: 'credit', label: 'Credit card', onBudget: true },
  { value: 'loan', label: 'Loan (tracking)', onBudget: false },
  { value: 'asset', label: 'Asset (tracking)', onBudget: false },
  { value: 'liability', label: 'Other debt (tracking)', onBudget: false },
];

/** Settings card + flow for importing YNAB's "Export Plan" files. */
export default function YnabImport({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <section className="card">
      <h3>Import from YNAB</h3>
      <p className="hint">
        Bring over your YNAB history: accounts, categories, every transaction and what you assigned each month. In YNAB on a computer, open your
        plan's menu and choose <b>Export Plan</b>, then pick the zip file here (or the two CSV files inside it).
      </p>
      <button className="btn" onClick={() => setOpen(true)}>
        Import YNAB export…
      </button>
      {open && <YnabImportModal onClose={() => setOpen(false)} />}
    </section>
  );
}

function YnabImportModal({ onClose }: { onClose: () => void }) {
  const current = useData();
  const update = useStore((s) => s.update);
  const [parsed, setParsed] = useState<{ rows: YnabRow[]; plan: YnabPlanRow[]; errors: number } | null>(null);
  const [accounts, setAccounts] = useState<AccountGuess[]>([]);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasBudget = current.accounts.length > 0 || current.transactions.length > 0;

  const onFiles = async (list: FileList) => {
    setError('');
    setBusy(true);
    try {
      const files: Record<string, string> = {};
      for (const f of Array.from(list)) {
        if (f.name.toLowerCase().endsWith('.zip')) Object.assign(files, await unzipText(await f.arrayBuffer()));
        else files[f.name] = await f.text();
      }
      const picked = pickFiles(files);
      if (!picked.register) throw new Error("Couldn't find the Register file. Choose YNAB's export zip, or its Register and Plan CSV files.");
      const reg = parseRegister(picked.register);
      const plan = picked.plan ? parsePlan(picked.plan) : [];
      setParsed({ rows: reg.rows, plan, errors: reg.errors });
      setAccounts(guessAccounts(reg.rows, plan));
      if (!picked.plan) setError("No Plan file found: transactions will import, but not what you assigned each month.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = parsed ? buildFromYnab(parsed.rows, parsed.plan, accounts, mode === 'add' ? current : null).summary : null;

  const doImport = () => {
    if (!parsed) return;
    if (mode === 'replace' && hasBudget && !confirm('Replace your current budget with the YNAB import? (Undo can bring it back; signed-in devices get the import too.)')) return;
    update((d) => buildFromYnab(parsed.rows, parsed.plan, accounts, mode === 'add' ? d : null).data);
    onClose();
    go('budget');
  };

  return (
    <Modal
      title="Import from YNAB"
      onClose={onClose}
      footer={
        parsed ? (
          <>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={doImport} disabled={!preview?.transactions}>
              Import {preview?.transactions ?? 0} transactions
            </button>
          </>
        ) : undefined
      }
    >
      <div className="form">
        {!parsed && (
          <>
            <p className="hint">Choose the zip file from YNAB's Export Plan, or the Register and Plan CSV files inside it.</p>
            <input type="file" accept=".zip,.csv,application/zip,text/csv" multiple disabled={busy} onChange={(e) => e.target.files?.length && void onFiles(e.target.files)} />
            {busy && <p className="hint">Reading…</p>}
          </>
        )}
        {error && <p className={parsed ? 'hint' : 'error'}>{error}</p>}
        {parsed && preview && (
          <>
            <div className="import-summary">
              <div>
                <b>{preview.transactions}</b> transactions
              </div>
              <div>
                <b>{preview.categories}</b> categories
              </div>
              <div>
                <b>{preview.months}</b> months assigned
              </div>
              <div className="muted small">
                {preview.from && `${dateLabel(preview.from)} – ${dateLabel(preview.to)}`}
              </div>
            </div>
            {parsed.errors > 0 && <p className="hint">{parsed.errors} rows couldn't be read and will be skipped.</p>}
            {preview.unmatchedTransfers > 0 && (
              <p className="hint">{preview.unmatchedTransfers} transfers had no matching side and will import as normal transactions.</p>
            )}
            <fieldset className="bank-choice">
              <legend>Accounts — check each type</legend>
              {accounts.map((a, i) => (
                <label key={a.name} className="import-account">
                  <span className="truncate">
                    {a.name} <span className="muted small">· {a.transactions}</span>
                  </span>
                  <select
                    value={a.type}
                    onChange={(e) => {
                      const t = TYPES.find((x) => x.value === e.target.value)!;
                      setAccounts(accounts.map((x, j) => (j === i ? { ...x, type: t.value, onBudget: t.onBudget } : x)));
                    }}
                  >
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
            {hasBudget && (
              <div className="segmented">
                <button className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>
                  Replace my budget
                </button>
                <button className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}>
                  Add to it
                </button>
              </div>
            )}
            {hasBudget && (
              <p className="hint">
                {mode === 'replace'
                  ? 'Your current budget is replaced by the import (Undo can bring it back).'
                  : 'Accounts and categories with the same names are reused; everything else is added.'}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  createLinkToken,
  exchangeToken,
  listBanks,
  removeBank,
  saveLinks,
  syncBanks,
  type BankAccount,
  type BankItem,
  type LinkChoice,
  type SyncResult,
} from '../lib/bank/api';
import { clearOAuthParams, openPlaidLink, pendingOAuth } from '../lib/bank/plaidLink';
import { addDays, today } from '../lib/dates';
import { fmt } from '../lib/money';
import { addAccount } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import { useSync } from '../lib/sync/cloud';
import type { AccountType } from '../lib/types';
import Modal from './Modal';

function ago(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString();
}

function summary(results: SyncResult[]) {
  const added = results.reduce((s, r) => s + r.added, 0);
  const updated = results.reduce((s, r) => s + r.updated, 0);
  const failed = results.filter((r) => r.status !== 'ok');
  let msg = added ? `Imported ${added} new transaction${added === 1 ? '' : 's'}.` : 'No new transactions.';
  if (updated) msg += ` Updated ${updated}.`;
  if (failed.length) msg += ` ${failed.length} bank${failed.length === 1 ? '' : 's'} need attention.`;
  return msg;
}

/** Settings card: link banks so transactions import automatically. */
export default function BankPanel() {
  const status = useSync((s) => s.status);
  const signedIn = status !== 'disabled' && status !== 'signed-out';
  const [items, setItems] = useState<BankItem[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<{ itemId: string; name: string } | null>(null);
  const data = useData();

  const refresh = useCallback(async () => {
    try {
      const r = await listBanks();
      setItems(r.items);
      setAccounts(r.accounts);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const finishLink = async (publicToken: string, institutionName: string) => {
    const r = await exchangeToken(publicToken, institutionName);
    setAccounts((prev) => [...prev.filter((a) => a.item_id !== r.itemId), ...r.accounts]);
    setChoosing({ itemId: r.itemId, name: institutionName });
  };

  const link = (itemId?: string) =>
    run(itemId ? 'reconnect' : 'link', async () => {
      const token = await createLinkToken(itemId);
      const result = await openPlaidLink(token);
      if (!result) return;
      if (itemId) setMessage(`Reconnected. ${summary(await syncBanks())}`);
      else await finishLink(result.publicToken, result.institutionName);
    });

  // Coming back from a bank's own sign-in page (OAuth banks).
  useEffect(() => {
    const token = pendingOAuth();
    if (!token || !signedIn) return;
    const uri = window.location.href;
    clearOAuthParams();
    void run('link', async () => {
      const result = await openPlaidLink(token, uri);
      if (result) await finishLink(result.publicToken, result.institutionName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  if (!signedIn) {
    return (
      <section className="card">
        <h3>Linked banks</h3>
        <p className="hint">Sign in under "Sync across devices" first, then link your banks to import transactions automatically.</p>
      </section>
    );
  }

  const appAccountName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name;

  return (
    <section className="card">
      <h3>Linked banks</h3>
      <p className="hint">New transactions from linked banks are added automatically. They're categorized from payees you've used before; the rest show up under "Needs category".</p>

      {items.map((item) => (
        <div key={item.id} className={`bank-item ${item.status}`}>
          <div className="bank-item-head">
            <b>{item.institution_name}</b>
            <span className="muted small">
              {item.status === 'ok' ? `Updated ${ago(item.last_synced_at)}` : item.status === 'login_required' ? '⚠️ Needs you to sign in again' : '⚠️ Problem'}
            </span>
          </div>
          {item.status !== 'ok' && item.error && <p className="error small">{item.error}</p>}
          <ul className="bank-accounts">
            {accounts
              .filter((a) => a.item_id === item.id)
              .map((a) => (
                <li key={a.id}>
                  <span className="truncate">
                    {a.name}
                    {a.mask && <span className="muted"> ••{a.mask}</span>}
                  </span>
                  <span className="muted small truncate">{a.app_account_id ? `→ ${appAccountName(a.app_account_id) ?? 'deleted account'}` : 'not imported'}</span>
                </li>
              ))}
          </ul>
          <div className="toolbar">
            {item.status === 'login_required' && (
              <button className="btn primary small" disabled={!!busy} onClick={() => void link(item.id)}>
                Reconnect
              </button>
            )}
            <button className="btn small" disabled={!!busy} onClick={() => setChoosing({ itemId: item.id, name: item.institution_name ?? 'Bank' })}>
              Choose accounts
            </button>
            <button
              className="btn small danger-outline"
              disabled={!!busy}
              onClick={() =>
                confirm(`Unlink ${item.institution_name}? Transactions already imported stay in your budget.`) &&
                void run('remove', () => removeBank(item.id))
              }
            >
              Unlink
            </button>
          </div>
        </div>
      ))}

      {message && <p className="good small">{message}</p>}
      {error && <p className="error small">{error}</p>}
      <div className="toolbar">
        <button className="btn primary" disabled={!!busy} onClick={() => void link()}>
          {busy === 'link' ? 'Opening…' : '+ Link a bank'}
        </button>
        {items.length > 0 && (
          <button className="btn" disabled={!!busy} onClick={() => void run('sync', async () => setMessage(summary(await syncBanks())))}>
            {busy === 'sync' ? 'Checking…' : 'Check for new transactions'}
          </button>
        )}
      </div>

      {choosing && (
        <ChooseAccountsModal
          itemId={choosing.itemId}
          bankName={choosing.name}
          accounts={accounts.filter((a) => a.item_id === choosing.itemId)}
          onClose={() => setChoosing(null)}
          onSaved={(results) => {
            setChoosing(null);
            setMessage(summary(results));
            void refresh();
          }}
        />
      )}
    </section>
  );
}

/** App account type and budget/tracking default for a bank account. */
function appType(a: BankAccount): { type: AccountType; onBudget: boolean } {
  if (a.type === 'credit') return { type: 'credit', onBudget: true };
  if (a.type === 'loan') return { type: 'loan', onBudget: false };
  if (a.type === 'investment') return { type: 'asset', onBudget: false };
  if (a.type === 'depository') return { type: a.subtype === 'savings' ? 'savings' : 'checking', onBudget: true };
  return { type: 'asset', onBudget: false };
}

function ChooseAccountsModal({
  itemId,
  bankName,
  accounts,
  onClose,
  onSaved,
}: {
  itemId: string;
  bankName: string;
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: (results: SyncResult[]) => void;
}) {
  const data = useData();
  const update = useStore((s) => s.update);
  const open = data.accounts.filter((a) => !a.closed);
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(
      accounts.map((a) => [
        a.id,
        {
          target: a.app_account_id ?? 'new',
          importFrom: a.import_from ?? addDays(today(), -30),
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (id: string, patch: Partial<{ target: string; importFrom: string }>) =>
    setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const links: LinkChoice[] = [];
      for (const a of accounts) {
        const c = choices[a.id];
        if (c.target === 'skip') {
          links.push({ accountId: a.id, appAccountId: null, importFrom: null, setStartingBalance: false });
          continue;
        }
        let appAccountId = c.target;
        let setStartingBalance = false;
        if (c.target === 'new') {
          // Create the app account; its starting balance is set from the bank after importing.
          const { type, onBudget } = appType(a);
          update((d) => {
            const next = addAccount(d, {
              name: `${a.name ?? bankName}${a.mask ? ` ••${a.mask}` : ''}`,
              type,
              onBudget,
              balance: 0,
              date: addDays(c.importFrom, -1),
            });
            appAccountId = next.accounts[next.accounts.length - 1].id;
            return next;
          });
          setStartingBalance = true;
        }
        links.push({ accountId: a.id, appAccountId, importFrom: c.importFrom, setStartingBalance });
      }
      onSaved(await saveLinks(itemId, links));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${bankName}: choose accounts`}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Importing…' : 'Save & import'}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="hint">For each bank account, pick where its transactions go. Transactions you already entered by hand are matched, not duplicated.</p>
        {accounts.map((a) => {
          const c = choices[a.id];
          return (
            <fieldset key={a.id} className="bank-choice">
              <legend>
                {a.name}
                {a.mask && <span className="muted"> ••{a.mask}</span>}
                {a.balance_cents !== null && <span className="muted"> · {fmt(a.balance_cents)}</span>}
              </legend>
              <label>
                Put transactions in
                <select value={c.target} onChange={(e) => set(a.id, { target: e.target.value })}>
                  <option value="new">A new account</option>
                  {open.map((acct) => (
                    <option key={acct.id} value={acct.id}>
                      {acct.name}
                    </option>
                  ))}
                  <option value="skip">Don't import this account</option>
                </select>
              </label>
              {c.target !== 'skip' && (
                <label>
                  Import transactions from
                  <input type="date" value={c.importFrom} max={today()} onChange={(e) => set(a.id, { importFrom: e.target.value })} />
                </label>
              )}
            </fieldset>
          );
        })}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

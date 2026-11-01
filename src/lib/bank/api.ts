import { STORAGE_KEY } from '../preview';
import { getSupabase, syncNow, useSync, waitForSync } from '../sync/cloud';

export interface BankItem {
  id: string;
  institution_name: string | null;
  status: 'ok' | 'login_required' | 'error';
  error: string | null;
  last_synced_at: string | null;
}

export interface BankAccount {
  id: string;
  item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  balance_cents: number | null;
  app_account_id: string | null;
  import_from: string | null;
}

export interface SyncResult {
  itemId: string;
  added: number;
  updated: number;
  removed: number;
  status: string;
  error?: string;
}

const HAS_BANKS_KEY = `${STORAGE_KEY}-has-banks`;
const LAST_SYNC_KEY = `${STORAGE_KEY}-bank-sync`;
const AUTO_SYNC_MS = 30 * 60 * 1000;

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke('bank', { body: { action, ...payload } });
  if (error) {
    let message = error.message;
    try {
      message = (await (error as { context?: Response }).context?.json())?.error ?? message;
    } catch {
      // Keep the generic message.
    }
    throw new Error(message);
  }
  return data as T;
}

export async function listBanks(): Promise<{ items: BankItem[]; accounts: BankAccount[] }> {
  const sb = await getSupabase();
  const [items, accounts] = await Promise.all([
    sb.from('bank_items').select('id,institution_name,status,error,last_synced_at').order('created_at'),
    sb.from('bank_accounts').select('id,item_id,name,mask,type,subtype,balance_cents,app_account_id,import_from').order('name'),
  ]);
  if (items.error) throw items.error;
  if (accounts.error) throw accounts.error;
  if (items.data.length) localStorage.setItem(HAS_BANKS_KEY, '1');
  else localStorage.removeItem(HAS_BANKS_KEY);
  return { items: items.data as BankItem[], accounts: accounts.data as BankAccount[] };
}

export const createLinkToken = (itemId?: string) => call<{ linkToken: string }>('link_token', { itemId }).then((r) => r.linkToken);

export async function exchangeToken(publicToken: string, institutionName: string) {
  const r = await call<{ itemId: string; accounts: BankAccount[] }>('exchange', { publicToken, institutionName });
  localStorage.setItem(HAS_BANKS_KEY, '1');
  return r;
}

export interface LinkChoice {
  accountId: string;
  appAccountId: string | null;
  importFrom: string | null;
  setStartingBalance: boolean;
}

/** Save which app account each bank account fills, then import. */
export async function saveLinks(itemId: string, links: LinkChoice[]) {
  // Make sure any new app accounts reached the cloud first.
  await waitForSync();
  const r = await call<{ results: SyncResult[] }>('map', { itemId, links });
  await afterImport();
  return r.results;
}

export async function syncBanks(force = true) {
  const r = await call<{ results: SyncResult[] }>('sync', { force });
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  await afterImport();
  return r.results;
}

export async function removeBank(itemId: string) {
  await call('remove', { itemId });
}

/** Pull the imported transactions down to this device. */
async function afterImport() {
  await syncNow();
}

/** Quietly check linked banks for new transactions now and then. */
export function maybeAutoSync() {
  const status = useSync.getState().status;
  if (!localStorage.getItem(HAS_BANKS_KEY) || (status !== 'synced' && status !== 'syncing')) return;
  const last = Number(localStorage.getItem(LAST_SYNC_KEY) ?? 0);
  if (Date.now() - last < AUTO_SYNC_MS) return;
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  syncBanks(false).catch(() => {
    // Shown next time the Linked banks screen is opened.
  });
}

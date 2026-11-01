import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { setCurrency } from '../money';
import { PREVIEW } from '../preview';
import { useStore } from '../store';
import type { BudgetData } from '../types';
import { adoptRemote, freshState, replaceRemote, syncOnce, type SyncState } from './engine';
import { SupabaseRemote } from './supabaseRemote';

const URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
// Previews never sync, so testing a pull request can't change the real budget.
export const syncConfigured = Boolean(URL && KEY) && !PREVIEW;

const STATE_KEY = 'tyler-finance-sync';
const PUSH_DELAY_MS = 1200;

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error' | 'choose';

interface SyncUi {
  status: SyncStatus;
  email?: string;
  lastSynced?: number;
  error?: string;
}

export const useSync = create<SyncUi>(() => ({ status: syncConfigured ? 'signed-out' : 'disabled' }));

let client: SupabaseClient | null = null;
/** The Supabase library is loaded only when sync is used, to keep the app fast to open. */
async function supabase(): Promise<SupabaseClient> {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client ??= createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tyler-finance-auth' },
    });
  }
  return client;
}

// --- State kept between syncs -------------------------------------------------

function loadState(): SyncState | null {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function saveState(s: SyncState | null) {
  if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STATE_KEY);
}

let session: Session | null = null;
let remote: SupabaseRemote | null = null;
let running = false;
let again = false;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribers: (() => void)[] = [];

function applyRemote(data: BudgetData) {
  applyingRemote = true;
  setCurrency(data.currency);
  useStore.setState({ data });
  applyingRemote = false;
}

const setUi = (patch: Partial<SyncUi>) => useSync.setState(patch);

function failed(e: unknown) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  setUi({ status: offline ? 'offline' : 'error', error: offline ? undefined : String((e as Error)?.message ?? e) });
}

/** Push local changes and pull remote ones. Safe to call any time. */
export async function syncNow(): Promise<void> {
  const state = loadState();
  if (!remote || !state || useSync.getState().status === 'choose') return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setUi({ status: 'syncing' });
  try {
    const r = await syncOnce(remote, state, () => useStore.getState().data);
    saveState(r.state);
    if (r.data) applyRemote(r.data);
    setUi({ status: 'synced', lastSynced: Date.now(), error: undefined });
  } catch (e) {
    failed(e);
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

function hasBudget(d: BudgetData | null) {
  return !!d && (d.accounts.length > 0 || d.transactions.length > 0);
}

async function onSignedIn(s: Session) {
  if (session?.user.id === s.user.id && remote) return;
  session = s;
  remote = new SupabaseRemote(client!, s.user.id);
  setUi({ email: s.user.email ?? undefined, status: 'syncing' });

  let state = loadState();
  if (state && state.userId !== s.user.id) state = null;
  try {
    if (!state) {
      // First sync on this device for this account.
      const cloudHas = await remote.hasAny();
      const local = useStore.getState().data;
      if (cloudHas && hasBudget(local)) {
        setUi({ status: 'choose' });
      } else if (cloudHas) {
        await chooseBudget('cloud');
      } else {
        saveState(freshState(s.user.id));
        await syncNow();
      }
    } else {
      await syncNow();
    }
  } catch (e) {
    failed(e);
  }
  listen(s.user.id);
}

/** When both this device and the cloud have a budget, the person picks which to keep. */
export async function chooseBudget(which: 'cloud' | 'device') {
  if (!remote || !session) return;
  setUi({ status: 'syncing' });
  try {
    const r =
      which === 'cloud'
        ? await adoptRemote(remote, session.user.id)
        : await replaceRemote(remote, session.user.id, useStore.getState().data!);
    saveState(r.state);
    if (r.data) applyRemote(r.data);
    setUi({ status: 'synced', lastSynced: Date.now() });
  } catch (e) {
    failed(e);
  }
}

function listen(userId: string) {
  stopListening();
  // Sync shortly after each local change.
  unsubscribers.push(
    useStore.subscribe((s, prev) => {
      if (s.data === prev.data || applyingRemote) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => void syncNow(), PUSH_DELAY_MS);
    }),
  );
  // Pull right away when another device changes something.
  const channel = client!
    .channel(`budget-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_records', filter: `user_id=eq.${userId}` }, () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => void syncNow(), 400);
    })
    .subscribe();
  unsubscribers.push(() => void client?.removeChannel(channel));
  // Catch up when the app comes back to the foreground or back online.
  const onWake = () => document.visibilityState === 'visible' && void syncNow();
  const onOnline = () => void syncNow();
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onOnline);
  const timer = setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60000);
  unsubscribers.push(() => {
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
  });
}

function stopListening() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  clearTimeout(pushTimer);
}

/** Call once at startup. */
export async function startSync() {
  if (!syncConfigured) return;
  // Only load the library at startup if this device has signed in before.
  if (!localStorage.getItem('tyler-finance-auth')) return;
  await watchAuth();
}

let watching = false;
async function watchAuth() {
  if (watching) return;
  watching = true;
  const sb = await supabase();
  sb.auth.onAuthStateChange((event, s) => {
    if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) void onSignedIn(s);
    if (event === 'SIGNED_OUT') {
      session = null;
      remote = null;
      stopListening();
      setUi({ status: 'signed-out', email: undefined });
    }
  });
}

/** Email a 6-digit sign-in code. */
export async function sendCode(email: string) {
  await watchAuth();
  const { error } = await (await supabase()).auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string) {
  await watchAuth();
  const { error } = await (await supabase()).auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) throw error;
}

/** Sign out. Optionally also remove the budget from this device (the cloud copy stays). */
export async function signOut(removeLocal: boolean) {
  await syncNow();
  stopListening();
  saveState(null);
  await (await supabase()).auth.signOut();
  if (removeLocal) useStore.getState().replace(null);
}

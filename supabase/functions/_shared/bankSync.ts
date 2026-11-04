// Pulls new bank transactions for a linked bank and writes them into the
// user's synced budget (the same budget_records table the app syncs with).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { appBalance, planImport, startingBalanceFix, type AccountLink, type AppTxn, type PlaidTxn } from './importPlan.ts';
import { plaid, PlaidError, type PlaidAccount } from './plaid.ts';

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

async function accessToken(db: SupabaseClient, itemId: string): Promise<string> {
  const { data, error } = await db.from('bank_item_secrets').select('access_token').eq('item_id', itemId).single();
  if (error || !data) throw new Error('Bank connection not found');
  return data.access_token;
}

/** Fetch every record of one kind for a user (paged). */
async function records(db: SupabaseClient, userId: string, kind: string) {
  const out: { id: string; data: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('budget_records')
      .select('id,data')
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('deleted', false)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Save accounts and balances reported by the bank. */
export async function refreshAccounts(db: SupabaseClient, userId: string, itemId: string, token: string) {
  const { accounts } = await plaid<{ accounts: PlaidAccount[] }>('/accounts/get', { access_token: token });
  const rows = accounts.map((a) => ({
    id: a.account_id,
    item_id: itemId,
    user_id: userId,
    name: a.official_name || a.name,
    mask: a.mask ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    balance_cents: appBalance(a.balances.current, a.type),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from('bank_accounts').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows;
}

export interface SyncResult {
  itemId: string;
  added: number;
  updated: number;
  removed: number;
  status: string;
  error?: string;
}

export async function syncItem(db: SupabaseClient, itemId: string): Promise<SyncResult> {
  const { data: item, error } = await db.from('bank_items').select('*').eq('id', itemId).single();
  if (error || !item) throw new Error('Bank connection not found');
  const userId: string = item.user_id;

  try {
    const token = await accessToken(db, itemId);
    await refreshAccounts(db, userId, itemId, token);

    // Page through everything new since the last sync.
    let cursor: string | null = item.cursor;
    let added: PlaidTxn[] = [];
    let modified: PlaidTxn[] = [];
    let removed: { transaction_id: string }[] = [];
    for (let attempt = 0; ; ) {
      try {
        let next = cursor;
        const a: PlaidTxn[] = [];
        const m: PlaidTxn[] = [];
        const r: { transaction_id: string }[] = [];
        for (;;) {
          const page = await plaid<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>(
            '/transactions/sync',
            { access_token: token, count: 500, ...(next ? { cursor: next } : {}) },
          );
          a.push(...page.added);
          m.push(...page.modified);
          r.push(...page.removed);
          next = page.next_cursor;
          if (!page.has_more) break;
        }
        added = a;
        modified = m;
        removed = r;
        cursor = next;
        break;
      } catch (e) {
        // The bank changed data mid-way: start this batch over.
        if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt++ < 3) continue;
        throw e;
      }
    }

    const { data: accounts } = await db.from('bank_accounts').select('*').eq('item_id', itemId);
    const links: Record<string, AccountLink> = {};
    for (const a of accounts ?? []) {
      if (a.app_account_id) links[a.id] = { appAccountId: a.app_account_id, importFrom: a.import_from ?? '1970-01-01' };
    }

    const existing = (await records(db, userId, 'transaction')).map((r) => r.data as AppTxn);
    const payeeCategory: Record<string, string> = {};
    for (const r of await records(db, userId, 'payee')) payeeCategory[r.id] = r.data as string;

    // Imported transactions the user deleted stay deleted.
    const deletedBankIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: gone, error: goneErr } = await db
        .from('budget_records')
        .select('id')
        .eq('user_id', userId)
        .eq('kind', 'transaction')
        .eq('deleted', true)
        .like('id', 'bank-%')
        .order('id')
        .range(from, from + 999);
      if (goneErr) throw goneErr;
      for (const r of gone ?? []) deletedBankIds.add(r.id.slice('bank-'.length));
      if (!gone || gone.length < 1000) break;
    }

    const plan = planImport({ added, modified, removed, links, existing, payeeCategory, deletedBankIds });

    // New accounts: make the starting balance match the bank.
    const merged = new Map(existing.map((t) => [t.id, t]));
    for (const t of plan.upserts) merged.set(t.id, t);
    for (const id of plan.deletes) merged.delete(id);
    const fixes: AppTxn[] = [];
    for (const a of accounts ?? []) {
      if (!a.app_account_id || !a.set_starting_balance) continue;
      const fix = startingBalanceFix([...merged.values()], a.app_account_id, Number(a.balance_cents ?? 0));
      if (fix) fixes.push(fix);
    }

    const rows = [
      ...[...plan.upserts, ...fixes].map((t) => ({ user_id: userId, kind: 'transaction', id: t.id, data: t, deleted: false })),
      ...plan.deletes.map((id) => ({ user_id: userId, kind: 'transaction', id, data: null, deleted: true })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await db.from('budget_records').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,kind,id' });
      if (upErr) throw upErr;
    }

    await db.from('bank_accounts').update({ set_starting_balance: false }).eq('item_id', itemId).eq('set_starting_balance', true);
    await db.from('bank_items').update({ cursor, status: 'ok', error: null, last_synced_at: new Date().toISOString() }).eq('id', itemId);

    const before = new Set(existing.map((t) => t.id));
    return {
      itemId,
      added: plan.upserts.filter((t) => !before.has(t.id)).length,
      updated: plan.upserts.filter((t) => before.has(t.id)).length + fixes.length,
      removed: plan.deletes.length,
      status: 'ok',
    };
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : '';
    const status = code === 'ITEM_LOGIN_REQUIRED' || code === 'PENDING_EXPIRATION' ? 'login_required' : 'error';
    await db.from('bank_items').update({ status, error: String((e as Error).message ?? e) }).eq('id', itemId);
    return { itemId, added: 0, updated: 0, removed: 0, status, error: String((e as Error).message ?? e) };
  }
}

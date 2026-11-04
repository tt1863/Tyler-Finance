// Server function the app calls for linked banks. Requires a signed-in user.
//
// POST { action: 'link_token', itemId? }       -> { linkToken }   (itemId = reconnect)
// POST { action: 'exchange', publicToken, institutionName } -> { itemId, accounts }
// POST { action: 'map', itemId, links: [{ accountId, appAccountId|null, importFrom, setStartingBalance }] } -> sync result
// POST { action: 'sync', itemId? }             -> { results }
// POST { action: 'remove', itemId }            -> { ok }

import { adminClient, refreshAccounts, syncItem } from '../_shared/bankSync.ts';
import { cors, json } from '../_shared/cors.ts';
import { plaid } from '../_shared/plaid.ts';

const SYNC_COOLDOWN_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = adminClient();
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) return json({ error: 'Please sign in first.' }, 401);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  /** Load one of this user's bank logins (never someone else's). */
  const ownItem = async (itemId: string) => {
    const { data } = await db.from('bank_items').select('*').eq('id', itemId).eq('user_id', user.id).single();
    if (!data) throw new Error('Bank connection not found');
    return data;
  };
  const tokenFor = async (itemId: string) => {
    await ownItem(itemId);
    const { data } = await db.from('bank_item_secrets').select('access_token').eq('item_id', itemId).single();
    return data!.access_token as string;
  };

  try {
    switch (body.action) {
      case 'link_token': {
        const webhook = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bank-webhook`;
        const redirect = Deno.env.get('PLAID_REDIRECT_URI');
        const base = {
          user: { client_user_id: user.id },
          client_name: 'Tyler Finance',
          country_codes: ['US'],
          language: 'en',
          webhook,
          ...(redirect ? { redirect_uri: redirect } : {}),
        };
        const res = body.itemId
          ? await plaid<{ link_token: string }>('/link/token/create', { ...base, access_token: await tokenFor(body.itemId) })
          : await plaid<{ link_token: string }>('/link/token/create', {
              ...base,
              products: ['transactions'],
              transactions: { days_requested: 730 },
            });
        return json({ linkToken: res.link_token });
      }

      case 'exchange': {
        const ex = await plaid<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: body.publicToken });
        const { error: e1 } = await db.from('bank_items').upsert({
          id: ex.item_id,
          user_id: user.id,
          institution_name: String(body.institutionName ?? 'Bank'),
          status: 'ok',
          error: null,
        });
        if (e1) throw e1;
        const { error: e2 } = await db.from('bank_item_secrets').upsert({ item_id: ex.item_id, access_token: ex.access_token });
        if (e2) throw e2;
        const accounts = await refreshAccounts(db, user.id, ex.item_id, ex.access_token);
        return json({ itemId: ex.item_id, accounts });
      }

      case 'map': {
        await ownItem(body.itemId);
        for (const l of body.links ?? []) {
          const { error } = await db
            .from('bank_accounts')
            .update({
              app_account_id: l.appAccountId ?? null,
              import_from: l.importFrom ?? null,
              set_starting_balance: Boolean(l.setStartingBalance),
            })
            .eq('id', l.accountId)
            .eq('user_id', user.id);
          if (error) throw error;
        }
        // Start over from the beginning so newly linked accounts get their
        // history; transactions already imported are recognized, not duplicated.
        await db.from('bank_items').update({ cursor: null }).eq('id', body.itemId);
        return json({ results: [await syncItem(db, body.itemId)] });
      }

      case 'sync': {
        let q = db.from('bank_items').select('id,last_synced_at').eq('user_id', user.id);
        if (body.itemId) q = q.eq('id', body.itemId);
        const { data: items } = await q;
        const results = [];
        for (const it of items ?? []) {
          // Don't hammer the bank when several devices open at once.
          if (!body.force && it.last_synced_at && Date.now() - Date.parse(it.last_synced_at) < SYNC_COOLDOWN_MS) continue;
          results.push(await syncItem(db, it.id));
        }
        return json({ results });
      }

      case 'remove': {
        const token = await tokenFor(body.itemId);
        try {
          await plaid('/item/remove', { access_token: token });
        } catch {
          // Already gone at Plaid; still remove it here.
        }
        await db.from('bank_items').delete().eq('id', body.itemId).eq('user_id', user.id);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

// Plaid calls this when a linked bank has new transactions or needs attention.
// It only ever triggers a sync or updates a status flag, and returns no data,
// so a forged call can't read or change anything meaningful.

import { adminClient, syncItem } from '../_shared/bankSync.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const itemId = String(body.item_id ?? '');
  const db = adminClient();
  const { data: item } = await db.from('bank_items').select('id').eq('id', itemId).maybeSingle();
  if (!item) return new Response('ok');

  const type = `${body.webhook_type}:${body.webhook_code}`;
  if (type === 'TRANSACTIONS:SYNC_UPDATES_AVAILABLE' || type === 'TRANSACTIONS:DEFAULT_UPDATE' || type === 'TRANSACTIONS:INITIAL_UPDATE') {
    await syncItem(db, itemId);
  } else if (type === 'ITEM:ERROR' || type === 'ITEM:PENDING_EXPIRATION' || type === 'ITEM:PENDING_DISCONNECT') {
    await db.from('bank_items').update({ status: 'login_required', error: body.error?.error_message ?? 'Please reconnect this bank.' }).eq('id', itemId);
  } else if (type === 'ITEM:LOGIN_REPAIRED') {
    await db.from('bank_items').update({ status: 'ok', error: null }).eq('id', itemId);
  }
  return new Response('ok');
});

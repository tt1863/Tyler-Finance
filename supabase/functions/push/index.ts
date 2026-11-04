// Push notifications.
//
// POST { action: 'key' }   -> { publicKey }   (anyone; needed to subscribe)
// POST { action: 'test' }  -> { sent }        (signed-in user: a test to each of their devices)
// POST { action: 'run' }   -> { checked, sent } (called hourly by pg_cron: daily digests that are due)
//
// 'run' only sends what's due and remembers what it sent, so calling it more
// often than hourly doesn't send anything twice.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { cors, json } from '../_shared/cors.ts';
import { DEFAULT_PREFS, dailyDigest, type DigestMemory, type Message, type PushPrefs, type PushSummary } from '../_shared/digest.ts';

const db: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

interface SubRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  prefs: Partial<PushPrefs>;
  time_zone: string;
  hour: number;
  memory: DigestMemory;
}

/** The server's VAPID keys; made and saved the first time they're needed. */
async function keys(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await db.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (data) return { publicKey: data.public_key, privateKey: data.private_key };
  const made = webpush.generateVAPIDKeys();
  // If two requests race, the first insert wins and both read it back.
  await db.from('push_config').insert({ id: 1, public_key: made.publicKey, private_key: made.privateKey });
  const { data: saved } = await db.from('push_config').select('public_key, private_key').eq('id', 1).single();
  return { publicKey: saved!.public_key, privateKey: saved!.private_key };
}

async function send(sub: SubRow, msg: Message): Promise<boolean> {
  const k = await keys();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(msg),
      { vapidDetails: { subject: 'https://tt1863.github.io/Tyler-Finance/', publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 60 * 60 * 12 },
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // The device turned notifications off or the subscription expired.
    if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    else console.error('push failed', status, (e as Error).message);
    return false;
  }
}

async function runDigests(): Promise<{ checked: number; sent: number }> {
  const { data: subs, error } = await db.from('push_subscriptions').select('*');
  if (error) throw error;
  const summaries = new Map<string, PushSummary>();
  const now = new Date();
  let sent = 0;
  for (const sub of (subs ?? []) as SubRow[]) {
    if (!summaries.has(sub.user_id)) {
      const { data } = await db.from('push_summaries').select('summary').eq('user_id', sub.user_id).maybeSingle();
      if (data) summaries.set(sub.user_id, data.summary as PushSummary);
    }
    const result = dailyDigest(summaries.get(sub.user_id) ?? null, { ...DEFAULT_PREFS, ...sub.prefs }, sub.hour, sub.time_zone, sub.memory ?? {}, now);
    if (!result) continue;
    if (result.message && (await send(sub, result.message))) sent++;
    await db.from('push_subscriptions').update({ memory: result.memory }).eq('endpoint', sub.endpoint);
  }
  return { checked: subs?.length ?? 0, sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  try {
    switch (body.action) {
      case 'key':
        return json({ publicKey: (await keys()).publicKey });

      case 'run':
        return json(await runDigests());

      case 'test': {
        const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const { data: auth } = await db.auth.getUser(jwt);
        if (!auth?.user) return json({ error: 'Please sign in first.' }, 401);
        const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', auth.user.id);
        let sent = 0;
        for (const sub of (subs ?? []) as SubRow[]) {
          if (await send(sub, { title: 'Tyler Finance', body: 'Notifications are working on this device. 🎉', url: '#/settings', tag: 'test' })) sent++;
        }
        return json({ sent });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

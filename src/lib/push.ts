import { DEFAULT_PREFS, type PushPrefs } from '../../supabase/functions/_shared/digest';
import { today } from './dates';
import { buildSummary } from './pushSummary';
import { useStore } from './store';
import { signedInClient, useSync } from './sync/cloud';

/**
 * Push notifications. This device subscribes with the browser's push service
 * and saves the subscription (plus alert choices) in Supabase. Any signed-in
 * device of someone with notifications on uploads a small summary of the
 * budget when it changes; the server's hourly check reads it (see
 * supabase/functions/push).
 */

export type { PushPrefs };
export { DEFAULT_PREFS };

export interface DeviceSettings {
  prefs: PushPrefs;
  hour: number;
}

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone/iPad only allow notifications for apps added to the home screen. */
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);

const fromB64 = (s: string) => {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function client() {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in (Settings → Sync) to use notifications.');
  return c;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** This device's saved settings, or null when notifications are off here. */
export async function loadDevice(): Promise<DeviceSettings | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const { sb } = await client();
  const { data } = await sb.from('push_subscriptions').select('prefs, hour').eq('endpoint', sub.endpoint).maybeSingle();
  return data ? { prefs: { ...DEFAULT_PREFS, ...(data.prefs as Partial<PushPrefs>) }, hour: data.hour as number } : null;
}

export async function enablePush(settings: DeviceSettings): Promise<void> {
  const { sb } = await client();
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Notifications are blocked for this app. Allow them in your device settings, then try again.');
  }
  const { data, error } = await sb.functions.invoke('push', { body: { action: 'key' } });
  if (error || !data?.publicKey) throw new Error("Couldn't reach the notification server. Has it been set up?");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64(data.publicKey as string) }));
  const keys = sub.toJSON().keys ?? {};
  const { error: e2 } = await sb.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    prefs: settings.prefs,
    hour: settings.hour,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  if (e2) throw e2;
  hasDevices = true;
  await uploadSummary();
}

export async function updateDevice(settings: DeviceSettings): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { sb } = await client();
  await sb
    .from('push_subscriptions')
    .update({ prefs: settings.prefs, hour: settings.hour, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
    .eq('endpoint', sub.endpoint);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { sb } = await client();
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTest(): Promise<number> {
  const { sb } = await client();
  const { data, error } = await sb.functions.invoke('push', { body: { action: 'test' } });
  if (error) throw error;
  return (data?.sent as number) ?? 0;
}

// --- Keeping the server's summary up to date ---

let hasDevices = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent = '';

async function uploadSummary() {
  const data = useStore.getState().data;
  const c = await signedInClient();
  if (!data || !c || !hasDevices) return;
  const summary = buildSummary(data, today());
  const text = JSON.stringify(summary);
  if (text === lastSent) return;
  const { error } = await c.sb.from('push_summaries').upsert({ user_id: c.userId, summary, updated_at: new Date().toISOString() });
  if (!error) lastSent = text;
}

let started = false;

/**
 * Once signed in: if this account has notifications on any device, upload
 * the summary now and a few seconds after each change.
 */
export function watchSummary() {
  if (started) return;
  started = true;
  const check = async () => {
    const c = await signedInClient();
    if (!c) return;
    const { count } = await c.sb.from('push_subscriptions').select('endpoint', { count: 'exact', head: true });
    hasDevices = (count ?? 0) > 0;
    void uploadSummary();
  };
  useSync.subscribe((s, prev) => {
    if (s.email && s.email !== prev.email) void check();
    // After each sync, so changes made on other devices are included.
    if (s.status === 'synced' && prev.status !== 'synced') void uploadSummary();
  });
  useStore.subscribe((s, prev) => {
    if (s.data === prev.data || !hasDevices) return;
    clearTimeout(timer);
    timer = setTimeout(() => void uploadSummary(), 5000);
  });
  void check();
}

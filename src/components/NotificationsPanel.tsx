import { useEffect, useState } from 'react';
import {
  DEFAULT_PREFS,
  disablePush,
  enablePush,
  loadDevice,
  needsHomeScreen,
  pushSupported,
  sendTest,
  updateDevice,
  type DeviceSettings,
  type PushPrefs,
} from '../lib/push';
import { syncConfigured, useSync } from '../lib/sync/cloud';

const ALERTS: { key: keyof PushPrefs; label: string }[] = [
  { key: 'bills', label: 'Bills and paychecks due tomorrow' },
  { key: 'overspent', label: 'A category is overspent' },
  { key: 'review', label: 'Transactions need a category' },
  { key: 'weekly', label: 'Weekly summary (Sundays)' },
];

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/** Settings card: push notifications on this device. */
export default function NotificationsPanel() {
  const email = useSync((s) => s.email);
  const [device, setDevice] = useState<DeviceSettings | null | undefined>(undefined);
  const [draft, setDraft] = useState<DeviceSettings>({ prefs: DEFAULT_PREFS, hour: 8 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!email || !pushSupported()) return;
    loadDevice()
      .then((d) => {
        setDevice(d);
        if (d) setDraft(d);
      })
      .catch(() => setDevice(null));
  }, [email]);

  if (!syncConfigured) return null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    }
    setBusy(false);
  };

  const change = (next: DeviceSettings) => {
    setDraft(next);
    if (device) void act(() => updateDevice(next).then(() => setDevice(next)));
  };

  let body;
  if (!email) body = <p className="hint">Sign in under Sync to get notifications.</p>;
  else if (!pushSupported())
    body = <p className="hint">This browser can't show notifications from web apps.</p>;
  else if (needsHomeScreen())
    body = (
      <p className="hint">
        On iPhone and iPad, notifications only work after adding the app to your home screen: in Safari tap Share → Add to
        Home Screen, then open it from there and come back here.
      </p>
    );
  else
    body = (
      <>
        <div className="form">
          {ALERTS.map((a) => (
            <label key={a.key} className="checkbox">
              <input type="checkbox" checked={draft.prefs[a.key]} onChange={(e) => change({ ...draft, prefs: { ...draft.prefs, [a.key]: e.target.checked } })} />
              <span>{a.label}</span>
            </label>
          ))}
          <label>
            Send at
            <select value={draft.hour} onChange={(e) => change({ ...draft, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="export-row">
          {device ? (
            <>
              <button className="btn" disabled={busy} onClick={() => void act(async () => setMsg((await sendTest()) ? 'Test sent. It should arrive in a few seconds.' : 'No device got it; try turning notifications off and on.'))}>
                Send a test
              </button>
              <button className="btn danger-outline" disabled={busy} onClick={() => void act(() => disablePush().then(() => setDevice(null)))}>
                Turn off on this device
              </button>
            </>
          ) : (
            <button className="btn primary" disabled={busy || device === undefined} onClick={() => void act(() => enablePush(draft).then(() => setDevice(draft)))}>
              Turn on notifications
            </button>
          )}
        </div>
      </>
    );

  return (
    <section className="card">
      <h3>Notifications</h3>
      {body}
      {msg && <p className="hint">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <p className="muted small">One message a day at most, only when there's something new. Set separately on each device.</p>
    </section>
  );
}

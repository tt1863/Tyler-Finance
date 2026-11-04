import { useEffect, useRef, useState } from 'react';
import { disableLock, lockoutRemaining, unlockWithBiometrics, unlockWithPasscode, useLock } from '../lib/lock';
import { deleteAllPoints } from '../lib/restorePoints';
import { signOut, syncConfigured, useSync } from '../lib/sync/cloud';
import { useStore } from '../lib/store';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/** Full-screen lock. Nothing from the budget is shown until it's unlocked. */
export default function LockScreen() {
  const settings = useLock((s) => s.settings);
  const sync = useSync();
  const signedIn = syncConfigured && !!sync.email;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [wait, setWait] = useState(lockoutRemaining());
  const tried = useRef(false);

  const bio = () => void unlockWithBiometrics();
  // Offer Face ID / Touch ID as soon as the app is on screen (not after "Lock now").
  useEffect(() => {
    const auto = () => {
      if (document.visibilityState !== 'visible' || tried.current) return;
      if (!useLock.getState().settings?.credentialId || useLock.getState().manual) return;
      tried.current = true;
      bio();
    };
    auto();
    document.addEventListener('visibilitychange', auto);
    return () => document.removeEventListener('visibilitychange', auto);
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(lockoutRemaining()), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);

  const submit = async (value: string) => {
    if (await unlockWithPasscode(value)) return;
    setCode('');
    setWait(lockoutRemaining());
    setError(lockoutRemaining() > 0 ? '' : 'Wrong passcode.');
    navigator.vibrate?.(150);
  };

  const length = settings?.length ?? 4;
  const press = (k: string) => {
    if (wait > 0) return;
    setError('');
    if (k === '⌫') return setCode((c) => c.slice(0, -1));
    const next = (code + k).slice(0, length);
    setCode(next);
    if (next.length === length) void submit(next);
  };

  const reset = async () => {
    if (signedIn) {
      if (!confirm('Sign out, remove the budget and restore points from this device, and turn off the lock? Sign in again to get your budget back from the cloud.')) return;
      await signOut(true);
    } else {
      if (!confirm("Erase this device's budget and restore points and turn off the lock? Without sync or a backup file, the budget can't be recovered.")) return;
      useStore.getState().replace(null);
    }
    await deleteAllPoints();
    disableLock();
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="logo">🔒</div>
        <h1>Tyler Finance</h1>
        {forgot ? (
          <>
            <p className="hint">
              {signedIn
                ? `Sign out on this device and turn off the lock. Your budget stays in the cloud: sign in again with ${sync.email} to get it back.`
                : "The passcode can't be recovered. You can erase this device's budget and start again, or import a backup file afterwards."}
            </p>
            <button className="btn danger" onClick={() => void reset()}>
              {signedIn ? 'Sign out and turn off the lock' : 'Erase and turn off the lock'}
            </button>
            <button className="link-btn small" onClick={() => setForgot(false)}>
              ← Back
            </button>
          </>
        ) : (
          <>
            <p className="muted">{wait > 0 ? `Too many tries. Try again in ${Math.ceil(wait / 1000)}s.` : 'Enter your passcode'}</p>
            <div className="pin-dots" aria-label={`${code.length} digits entered`}>
              {Array.from({ length }, (_, i) => (
                <span key={i} className={i < code.length ? 'on' : ''} />
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="keypad">
              {KEYS.map((k, i) =>
                k ? (
                  <button key={i} className="key" onClick={() => press(k)} disabled={wait > 0} aria-label={k === '⌫' ? 'Delete' : k}>
                    {k}
                  </button>
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
            <div className="lock-actions">
              {settings?.credentialId && (
                <button className="btn" onClick={bio}>
                  Use Face ID / Touch ID
                </button>
              )}
              <button className="link-btn small" onClick={() => setForgot(true)}>
                Forgot passcode?
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { PREVIEW } from '../lib/preview';
import { chooseBudget, EMAIL_KEY, sendCode, signOut, syncConfigured, syncNow, useSync, verifyCode } from '../lib/sync/cloud';
import Modal from './Modal';

function ago(ts?: number) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Email + 6-digit code sign-in. */
export function SignInForm() {
  const [email, setEmail] = useState(localStorage.getItem(EMAIL_KEY) ?? '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter your email address.');
    setBusy(true);
    setError('');
    try {
      await sendCode(email.trim());
      localStorage.setItem(EMAIL_KEY, email.trim());
      setStep('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      await verifyCode(email.trim(), code);
    } catch (e) {
      setError('That code didn’t work. Check it, or send a new one.');
    } finally {
      setBusy(false);
    }
  };

  return step === 'email' ? (
    <form className="form" onSubmit={(e) => (e.preventDefault(), send())}>
      {PREVIEW && (
        <p className="banner warn">
          Test copy: sign in with a <b>test address</b> such as <b>you+test@gmail.com</b> (it arrives in your normal inbox), never the email
          for your real budget.
        </p>
      )}
      <label>
        Email
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Sending…' : 'Email me a sign-in code'}
      </button>
    </form>
  ) : (
    <form className="form" onSubmit={(e) => (e.preventDefault(), verify())}>
      <p className="hint">
        We sent a code to <b>{email}</b>. Enter it below.
      </p>
      <label>
        Sign-in code
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <button className="btn primary" disabled={busy || code.length < 6}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <button type="button" className="btn" onClick={() => (setStep('email'), setCode(''))}>
          Use a different email
        </button>
        <button type="button" className="link-btn small" onClick={send} disabled={busy}>
          Resend code
        </button>
      </div>
    </form>
  );
}

/** Settings card for cloud sync. */
export default function SyncPanel() {
  const { status, email, lastSynced, error } = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!syncConfigured) {
    return (
      <section className="card">
        <h3>Sync across devices</h3>
        <p className="hint">Sync isn't set up in this version of the app yet.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Sync across devices</h3>
      {status === 'signed-out' ? (
        <>
          <p className="hint">Sign in to keep your budget in sync on your phone, tablet and computer. Your budget on this device is kept.</p>
          <SignInForm />
        </>
      ) : (
        <>
          <p>
            Signed in as <b>{email}</b>
          </p>
          <p className="hint">
            <SyncBadge inline /> {status === 'synced' && lastSynced && `· last synced ${ago(lastSynced)}`}
          </p>
          {status === 'error' && error && <p className="error small">{error}</p>}
          <div className="toolbar">
            <button className="btn" onClick={() => void syncNow()} disabled={status === 'syncing'}>
              Sync now
            </button>
            <button
              className="btn"
              onClick={() => {
                const remove = confirm(
                  'Signing out. Also remove the budget from this device?\n\nOK = remove it from this device (your cloud copy is kept)\nCancel = keep a copy here',
                );
                void signOut(remove);
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const LABELS: Record<string, string> = {
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline — changes saved on this device',
  error: 'Sync problem — will retry',
  choose: 'Waiting for your choice',
};

/** Small status line for the sidebar and settings. */
export function SyncBadge({ inline = false }: { inline?: boolean }) {
  const status = useSync((s) => s.status);
  if (status === 'disabled' || status === 'signed-out') return null;
  const icon = status === 'synced' ? '☁️' : status === 'syncing' ? '🔄' : status === 'offline' ? '📴' : '⚠️';
  return (
    <span className={`sync-badge ${status} ${inline ? 'inline' : ''}`}>
      {icon} {LABELS[status]}
    </span>
  );
}

/** Shown on first sign-in when both this device and the cloud already have a budget. */
export function ChooseBudgetModal() {
  const status = useSync((s) => s.status);
  if (status !== 'choose') return null;
  return (
    <Modal title="Which budget do you want to keep?" onClose={() => void signOut(false)}>
      <div className="form">
        <p>Your account already has a budget saved in the cloud, and this device has its own budget too.</p>
        <button className="btn primary big" onClick={() => void chooseBudget('cloud')}>
          Use my cloud budget
        </button>
        <p className="hint">Best for a new device. Replaces the budget on this device with the one from your account.</p>
        <button
          className="btn big"
          onClick={() =>
            confirm('This replaces the budget in your account (and on your other devices) with the one on this device. Continue?') &&
            void chooseBudget('device')
          }
        >
          Keep this device's budget
        </button>
        <p className="hint">Replaces the budget in your account and on your other devices with this one.</p>
      </div>
    </Modal>
  );
}

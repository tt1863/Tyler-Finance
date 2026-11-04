import { create } from 'zustand';
import { STORAGE_KEY } from './preview';

/**
 * App lock (per device). The passcode is stored only as a salted PBKDF2 hash.
 * Face ID / Touch ID uses a passkey on this device: asking the device to use
 * it requires the person's face or fingerprint. (This keeps the screen
 * private; it doesn't encrypt the stored budget.)
 */

export interface LockSettings {
  salt: string;
  hash: string;
  /** Number of digits, so the keypad submits once that many are typed. */
  length: number;
  /** Lock after this many minutes in the background (0 = immediately). */
  after: number;
  /** Passkey id (base64url) for Face ID / Touch ID, when set up. */
  credentialId?: string;
}

const KEY = `${STORAGE_KEY}-lock`;
const HIDDEN_AT = `${STORAGE_KEY}-hidden-at`;

export function loadLock(): LockSettings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LockSettings | null;
    return s?.hash && s.salt ? { ...s, length: s.length || 4 } : null;
  } catch {
    return null;
  }
}

function saveLock(s: LockSettings | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  useLock.setState({ settings: s });
}

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function hashPasscode(code: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 150_000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

export const validPasscode = (code: string) => /^\d{4,6}$/.test(code);

/** Whether the app should lock now, given when it went to the background. */
export function shouldLock(settings: LockSettings | null, hiddenAt: number | null, now: number): boolean {
  if (!settings) return false;
  if (hiddenAt === null) return false;
  return now - hiddenAt >= settings.after * 60_000;
}

interface LockState {
  settings: LockSettings | null;
  locked: boolean;
  /** Locked from Settings ("Lock now"): don't start Face ID by itself. */
  manual?: boolean;
}

/** Locked on launch when a lock is set up. */
export const useLock = create<LockState>(() => {
  const settings = loadLock();
  return { settings, locked: !!settings };
});

export async function enableLock(code: string, after: number) {
  const salt = b64(random(16));
  saveLock({ salt, hash: await hashPasscode(code, salt), length: code.length, after });
}

export function disableLock() {
  saveLock(null);
  localStorage.removeItem(FAILS);
  useLock.setState({ locked: false });
}

export function setLockAfter(after: number) {
  const s = useLock.getState().settings;
  if (s) saveLock({ ...s, after });
}

const FAILS = `${STORAGE_KEY}-lock-fails`;

/** After 5 wrong passcodes, wait 30 seconds, doubling each further miss (max 1 hour). */
export function waitAfterFailures(fails: number): number {
  return fails < 5 ? 0 : Math.min(3_600_000, 30_000 * 2 ** (fails - 5));
}

/** Milliseconds until another passcode may be tried. */
export function lockoutRemaining(now = Date.now()): number {
  try {
    const f = JSON.parse(localStorage.getItem(FAILS) ?? 'null') as { count: number; at: number } | null;
    return f ? Math.max(0, f.at + waitAfterFailures(f.count) - now) : 0;
  } catch {
    return 0;
  }
}

export async function unlockWithPasscode(code: string): Promise<boolean> {
  const s = useLock.getState().settings;
  if (!s) return true;
  if (lockoutRemaining() > 0) return false;
  const ok = (await hashPasscode(code, s.salt)) === s.hash;
  if (ok) {
    localStorage.removeItem(FAILS);
    useLock.setState({ locked: false });
  } else {
    const prev = JSON.parse(localStorage.getItem(FAILS) ?? '{"count":0}') as { count: number };
    localStorage.setItem(FAILS, JSON.stringify({ count: prev.count + 1, at: Date.now() }));
  }
  return ok;
}

// --- Face ID / Touch ID (passkey on this device) ---

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function setUpBiometrics(): Promise<void> {
  const s = useLock.getState().settings;
  if (!s) return;
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Tyler Finance' },
      user: { id: random(16), name: 'Tyler Finance lock', displayName: 'Tyler Finance' },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  saveLock({ ...s, credentialId: b64(cred.rawId) });
}

export function removeBiometrics() {
  const s = useLock.getState().settings;
  if (s) saveLock({ ...s, credentialId: undefined });
}

export async function unlockWithBiometrics(): Promise<boolean> {
  const s = useLock.getState().settings;
  if (!s?.credentialId) return false;
  try {
    const got = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: unb64(s.credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    if (got) useLock.setState({ locked: false });
    return !!got;
  } catch {
    return false;
  }
}

// --- Locking when the app goes to the background ---

let watching = false;
export function watchBackground() {
  if (watching) return;
  watching = true;
  const onChange = () => {
    const s = useLock.getState().settings;
    if (!s) return;
    if (document.visibilityState === 'hidden') {
      localStorage.setItem(HIDDEN_AT, String(Date.now()));
      // "Immediately": cover the screen now so the app switcher doesn't show amounts.
      if (s.after === 0) useLock.setState({ locked: true, manual: false });
    } else {
      const at = Number(localStorage.getItem(HIDDEN_AT));
      if (shouldLock(s, at || null, Date.now())) useLock.setState({ locked: true, manual: false });
    }
  };
  document.addEventListener('visibilitychange', onChange);
}

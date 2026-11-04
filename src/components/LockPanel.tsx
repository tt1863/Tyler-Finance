import { useEffect, useState } from 'react';
import {
  biometricsAvailable,
  disableLock,
  enableLock,
  removeBiometrics,
  setLockAfter,
  setUpBiometrics,
  unlockWithPasscode,
  useLock,
  validPasscode,
} from '../lib/lock';

const AFTER = [
  { value: 0, label: 'Immediately' },
  { value: 1, label: 'After 1 minute' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
];

/** Settings card: turn the app lock on or off, Face ID / Touch ID, and timing. */
export default function LockPanel() {
  const settings = useLock((s) => s.settings);
  const [setting, setSetting] = useState(false);
  const [code, setCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState('');
  const [bioOk, setBioOk] = useState(false);
  useEffect(() => void biometricsAvailable().then(setBioOk), []);

  const turnOn = async () => {
    if (!validPasscode(code)) return setError('Use 4 to 6 digits.');
    if (code !== confirmCode) return setError("The passcodes don't match.");
    await enableLock(code, 1);
    setSetting(false);
    setCode('');
    setConfirmCode('');
    setError('');
    if (bioOk && confirm('Also unlock with Face ID / Touch ID?')) void addBio();
  };

  const addBio = async () => {
    try {
      await setUpBiometrics();
    } catch {
      setError("Face ID / Touch ID wasn't set up.");
    }
  };

  const turnOff = async () => {
    const entered = prompt('Enter your passcode to turn off the lock');
    if (entered === null) return;
    if (await unlockWithPasscode(entered)) disableLock();
    else setError('Wrong passcode.');
  };

  return (
    <section className="card">
      <h3>App lock</h3>
      {!settings ? (
        setting ? (
          <div className="form">
            <div className="row">
              <label>
                Passcode (4–6 digits)
                <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label>
                Again
                <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmCode} onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <div className="export-row">
              <button className="btn primary" onClick={() => void turnOn()}>
                Turn on lock
              </button>
              <button className="btn" onClick={() => setSetting(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="hint">Ask for a passcode{bioOk ? ' or Face ID / Touch ID' : ''} when the app opens on this device.</p>
            <button className="btn" onClick={() => setSetting(true)}>
              Set up app lock
            </button>
          </>
        )
      ) : (
        <div className="form">
          <label>
            Lock when the app has been in the background
            <select value={settings.after} onChange={(e) => setLockAfter(Number(e.target.value))}>
              {AFTER.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {bioOk && (
            <label className="checkbox">
              <input type="checkbox" checked={!!settings.credentialId} onChange={(e) => (e.target.checked ? void addBio() : removeBiometrics())} />
              <span>Unlock with Face ID / Touch ID</span>
            </label>
          )}
          <div className="export-row">
            <button className="btn" onClick={() => useLock.setState({ locked: true, manual: true })}>
              Lock now
            </button>
            <button className="btn danger-outline" onClick={() => void turnOff()}>
              Turn off lock
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">Set separately on each device. The lock keeps the screen private; it doesn't encrypt the data.</p>
    </section>
  );
}

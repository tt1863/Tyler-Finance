import { useEffect, useState } from 'react';
import { deletePoint, getPoint, listPoints, makePoint, savePoint, type RestorePointInfo } from '../lib/restorePoints';
import { useData, useStore } from '../lib/store';

const KIND: Record<RestorePointInfo['kind'], string> = {
  auto: 'Daily',
  manual: 'Saved by you',
  'before-restore': 'Before a restore',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Settings card: list, save, restore and delete restore points. */
export default function RestorePanel() {
  const data = useData();
  const replace = useStore((s) => s.replace);
  const [points, setPoints] = useState<RestorePointInfo[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refresh = () =>
    listPoints()
      .then(setPoints)
      .catch(() => setError("Restore points aren't available in this browser (private browsing or storage turned off)."));
  useEffect(() => void refresh(), []);

  const saveNow = async () => {
    setBusy(true);
    try {
      await savePoint(makePoint(data, 'manual', note.trim()));
      setNote('');
      await refresh();
    } catch {
      setError("Couldn't save: this device is out of storage.");
    }
    setBusy(false);
  };

  const restore = async (p: RestorePointInfo) => {
    if (!confirm(`Restore your budget to ${when(p.at)}? Changes made since then will be replaced. Your current budget is saved as a restore point first.`))
      return;
    setBusy(true);
    try {
      const full = await getPoint(p.id);
      if (!full) throw new Error('missing');
      await savePoint(makePoint(data, 'before-restore'));
      replace(full.data);
      await refresh();
      alert('Budget restored.');
    } catch {
      setError("Couldn't restore that point.");
    }
    setBusy(false);
  };

  const remove = async (p: RestorePointInfo) => {
    if (!confirm(`Delete the restore point from ${when(p.at)}?`)) return;
    await deletePoint(p.id);
    await refresh();
  };

  const shown = points && (showAll ? points : points.slice(0, 5));

  return (
    <section className="card">
      <h3>Restore points</h3>
      <p className="hint">
        A copy of your budget is saved on this device each day you use the app (the last 14 are kept). Restoring one
        also updates your other devices.
      </p>
      <div className="restore-save">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Restore point note" />
        <button className="btn" onClick={saveNow} disabled={busy || !!error}>
          Save one now
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {shown && shown.length === 0 && !error && <p className="empty">No restore points yet.</p>}
      {shown && shown.length > 0 && (
        <ul className="restore-list">
          {shown.map((p) => (
            <li key={p.id}>
              <span className="rp-main">
                <b>{when(p.at)}</b>
                <small className="muted">
                  {KIND[p.kind]} · {p.transactions} transactions{p.note ? ` · ${p.note}` : ''}
                </small>
              </span>
              <button className="btn small" onClick={() => restore(p)} disabled={busy}>
                Restore
              </button>
              <button className="icon-btn" aria-label="Delete restore point" onClick={() => remove(p)} disabled={busy}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {points && points.length > 5 && (
        <button className="link-btn small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${points.length}`}
        </button>
      )}
    </section>
  );
}

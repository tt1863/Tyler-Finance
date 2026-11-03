import { useState, type ReactNode } from 'react';
import { bulkMove, bulkSetCategory, bulkSetCleared, totalOf, type BulkResult } from '../lib/bulk';
import { setFlag } from '../lib/flags';
import { fmt } from '../lib/money';
import { deleteTransactions } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { BudgetData, FlagColor } from '../lib/types';
import CategorySelect from './CategorySelect';
import FlagPicker from './FlagPicker';
import Modal from './Modal';

type Picker = 'category' | 'flag' | 'move' | null;

/** Actions for the transactions selected in an account list. */
export default function BulkBar({ selected, onClear }: { selected: Set<string>; onClear: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [picker, setPicker] = useState<Picker>(null);
  const [message, setMessage] = useState('');
  const ids = [...selected];
  const total = totalOf(data, selected);

  // Run a bulk change as one step (one Undo reverses it) and report what happened.
  const run = (fn: (d: BudgetData) => BulkResult) => {
    let result: BulkResult | null = null;
    update((d) => {
      result = fn(d);
      return result.data;
    });
    const r = result as BulkResult | null;
    if (r) setMessage(`Updated ${r.changed}${r.skipped ? `, skipped ${r.skipped} (splits, transfers or reconciled)` : ''}.`);
    setPicker(null);
  };

  return (
    <>
      <div className="bulk-bar" role="toolbar" aria-label="Selected transactions">
        <div className="bulk-summary">
          <b>{selected.size} selected</b>
          <span className={total < 0 ? 'neg' : 'pos'}>{fmt(total)}</span>
          <button className="link-btn small" onClick={() => (setMessage(''), onClear())}>
            Clear
          </button>
        </div>
        {message && <div className="bulk-message">{message}</div>}
        <div className="bulk-actions">
          <button className="btn small" onClick={() => setPicker('category')}>
            Category
          </button>
          <button className="btn small" onClick={() => setPicker('flag')}>
            Flag
          </button>
          <button className="btn small" onClick={() => run((d) => bulkSetCleared(d, ids, 'cleared'))}>
            Cleared
          </button>
          <button className="btn small" onClick={() => run((d) => bulkSetCleared(d, ids, 'uncleared'))}>
            Uncleared
          </button>
          <button className="btn small" onClick={() => setPicker('move')}>
            Move
          </button>
          <button
            className="btn small danger-outline"
            onClick={() => {
              if (!confirm(`Delete ${selected.size} transactions?`)) return;
              update((d) => deleteTransactions(d, ids));
              onClear();
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {picker === 'category' && (
        <PickModal title={`Category for ${selected.size} transactions`} onClose={() => setPicker(null)}>
          <CategorySelect data={data} value={null} onChange={(id) => id && run((d) => bulkSetCategory(d, ids, id))} includeRta includeNone="Choose a category…" />
        </PickModal>
      )}
      {picker === 'flag' && (
        <PickModal title={`Flag ${selected.size} transactions`} onClose={() => setPicker(null)}>
          <FlagPicker
            data={data}
            value={undefined}
            onChange={(c: FlagColor | null) => run((d) => ({ data: setFlag(d, ids, c), changed: ids.length, skipped: 0 }))}
          />
          <p className="hint">Tap ∅ to remove flags.</p>
        </PickModal>
      )}
      {picker === 'move' && (
        <PickModal title={`Move ${selected.size} transactions to`} onClose={() => setPicker(null)}>
          <select defaultValue="" onChange={(e) => e.target.value && run((d) => bulkMove(d, ids, e.target.value))}>
            <option value="">Choose an account…</option>
            {data.accounts
              .filter((a) => !a.closed)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </PickModal>
      )}
    </>
  );
}

function PickModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">{children}</div>
    </Modal>
  );
}

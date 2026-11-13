import { useState } from 'react';
import { deleteRule, saveRule } from '../lib/review';
import { useData, useStore } from '../lib/store';
import type { PayeeRule } from '../lib/types';
import CategorySelect, { categoryName } from './CategorySelect';
import Modal from './Modal';

/** Settings card: rules that clean up bank payee names and pick categories. */
export default function RulesPanel() {
  const data = useData();
  const update = useStore((s) => s.update);
  const [editing, setEditing] = useState<PayeeRule | 'new' | null>(null);
  const [message, setMessage] = useState('');

  return (
    <section className="card">
      <h3>Payee rules</h3>
      <p className="hint">
        Rules rename messy bank descriptions and pick a category for imported transactions. Tip: open an imported transaction and tick
        "Always do this" to make one.
      </p>
      {data.payeeRules.length > 0 && (
        <ul className="rule-list">
          {data.payeeRules.map((r) => (
            <li key={r.id}>
              <button className="link-btn rule-item" onClick={() => setEditing(r)}>
                <span className="truncate">
                  {r.matchType === 'exact' ? 'is' : 'contains'} “{r.match}”
                </span>
                <span className="muted small truncate">
                  → {r.rename || 'keep name'}
                  {r.categoryId ? ` · ${categoryName(data, r.categoryId)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="good small">{message}</p>}
      <button className="btn" onClick={() => setEditing('new')}>
        + Add rule
      </button>
      {editing && (
        <RuleModal
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            let applied = 0;
            update((d) => {
              const r = saveRule(d, rule);
              applied = r.applied;
              return r.data;
            });
            setMessage(applied ? `Rule saved and applied to ${applied} transaction${applied === 1 ? '' : 's'}.` : 'Rule saved.');
            setEditing(null);
          }}
          onDelete={(id) => {
            update((d) => deleteRule(d, id));
            setMessage('Rule deleted.');
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function RuleModal({
  rule,
  onClose,
  onSave,
  onDelete,
}: {
  rule?: PayeeRule;
  onClose: () => void;
  onSave: (rule: Omit<PayeeRule, 'id'> & { id?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const data = useData();
  const [match, setMatch] = useState(rule?.match ?? '');
  const [matchType, setMatchType] = useState<PayeeRule['matchType']>(rule?.matchType ?? 'contains');
  const [rename, setRename] = useState(rule?.rename ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [error, setError] = useState('');

  const save = () => {
    if (!match.trim()) return setError('Enter the bank text to look for.');
    if (!rename.trim() && !categoryId) return setError('Set a new payee name, a category, or both.');
    onSave({ id: rule?.id, match, matchType, rename: rename || undefined, categoryId: categoryId ?? undefined });
  };

  return (
    <Modal
      title={rule ? 'Edit rule' : 'New rule'}
      onClose={onClose}
      footer={
        <>
          {rule && (
            <button className="btn danger-outline" onClick={() => onDelete(rule.id)}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="row">
          <label>
            When the bank's description
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as PayeeRule['matchType'])}>
              <option value="contains">contains</option>
              <option value="exact">is exactly</option>
            </select>
          </label>
          <label>
            Text
            <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="e.g. BLUE BOTTLE" />
          </label>
        </div>
        <label>
          Rename the payee to
          <input value={rename} onChange={(e) => setRename(e.target.value)} placeholder="Leave empty to keep the bank's name" />
        </label>
        <label>
          Category
          <CategorySelect data={data} value={categoryId} onChange={setCategoryId} includeRta includeNone="Don't change" />
        </label>
        <p className="hint">Capital letters don't matter. Saving also fixes matching transactions that are still waiting for review or a category.</p>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}

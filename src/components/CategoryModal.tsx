import { useState } from 'react';
import { addMonths } from '../lib/dates';
import { parseMoney, toInput } from '../lib/money';
import { deleteCategory, reorder, updateCategory } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { Category, Target, TargetType } from '../lib/types';
import CategorySelect from './CategorySelect';
import Modal from './Modal';

const TARGETS: { value: TargetType; label: string; help: string }[] = [
  { value: 'monthly', label: 'Assign each month', help: 'Assign this amount every month (subscriptions, savings).' },
  { value: 'refill', label: 'Refill up to each month', help: 'Top the category up to this amount each month (groceries, gas).' },
  { value: 'byDate', label: 'Have a balance by a date', help: 'Save this total by a month, spread evenly (vacation, gifts).' },
  { value: 'balance', label: 'Have a balance of', help: 'Build up to this balance and keep it (emergency fund).' },
];

export default function CategoryModal({ category, month, onClose }: { category: Category; month: string; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isPayment = !!category.ccAccountId;
  const [name, setName] = useState(category.name);
  const [groupId, setGroupId] = useState(category.groupId);
  const [note, setNote] = useState(category.note ?? '');
  const [hasTarget, setHasTarget] = useState(!!category.target);
  const [targetType, setTargetType] = useState<TargetType>(category.target?.type ?? 'monthly');
  const [targetAmount, setTargetAmount] = useState(toInput(category.target?.amount ?? 0));
  const [targetMonth, setTargetMonth] = useState(category.target?.month ?? addMonths(month, 6));
  const [deleting, setDeleting] = useState(false);
  const [reassign, setReassign] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = () => {
    if (!name.trim()) return setError('Name is required.');
    let target: Target | undefined;
    if (hasTarget) {
      const amount = parseMoney(targetAmount);
      if (amount === null || amount <= 0) return setError('Enter a target amount.');
      target = { type: targetType, amount, ...(targetType === 'byDate' ? { month: targetMonth } : {}) };
    }
    update((d) => updateCategory(d, category.id, { name: name.trim(), groupId, note: note.trim() || undefined, target }));
    onClose();
  };

  const used = data.transactions.some((t) => t.categoryId === category.id);

  if (deleting) {
    return (
      <Modal
        title={`Delete "${category.name}"`}
        onClose={onClose}
        footer={
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => setDeleting(false)}>
              Back
            </button>
            <button
              className="btn danger"
              disabled={used && !reassign}
              onClick={() => {
                update((d) => deleteCategory(d, category.id, reassign));
                onClose();
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <div className="form">
          {used ? (
            <label>
              Move its transactions and assigned money to
              <CategorySelect data={data} value={reassign} onChange={setReassign} exclude={category.id} includeNone="Choose a category…" />
            </label>
          ) : (
            <p>This category has no transactions. Any assigned money returns to Ready to Assign.</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Edit Category"
      onClose={onClose}
      footer={
        <>
          {!isPayment && (
            <button className="btn danger-outline" onClick={() => setDeleting(true)}>
              Delete
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              update((d) => updateCategory(d, category.id, { hidden: !category.hidden }));
              onClose();
            }}
          >
            {category.hidden ? 'Unhide' : 'Hide'}
          </button>
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
        <label>
          Name
          <input value={name} disabled={isPayment} onChange={(e) => setName(e.target.value)} />
        </label>
        {!isPayment && (
          <div className="row">
            <label>
              Group
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {data.groups
                  .filter((g) => !g.system)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="reorder">
              <span>Order</span>
              <div>
                {([-1, 1] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    className="btn small"
                    onClick={() =>
                      update((d) => ({ ...d, categories: reorder(d.categories, category.id, dir, (a, b) => a.groupId === b.groupId) }))
                    }
                  >
                    {dir < 0 ? '↑ Up' : '↓ Down'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={hasTarget} onChange={(e) => setHasTarget(e.target.checked)} />
          <span>
            <b>Set a target</b> — tells you how much to assign each month.
          </span>
        </label>
        {hasTarget && (
          <fieldset className="target-fields">
            <label>
              Target type
              <select value={targetType} onChange={(e) => setTargetType(e.target.value as TargetType)}>
                {TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{TARGETS.find((t) => t.value === targetType)?.help}</p>
            <div className="row">
              <label>
                Amount
                <input inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0.00" />
              </label>
              {targetType === 'byDate' && (
                <label>
                  By month
                  <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} />
                </label>
              )}
            </div>
          </fieldset>
        )}
        <label>
          Note
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}

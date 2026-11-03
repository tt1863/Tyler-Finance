import { useState } from 'react';
import { addMonths } from '../lib/dates';
import { parseMoney, toInput } from '../lib/money';
import { deleteCategory, reorder, updateCategory } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import { today } from '../lib/dates';
import type { Category, Target, TargetBehavior } from '../lib/types';
import CategorySelect from './CategorySelect';
import Modal from './Modal';

type Cadence = 'weekly' | 'monthly' | 'yearly' | 'custom' | 'balance';

const CADENCES: { value: Cadence; label: string; help: string }[] = [
  { value: 'weekly', label: 'Weekly', help: 'An amount every week, e.g. groceries or gas.' },
  { value: 'monthly', label: 'Monthly', help: 'An amount every month, e.g. bills and subscriptions.' },
  { value: 'yearly', label: 'Yearly', help: 'An amount due once a year, spread over the months before it.' },
  { value: 'custom', label: 'Custom date', help: 'An amount due on a date, once or repeating, spread over the months before it.' },
  { value: 'balance', label: 'Have a balance of', help: 'Build up to a balance and keep it, e.g. an emergency fund.' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Editor state from a saved target (older target types map onto the new choices). */
function fromTarget(t: Target | undefined, month: string) {
  const year = month.slice(0, 4);
  const base = {
    cadence: 'monthly' as Cadence,
    behavior: 'setAside' as TargetBehavior,
    weekday: 1,
    yearlyDate: `${year}-12-31`,
    customDate: `${month}-28`,
    repeat: 'none' as NonNullable<Target['repeat']>,
    byMonth: false,
    month: addMonths(month, 6),
  };
  if (!t) return base;
  switch (t.type) {
    case 'monthly':
      return { ...base, behavior: t.behavior ?? 'setAside' };
    case 'refill':
      return { ...base, behavior: 'refill' as TargetBehavior };
    case 'weekly':
      return { ...base, cadence: 'weekly' as Cadence, behavior: t.behavior ?? 'setAside', weekday: t.weekday ?? 1 };
    case 'yearly':
      return { ...base, cadence: 'yearly' as Cadence, behavior: t.behavior ?? 'setAside', yearlyDate: `${year}-${t.due ?? '12-31'}` };
    case 'custom':
      return { ...base, cadence: 'custom' as Cadence, behavior: t.behavior ?? 'setAside', customDate: t.due ?? base.customDate, repeat: t.repeat ?? 'none' };
    case 'byDate':
      return { ...base, cadence: 'balance' as Cadence, byMonth: true, month: t.month ?? base.month };
    case 'balance':
      return { ...base, cadence: 'balance' as Cadence };
  }
}

export default function CategoryModal({ category, month, onClose }: { category: Category; month: string; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isPayment = !!category.ccAccountId;
  const [name, setName] = useState(category.name);
  const [groupId, setGroupId] = useState(category.groupId);
  const [note, setNote] = useState(category.note ?? '');
  const [hasTarget, setHasTarget] = useState(!!category.target);
  const [form, setForm] = useState(() => fromTarget(category.target, month));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [targetAmount, setTargetAmount] = useState(toInput(category.target?.amount ?? 0));
  const [deleting, setDeleting] = useState(false);
  const [reassign, setReassign] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = () => {
    if (!name.trim()) return setError('Name is required.');
    let target: Target | undefined;
    if (hasTarget) {
      const amount = parseMoney(targetAmount);
      if (amount === null || amount <= 0) return setError('Enter a target amount.');
      const f = form;
      switch (f.cadence) {
        case 'weekly':
          target = { type: 'weekly', amount, weekday: f.weekday, behavior: f.behavior };
          break;
        case 'monthly':
          target = { type: 'monthly', amount, behavior: f.behavior };
          break;
        case 'yearly':
          target = { type: 'yearly', amount, due: f.yearlyDate.slice(5), behavior: f.behavior };
          break;
        case 'custom':
          if (!f.customDate) return setError('Choose the due date.');
          target = {
            type: 'custom',
            amount,
            due: f.customDate,
            repeat: f.repeat,
            behavior: f.behavior,
            start: category.target?.type === 'custom' ? (category.target.start ?? month) : month,
          };
          break;
        case 'balance':
          target = f.byMonth ? { type: 'byDate', amount, month: f.month } : { type: 'balance', amount };
          break;
      }
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
              How often
              <select value={form.cadence} onChange={(e) => set({ cadence: e.target.value as Cadence })}>
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{CADENCES.find((c) => c.value === form.cadence)?.help}</p>
            {form.cadence !== 'balance' && (
              <div className="segmented">
                <button type="button" className={form.behavior === 'setAside' ? 'active' : ''} onClick={() => set({ behavior: 'setAside' })}>
                  {form.cadence === 'custom' ? 'Set aside' : 'Set aside another'}
                </button>
                <button type="button" className={form.behavior === 'refill' ? 'active' : ''} onClick={() => set({ behavior: 'refill' })}>
                  {form.cadence === 'custom' ? 'Fill up to' : 'Refill up to'}
                </button>
              </div>
            )}
            {form.cadence !== 'balance' && (
              <p className="hint">
                {form.behavior === 'setAside'
                  ? 'Asks for the full amount each time, even if money is left over (it builds up).'
                  : 'Only asks for what was spent, topping the category back up to the amount.'}
              </p>
            )}
            <div className="row">
              <label>
                {form.cadence === 'weekly' ? 'Amount per week' : form.cadence === 'balance' ? 'Balance' : 'Amount'}
                <input inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0.00" />
              </label>
              {form.cadence === 'weekly' && (
                <label>
                  Week starts on
                  <select value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((w, i) => (
                      <option key={w} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {form.cadence === 'yearly' && (
                <label>
                  By (each year)
                  <input type="date" value={form.yearlyDate} onChange={(e) => set({ yearlyDate: e.target.value })} />
                </label>
              )}
              {form.cadence === 'custom' && (
                <label>
                  Due on
                  <input type="date" value={form.customDate} min={today().slice(0, 8) + '01'} onChange={(e) => set({ customDate: e.target.value })} />
                </label>
              )}
            </div>
            {form.cadence === 'custom' && (
              <label>
                Repeat
                <select value={form.repeat} onChange={(e) => set({ repeat: e.target.value as typeof form.repeat })}>
                  <option value="none">Don't repeat</option>
                  <option value="monthly">Every month</option>
                  <option value="yearly">Every year</option>
                </select>
              </label>
            )}
            {form.cadence === 'balance' && (
              <>
                <label className="checkbox">
                  <input type="checkbox" checked={form.byMonth} onChange={(e) => set({ byMonth: e.target.checked })} />
                  <span>By a certain month</span>
                </label>
                {form.byMonth && (
                  <label>
                    By month
                    <input type="month" value={form.month} onChange={(e) => set({ month: e.target.value })} />
                  </label>
                )}
              </>
            )}
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

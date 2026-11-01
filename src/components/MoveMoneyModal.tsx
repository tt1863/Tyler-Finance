import { useState } from 'react';
import { categoryMonth, type MonthSummary } from '../lib/budget';
import { fmt, parseMoney, toInput } from '../lib/money';
import { moveMoney } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import { READY_TO_ASSIGN } from '../lib/types';
import CategorySelect, { categoryName } from './CategorySelect';
import Modal from './Modal';

/**
 * Move money in or out of a category (or Ready to Assign). If the category is
 * overspent, defaults to covering the overspending.
 */
export default function MoveMoneyModal({
  categoryId,
  month,
  summary,
  onClose,
}: {
  categoryId: string;
  month: string;
  summary: MonthSummary;
  onClose: () => void;
}) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isRta = categoryId === READY_TO_ASSIGN;
  const available = isRta ? summary.readyToAssign : categoryMonth(summary, categoryId).available;
  const covering = available < 0;
  const [amount, setAmount] = useState(toInput(Math.abs(available)));
  const [other, setOther] = useState<string | null>(covering && !isRta ? READY_TO_ASSIGN : null);
  const [error, setError] = useState('');

  const balanceOf = (id: string) => (id === READY_TO_ASSIGN ? summary.readyToAssign : categoryMonth(summary, id).available);

  const submit = () => {
    const cents = parseMoney(amount);
    if (!cents || cents <= 0) return setError('Enter an amount.');
    if (!other) return setError('Choose a category.');
    const [from, to] = covering ? [other, categoryId] : [categoryId, other];
    update((d) => moveMoney(d, month, from, to, cents));
    onClose();
  };

  return (
    <Modal
      title={covering ? `Cover overspending in ${categoryName(data, categoryId)}` : `Move from ${categoryName(data, categoryId)}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            {covering ? 'Cover' : 'Move'}
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <p className="hint">
          Available: <b className={available < 0 ? 'neg' : ''}>{fmt(available)}</b>
        </p>
        <label>
          Amount
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          {covering ? 'Take money from' : 'Move to'}
          <CategorySelect
            data={data}
            value={other}
            onChange={setOther}
            includeRta={!isRta}
            exclude={categoryId}
            includeNone="Choose…"
          />
        </label>
        {other && (
          <p className="hint">
            {categoryName(data, other)} has {fmt(balanceOf(other))} available.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}

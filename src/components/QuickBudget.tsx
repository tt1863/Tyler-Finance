import { useMemo } from 'react';
import { computeBudget } from '../lib/budget';
import { fmt } from '../lib/money';
import { applyQuickBudget, QUICK_OPTIONS, quickAmount, quickTotals } from '../lib/quickBudget';
import { useData, useStore } from '../lib/store';
import type { Category } from '../lib/types';
import Modal from './Modal';

/** One-tap amounts for a single category. */
export function CategoryQuickBudget({ category, month }: { category: Category; month: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const months = useMemo(() => computeBudget(data, month), [data, month]);
  const current = months.get(month)?.categories[category.id]?.assigned ?? 0;
  const options = QUICK_OPTIONS.map((o) => ({ ...o, amount: quickAmount(o.key, category, month, months, data) })).filter(
    (o) => o.amount !== null && !(o.key === 'resetAssigned' && current === 0),
  );

  return (
    <div className="quick-budget">
      <h4>Quick budget</h4>
      {options.map((o) => (
        <button
          key={o.key}
          className="quick-option"
          disabled={o.amount === current}
          title={o.help}
          onClick={() => update((d) => applyQuickBudget(d, month, o.key, category.id))}
        >
          <span>{o.label}</span>
          <b>{fmt(o.amount!)}</b>
        </button>
      ))}
    </div>
  );
}

/** Quick budget for every category in the month. */
export function QuickBudgetModal({ month, onClose }: { month: string; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const totals = useMemo(() => quickTotals(data, month), [data, month]);

  return (
    <Modal title="Quick budget" onClose={onClose}>
      <div className="form">
        <p className="hint">Set every category's assigned amount at once. You can still change any of them afterwards, or undo.</p>
        {QUICK_OPTIONS.filter((o) => o.key !== 'resetAssigned').map((o) => {
          const t = totals[o.key];
          return (
            <button
              key={o.key}
              className="quick-option wide"
              disabled={t.categories === 0}
              onClick={() => {
                update((d) => applyQuickBudget(d, month, o.key));
                onClose();
              }}
            >
              <span>
                <b>{o.label}</b>
                <span className="muted small">{o.help}</span>
              </span>
              <span className="quick-change">
                {t.categories === 0 ? (
                  <span className="muted small">No change</span>
                ) : (
                  <>
                    <b className={t.change > 0 ? '' : 'pos'}>
                      {t.change > 0 ? '+' : '−'}
                      {fmt(Math.abs(t.change))}
                    </b>
                    <span className="muted small">
                      {t.categories} {t.categories === 1 ? 'category' : 'categories'}
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

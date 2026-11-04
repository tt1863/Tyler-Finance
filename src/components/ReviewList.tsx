import { useMemo, useState } from 'react';
import { dateLabel } from '../lib/dates';
import { fmt } from '../lib/money';
import { approveTransactions, isUnapproved } from '../lib/review';
import { useData, useStore } from '../lib/store';
import type { Transaction } from '../lib/types';
import { READY_TO_ASSIGN } from '../lib/types';
import CategorySelect, { transactionCategoryLabel } from './CategorySelect';

const SHOW = 25;

/** Imported transactions waiting for review: pick a category and approve. */
export default function ReviewList({ accountId, onOpen }: { accountId: string; onOpen: (t: Transaction) => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [showAll, setShowAll] = useState(false);
  const isAll = accountId === 'all';
  const items = useMemo(
    () =>
      data.transactions
        .filter((t) => isUnapproved(t) && (isAll || t.accountId === accountId))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.transactions, accountId, isAll],
  );
  if (!items.length) return null;
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id));
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';

  const setCategory = (t: Transaction, categoryId: string | null) =>
    update((d) => ({
      ...d,
      transactions: d.transactions.map((x) => (x.id === t.id ? { ...x, categoryId } : x)),
      // Remember it, so this payee is categorized automatically next time.
      payeeCategory: categoryId && categoryId !== READY_TO_ASSIGN && t.payee ? { ...d.payeeCategory, [t.payee]: categoryId } : d.payeeCategory,
    }));

  return (
    <div className="review-box">
      <div className="review-head">
        <b>📥 To review ({items.length})</b>
        <button className="btn small" onClick={() => update((d) => approveTransactions(d, items.map((t) => t.id)))}>
          ✓ Approve all
        </button>
      </div>
      {(showAll ? items : items.slice(0, SHOW)).map((t) => {
        const simple = !t.splits?.length && !t.transferAccountId && onBudget.has(t.accountId);
        return (
          <div key={t.id} className="review-row">
            <button className="review-main link-btn" onClick={() => onOpen(t)}>
              <span className="review-line">
                <b className="truncate">{t.payee || 'No payee'}</b>
                <span className={t.amount < 0 ? 'neg' : 'pos'}>{fmt(t.amount)}</span>
              </span>
              <span className="muted small truncate">
                {dateLabel(t.date)}
                {isAll && ` · ${accountName(t.accountId)}`}
                {t.bankPayee && t.bankPayee !== t.payee && ` · ${t.bankPayee}`}
              </span>
            </button>
            <div className="review-actions">
              {simple ? (
                <CategorySelect data={data} value={t.categoryId} onChange={(id) => setCategory(t, id)} includeRta includeNone="Choose category" />
              ) : (
                <span className="muted small truncate review-cat">{transactionCategoryLabel(data, t) || (onBudget.has(t.accountId) ? '' : 'Tracking account')}</span>
              )}
              <button className="btn primary small approve" aria-label={`Approve ${t.payee}`} onClick={() => update((d) => approveTransactions(d, [t.id]))}>
                ✓
              </button>
            </div>
          </div>
        );
      })}
      {items.length > SHOW && !showAll && (
        <button className="btn small more" onClick={() => setShowAll(true)}>
          Show all {items.length}
        </button>
      )}
    </div>
  );
}

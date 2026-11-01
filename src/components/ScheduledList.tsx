import { useState } from 'react';
import { dateLabel, today } from '../lib/dates';
import { fmt } from '../lib/money';
import { enterNow, frequencyLabel, nextDate, skipNext } from '../lib/scheduled';
import { useData, useStore } from '../lib/store';
import type { Scheduled } from '../lib/types';
import { transactionCategoryLabel } from './CategorySelect';
import TransactionForm from './TransactionForm';

/** Upcoming scheduled transactions for one account (or all accounts). */
export default function ScheduledList({ accountId }: { accountId: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<Scheduled | null>(null);
  const isAll = accountId === 'all';
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';

  const items = data.scheduled
    .filter((s) => isAll || s.accountId === accountId || s.transferAccountId === accountId)
    .map((s) => ({ s, date: nextDate(s) }))
    .filter((x): x is { s: Scheduled; date: string } => x.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!items.length) return null;

  return (
    <div className="scheduled">
      <button className="scheduled-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} Scheduled ({items.length})</span>
        <span className="muted small">Entered automatically on their date</span>
      </button>
      {open &&
        items.map(({ s, date }) => {
          // In the other account of a transfer, show it from that side.
          const mirrored = !isAll && s.transferAccountId === accountId;
          const amount = mirrored ? -s.amount : s.amount;
          const payee = mirrored ? `Transfer : ${accountName(s.accountId)}` : s.payee;
          return (
            <div key={s.id} className="sched-row" onClick={() => setEditing(s)}>
              <span className="sched-date">
                {dateLabel(date)}
                <span className="muted small">🔁 {frequencyLabel(s.frequency)}</span>
              </span>
              <span className="sched-main truncate">
                <b className="truncate">{payee || 'No payee'}</b>
                <span className="muted small truncate">
                  {isAll && `${accountName(s.accountId)} · `}
                  {s.transferAccountId ? 'Transfer' : transactionCategoryLabel(data, s) || 'No category'}
                </span>
              </span>
              <span className={`num ${amount < 0 ? 'neg' : 'pos'}`}>{fmt(amount)}</span>
              <span className="sched-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn small" onClick={() => update((d) => enterNow(d, s.id, today()))} title="Enter it now, dated today">
                  Enter now
                </button>
                <button className="btn small" onClick={() => update((d) => skipNext(d, s.id))} title="Skip this one">
                  Skip
                </button>
              </span>
            </div>
          );
        })}
      {editing && <TransactionForm scheduled={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

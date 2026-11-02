import { useMemo } from 'react';
import { dateLabel } from '../lib/dates';
import { fmt } from '../lib/money';
import { useData, useStore } from '../lib/store';
import { dismissTransfer, findTransferPairs, linkAsTransfer } from '../lib/transfers';

/** Suggested transfers between the person's own accounts, to link or dismiss. */
export default function TransferSuggestions({ accountId }: { accountId: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const isAll = accountId === 'all';
  const pairs = useMemo(
    () => findTransferPairs(data).filter((p) => isAll || p.from.accountId === accountId || p.to.accountId === accountId),
    [data, accountId, isAll],
  );
  if (!pairs.length) return null;
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="transfer-box">
      <div className="transfer-head">
        <b>🔁 Possible transfers ({pairs.length})</b>
        <span className="muted small">Money moving between your own accounts isn't spending.</span>
      </div>
      {pairs.map(({ from, to }) => (
        <div key={from.id + to.id} className="transfer-row">
          <div className="transfer-main">
            <span>
              <b>{fmt(-from.amount)}</b> from <b>{name(from.accountId)}</b> to <b>{name(to.accountId)}</b>
            </span>
            <span className="muted small truncate">
              {dateLabel(from.date)}
              {from.date !== to.date && ` – ${dateLabel(to.date)}`} · {from.payee || '—'} / {to.payee || '—'}
            </span>
          </div>
          <div className="transfer-actions">
            <button className="btn primary small" onClick={() => update((d) => linkAsTransfer(d, from.id, to.id))}>
              Link as transfer
            </button>
            <button className="btn small" onClick={() => update((d) => dismissTransfer(d, from.id, to.id))}>
              Not a transfer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

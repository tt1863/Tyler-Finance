import { useState } from 'react';
import { csvToRows } from '../lib/csv';
import { dateLabel } from '../lib/dates';
import { fmt } from '../lib/money';
import { importTransactions, type ImportRow } from '../lib/ops';
import { useStore } from '../lib/store';
import Modal from './Modal';

export default function ImportModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const update = useStore((s) => s.update);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [errors, setErrors] = useState(0);
  const [flip, setFlip] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const parsed = csvToRows(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
  };

  const doImport = () => {
    if (!rows) return;
    const finalRows = flip ? rows.map((r) => ({ ...r, amount: -r.amount })) : rows;
    let msg = '';
    update((d) => {
      const r = importTransactions(d, accountId, finalRows);
      msg = `Imported ${r.added} transaction${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}.`;
      return r.data;
    });
    setResult(msg);
  };

  return (
    <Modal title="Import Bank Transactions (CSV)" onClose={onClose}>
      {result ? (
        <div className="form">
          <p>{result}</p>
          <p className="hint">Imported transactions are auto-categorized from payees you've used before. Check "Needs category" for the rest.</p>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="form">
          <p className="hint">
            Download a CSV from your bank's website. It needs a <b>Date</b> column and either an <b>Amount</b> column or{' '}
            <b>Outflow/Inflow</b> (Debit/Credit) columns. Payee/Description and Memo are optional.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {rows && (
            <>
              <p>
                Found <b>{rows.length}</b> transactions{errors > 0 && <span className="error"> ({errors} rows couldn't be read)</span>}.
              </p>
              {rows.length > 0 && (
                <>
                  <div className="preview">
                    {rows.slice(0, 5).map((r, i) => {
                      const amt = flip ? -r.amount : r.amount;
                      return (
                        <div key={i} className="preview-row">
                          <span>{dateLabel(r.date)}</span>
                          <span className="truncate">{r.payee}</span>
                          <span className={amt < 0 ? 'neg' : 'pos'}>{fmt(amt)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
                    <span>Flip signs (if purchases show as positive)</span>
                  </label>
                  <button className="btn primary" onClick={doImport}>
                    Import {rows.length} transactions
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

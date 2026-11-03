import { useState } from 'react';
import { applyOptions, parseBankFile, type FileKind } from '../lib/fileImport';
import { dateLabel } from '../lib/dates';
import { fmt } from '../lib/money';
import { importTransactions, type ImportRow } from '../lib/ops';
import { useStore } from '../lib/store';
import Modal from './Modal';

export default function ImportModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const update = useStore((s) => s.update);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [errors, setErrors] = useState(0);
  const [kind, setKind] = useState<FileKind>('csv');
  const [flip, setFlip] = useState(false);
  const [importMemos, setImportMemos] = useState(true);
  const [swap, setSwap] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const parsed = parseBankFile(file.name, await file.text());
    setKind(parsed.kind);
    setRows(parsed.rows);
    setErrors(parsed.errors);
  };

  const doImport = () => {
    if (!rows) return;
    const finalRows = applyOptions(rows, { flip, importMemos, swapPayeeMemo: swap });
    let msg = '';
    update((d) => {
      const r = importTransactions(d, accountId, finalRows);
      msg = `Imported ${r.added} transaction${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}.`;
      return r.data;
    });
    setResult(msg);
  };

  return (
    <Modal title="Import Bank Transactions" onClose={onClose}>
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
            Download transactions from your bank's website as <b>OFX</b>, <b>QFX</b>, <b>QIF</b> or <b>CSV</b>. OFX/QFX works
            best: re-importing the same file never adds duplicates. A CSV needs a <b>Date</b> column and either an{' '}
            <b>Amount</b> column or <b>Outflow/Inflow</b> (Debit/Credit) columns.
          </p>
          <input type="file" accept=".csv,.ofx,.qfx,.qif,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {rows && (
            <>
              <p>
                Found <b>{rows.length}</b> transactions in this {kind.toUpperCase()} file{errors > 0 && <span className="error"> ({errors} rows couldn't be read)</span>}.
              </p>
              {rows.length > 0 && (
                <>
                  <div className="preview">
                    {applyOptions(rows.slice(0, 5), { flip, importMemos, swapPayeeMemo: swap }).map((r, i) => (
                      <div key={i} className="preview-row">
                        <span>{dateLabel(r.date)}</span>
                        <span className="truncate">
                          {r.payee}
                          {r.memo && <small className="muted"> · {r.memo}</small>}
                        </span>
                        <span className={r.amount < 0 ? 'neg' : 'pos'}>{fmt(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={importMemos} onChange={(e) => setImportMemos(e.target.checked)} />
                    <span>Import memos</span>
                  </label>
                  <label className="checkbox">
                    <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
                    <span>Swap payee and memo (if the bank puts the store name in the memo)</span>
                  </label>
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

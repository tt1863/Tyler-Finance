import { parseDate } from './dates';
import { parseMoney } from './money';
import type { ImportRow } from './ops';

/** Minimal RFC 4180 CSV parser (handles quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const find = (headers: string[], ...names: string[]) =>
  headers.findIndex((h) => names.some((n) => h.includes(n)));

/**
 * Turn a bank CSV export into import rows. Detects Date, Payee/Description,
 * Memo, and either a single Amount column or separate Outflow/Inflow columns.
 */
export function csvToRows(text: string): { rows: ImportRow[]; errors: number } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], errors: 0 };
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const iDate = find(headers, 'date');
  const iPayee = find(headers, 'payee', 'description', 'name', 'merchant');
  const iMemo = find(headers, 'memo', 'note');
  const iAmount = find(headers, 'amount');
  const iOut = find(headers, 'outflow', 'debit', 'withdrawal');
  const iIn = find(headers, 'inflow', 'credit', 'deposit');
  if (iDate < 0 || (iAmount < 0 && iOut < 0 && iIn < 0)) return { rows: [], errors: table.length - 1 };

  const rows: ImportRow[] = [];
  let errors = 0;
  for (const r of table.slice(1)) {
    const date = parseDate(r[iDate] ?? '');
    let amount: number | null;
    if (iAmount >= 0) amount = parseMoney(r[iAmount] ?? '');
    else {
      const out = parseMoney(r[iOut] ?? '') ?? 0;
      const inn = parseMoney(r[iIn] ?? '') ?? 0;
      amount = inn - Math.abs(out);
    }
    if (!date || amount === null) {
      errors++;
      continue;
    }
    rows.push({
      date,
      amount,
      payee: (iPayee >= 0 ? r[iPayee] : '')?.trim() ?? '',
      memo: (iMemo >= 0 && iMemo !== iPayee ? r[iMemo] : '')?.trim() ?? '',
    });
  }
  return { rows, errors };
}

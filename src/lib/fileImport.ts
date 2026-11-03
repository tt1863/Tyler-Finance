import { csvToRows } from './csv';
import { parseDate } from './dates';
import { parseMoney } from './money';
import type { ImportRow } from './ops';

/**
 * Bank download files: CSV, OFX/QFX (Quicken/Money web connect) and QIF.
 * OFX and QFX rows carry the bank's own transaction ID (FITID), used to skip
 * transactions already imported.
 */

export type FileKind = 'csv' | 'ofx' | 'qif';

export function detectKind(name: string, text: string): FileKind {
  const n = name.toLowerCase();
  if (n.endsWith('.ofx') || n.endsWith('.qfx') || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return 'ofx';
  if (n.endsWith('.qif') || /^!Type:/im.test(text.slice(0, 200))) return 'qif';
  return 'csv';
}

/** "20261103120000[-5:EST]" -> "2026-11-03" */
function ofxDate(s: string): string | null {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim();

export function parseOfx(text: string): { rows: ImportRow[]; errors: number } {
  const rows: ImportRow[] = [];
  let errors = 0;
  // Works for both SGML (OFX 1.x, unclosed tags) and XML (OFX 2.x).
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const tag = (t: string) => {
      const m = block.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'));
      return m ? decode(m[1]) : '';
    };
    const date = ofxDate(tag('DTPOSTED') || tag('DTUSER'));
    const amount = parseMoney(tag('TRNAMT'));
    if (!date || amount === null) {
      errors++;
      continue;
    }
    const fitid = tag('FITID');
    rows.push({ date, amount, payee: tag('NAME') || tag('PAYEE'), memo: tag('MEMO'), ...(fitid ? { importId: fitid } : {}) });
  }
  return { rows, errors };
}

/** QIF dates: 11/03/2026, 11/3/26, 11/ 3'26, 2026-11-03. */
function qifDate(s: string): string | null {
  const t = s.trim().replace(/'\s*/, '/').replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return parseDate(t);
}

export function parseQif(text: string): { rows: ImportRow[]; errors: number } {
  const rows: ImportRow[] = [];
  let errors = 0;
  let cur: { date?: string; amount?: number | null; payee?: string; memo?: string } = {};
  const flush = () => {
    if (cur.date === undefined && cur.amount === undefined) return;
    const date = cur.date ? qifDate(cur.date) : null;
    if (!date || cur.amount === null || cur.amount === undefined) errors++;
    else rows.push({ date, amount: cur.amount, payee: cur.payee ?? '', memo: cur.memo ?? '' });
    cur = {};
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('!')) continue;
    const code = line[0];
    const value = line.slice(1).trim();
    if (code === '^') flush();
    else if (code === 'D') cur.date = value;
    else if (code === 'T' || (code === 'U' && cur.amount === undefined)) cur.amount = parseMoney(value);
    else if (code === 'P') cur.payee = value;
    else if (code === 'M') cur.memo = value;
  }
  flush();
  return { rows, errors };
}

export function parseBankFile(name: string, text: string): { kind: FileKind; rows: ImportRow[]; errors: number } {
  const kind = detectKind(name, text);
  const r = kind === 'ofx' ? parseOfx(text) : kind === 'qif' ? parseQif(text) : csvToRows(text);
  return { kind, ...r };
}

export interface ImportOptions {
  importMemos: boolean;
  swapPayeeMemo: boolean;
  flip: boolean;
}

export function applyOptions(rows: ImportRow[], o: ImportOptions): ImportRow[] {
  return rows.map((r) => {
    let payee = r.payee;
    let memo = r.memo;
    if (o.swapPayeeMemo && memo) [payee, memo] = [memo, payee];
    return { ...r, payee, memo: o.importMemos ? memo : '', amount: o.flip ? -r.amount : r.amount };
  });
}

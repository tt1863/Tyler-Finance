import { describe, expect, it } from 'vitest';
import { applyOptions, detectKind, parseBankFile, parseOfx, parseQif } from './fileImport';
import { addAccount, emptyData, importTransactions, saveTransaction } from './ops';

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261101120000[-5:EST]
<TRNAMT>-12.34
<FITID>A1
<NAME>COFFEE &amp; CO
<MEMO>Card 1234
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261102
<TRNAMT>1500.00
<FITID>A2
<NAME>PAYROLL
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0"?><?OFX OFXHEADER="200"?>
<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261103</DTPOSTED><TRNAMT>-5.00</TRNAMT><FITID>X9</FITID><NAME>Store</NAME></STMTTRN></BANKTRANLIST></OFX>`;

const QIF = `!Type:Bank
D11/03/2026
T-20.00
PGrocer
MWeekly shop
^
D11/ 4'26
T1,000.00
PJob
^
`;

describe('bank files', () => {
  it('detects file types', () => {
    expect(detectKind('a.qfx', '')).toBe('ofx');
    expect(detectKind('a.txt', '!Type:Bank\n')).toBe('qif');
    expect(detectKind('a.csv', 'Date,Amount')).toBe('csv');
  });

  it('reads OFX 1.x (SGML)', () => {
    const { rows, errors } = parseOfx(SGML);
    expect(errors).toBe(0);
    expect(rows).toEqual([
      { date: '2026-11-01', amount: -1234, payee: 'COFFEE & CO', memo: 'Card 1234', importId: 'A1' },
      { date: '2026-11-02', amount: 150000, payee: 'PAYROLL', memo: '', importId: 'A2' },
    ]);
  });

  it('reads OFX 2.x (XML)', () => {
    expect(parseBankFile('x.ofx', XML).rows).toEqual([{ date: '2026-11-03', amount: -500, payee: 'Store', memo: '', importId: 'X9' }]);
  });

  it('reads QIF', () => {
    const { rows } = parseQif(QIF);
    expect(rows).toEqual([
      { date: '2026-11-03', amount: -2000, payee: 'Grocer', memo: 'Weekly shop' },
      { date: '2026-11-04', amount: 100000, payee: 'Job', memo: '' },
    ]);
  });

  it('skips OFX transactions already imported, even after edits', () => {
    let d = addAccount(emptyData(), { name: 'Checking', type: 'checking', onBudget: true, balance: 0, date: '2026-10-01' });
    const acct = d.accounts[0].id;
    const rows = parseOfx(SGML).rows;
    d = importTransactions(d, acct, rows).data;
    // Rename the payee; the bank id still matches.
    const t = d.transactions.find((x) => x.importId === 'A1')!;
    d = saveTransaction(d, { ...t, payee: 'Coffee Shop', cleared: t.cleared });
    expect(d.transactions.find((x) => x.payee === 'Coffee Shop')!.importId).toBe('A1');
    const again = importTransactions(d, acct, rows);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
  });

  it('applies import options', () => {
    const rows = [{ date: '2026-11-01', amount: 100, payee: 'P', memo: 'M' }];
    expect(applyOptions(rows, { importMemos: false, swapPayeeMemo: false, flip: true })[0]).toMatchObject({ payee: 'P', memo: '', amount: -100 });
    expect(applyOptions(rows, { importMemos: true, swapPayeeMemo: true, flip: false })[0]).toMatchObject({ payee: 'M', memo: 'P' });
  });
});

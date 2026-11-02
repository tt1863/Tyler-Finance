import { describe, expect, it } from 'vitest';
import { appBalance, planImport, startingBalanceFix, type AppTxn, type PlaidTxn, type PlanInput } from './importPlan';

const links = { 'bank-chk': { appAccountId: 'chk', importFrom: '2026-10-01' } };
const p = (id: string, amount: number, date: string, extra: Partial<PlaidTxn> = {}): PlaidTxn => ({
  transaction_id: id,
  account_id: 'bank-chk',
  amount,
  date,
  name: 'COFFEE HOUSE #123',
  merchant_name: 'Coffee House',
  pending: false,
  ...extra,
});
const plan = (over: Partial<PlanInput>) =>
  planImport({ added: [], modified: [], removed: [], links, existing: [], payeeCategory: {}, ...over });

describe('importing bank transactions', () => {
  it('adds new transactions with the right sign, payee and remembered category', () => {
    const r = plan({ added: [p('t1', 4.5, '2026-10-05'), p('t2', -1200, '2026-10-06', { merchant_name: null, name: 'PAYROLL' })], payeeCategory: { 'Coffee House': 'dining' } });
    expect(r.upserts).toEqual([
      expect.objectContaining({ id: 'bank-t1', accountId: 'chk', amount: -450, payee: 'Coffee House', categoryId: 'dining', cleared: 'cleared', bankId: 't1' }),
      expect.objectContaining({ id: 'bank-t2', amount: 120000, payee: 'PAYROLL', categoryId: null }),
    ]);
  });

  it('skips unlinked accounts and anything before the import date', () => {
    const r = plan({ added: [p('old', 5, '2026-09-30'), p('other', 5, '2026-10-05', { account_id: 'bank-x' })] });
    expect(r.upserts).toHaveLength(0);
  });

  it('a pending charge that posts keeps its category and memo', () => {
    const pending: AppTxn = { id: 'bank-p1', accountId: 'chk', date: '2026-10-05', payee: 'Coffee House', categoryId: 'dining', memo: 'with Sam', amount: -450, cleared: 'uncleared', bankId: 'p1' };
    const r = plan({ existing: [pending], added: [p('t1', 5.25, '2026-10-06', { pending_transaction_id: 'p1' })], removed: [{ transaction_id: 'p1' }] });
    expect(r.deletes).toEqual([]);
    expect(r.upserts).toEqual([{ ...pending, bankId: 't1', amount: -525, date: '2026-10-06', cleared: 'cleared' }]);
  });

  it('matches a transaction entered by hand instead of duplicating it', () => {
    const manual: AppTxn = { id: 'm1', accountId: 'chk', date: '2026-10-03', payee: 'Coffee', categoryId: 'dining', memo: '', amount: -450, cleared: 'uncleared' };
    const r = plan({ existing: [manual], added: [p('t1', 4.5, '2026-10-05')] });
    expect(r.upserts).toEqual([{ ...manual, bankId: 't1', cleared: 'cleared' }]);
  });

  it('does not match when the amount differs or dates are far apart', () => {
    const manual: AppTxn = { id: 'm1', accountId: 'chk', date: '2026-10-01', payee: 'Coffee', categoryId: null, memo: '', amount: -450, cleared: 'uncleared' };
    const r = plan({ existing: [manual], added: [p('t1', 4.5, '2026-10-09'), p('t2', 4.75, '2026-10-02')] });
    expect(r.upserts.map((t) => t.id)).toEqual(['bank-t1', 'bank-t2']);
  });

  it('importing the same thing twice changes nothing', () => {
    const first = plan({ added: [p('t1', 4.5, '2026-10-05')] });
    const again = plan({ existing: first.upserts, added: [p('t1', 4.5, '2026-10-05')] });
    expect(again.upserts).toEqual([]);
  });

  it('bank edits update the amount but keep the category; reconciled stays reconciled', () => {
    const t: AppTxn = { id: 'bank-t1', accountId: 'chk', date: '2026-10-05', payee: 'Coffee House', categoryId: 'dining', memo: '', amount: -450, cleared: 'reconciled', bankId: 't1' };
    const r = plan({ existing: [t], modified: [p('t1', 5, '2026-10-05')] });
    expect(r.upserts).toEqual([{ ...t, amount: -500 }]);
  });

  it('removed by the bank: imported ones are deleted, hand-entered ones are kept', () => {
    const imported: AppTxn = { id: 'bank-t1', accountId: 'chk', date: '2026-10-05', payee: 'X', categoryId: null, memo: '', amount: -100, cleared: 'uncleared', bankId: 't1' };
    const manual: AppTxn = { id: 'm1', accountId: 'chk', date: '2026-10-05', payee: 'Y', categoryId: null, memo: '', amount: -200, cleared: 'cleared', bankId: 't2' };
    const r = plan({ existing: [imported, manual], removed: [{ transaction_id: 't1' }, { transaction_id: 't2' }] });
    expect(r.deletes).toEqual(['bank-t1']);
    expect(r.upserts).toEqual([{ ...manual, bankId: undefined }].map(({ bankId: _b, ...rest }) => rest));
  });
});

describe('user edits', () => {
  it('a transaction the user deleted is not imported again', () => {
    const r = plan({ added: [p('t1', 4.5, '2026-10-05'), p('t2', 3, '2026-10-06', { pending_transaction_id: 'p9' })], deletedBankIds: new Set(['t1', 'p9']) });
    expect(r.upserts).toEqual([]);
  });
});

describe('transfers', () => {
  it('when the bank removes one side of a linked transfer, the other side is unlinked', () => {
    const out: AppTxn = { id: 'bank-t1', accountId: 'chk', date: '2026-10-05', payee: 'Transfer : Savings', categoryId: null, memo: 'ONLINE TRANSFER', amount: -500, cleared: 'uncleared', bankId: 't1', transferAccountId: 'sav', transferTxId: 'bank-t2' };
    const into: AppTxn = { id: 'bank-t2', accountId: 'sav', date: '2026-10-05', payee: 'Transfer : Checking', categoryId: null, memo: 'FROM CHK', amount: 500, cleared: 'cleared', bankId: 't2', transferAccountId: 'chk', transferTxId: 'bank-t1' };
    const r = plan({ existing: [out, into], removed: [{ transaction_id: 't1' }] });
    expect(r.deletes).toEqual(['bank-t1']);
    expect(r.upserts).toEqual([{ id: 'bank-t2', accountId: 'sav', date: '2026-10-05', payee: 'FROM CHK', categoryId: null, memo: 'FROM CHK', amount: 500, cleared: 'cleared', bankId: 't2' }]);
  });
});

describe('balances', () => {
  it('debts are negative in the app', () => {
    expect(appBalance(250.5, 'credit')).toBe(-25050);
    expect(appBalance(1000, 'depository')).toBe(100000);
  });

  it('sets the starting balance so the account matches the bank', () => {
    const start: AppTxn = { id: 's', accountId: 'chk', date: '2026-10-01', payee: 'Starting Balance', categoryId: 'rta', memo: '', amount: 0, cleared: 'cleared' };
    const imported: AppTxn[] = [
      { id: 'bank-a', accountId: 'chk', date: '2026-10-02', payee: 'A', categoryId: null, memo: '', amount: -3000, cleared: 'cleared', bankId: 'a' },
      { id: 'bank-b', accountId: 'chk', date: '2026-10-03', payee: 'B', categoryId: null, memo: '', amount: 10000, cleared: 'cleared', bankId: 'b' },
    ];
    const fix = startingBalanceFix([start, ...imported], 'chk', 50000);
    expect(fix?.amount).toBe(43000);
    expect(startingBalanceFix([{ ...start, amount: 43000 }, ...imported], 'chk', 50000)).toBeNull();
  });
});

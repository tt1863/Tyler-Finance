import { describe, expect, it } from 'vitest';
import zipBase64 from './__fixtures__/ynab-export.zip.b64?raw';
import plan from './__fixtures__/ynab-plan.csv?raw';
import register from './__fixtures__/ynab-register.csv?raw';
import { accountBalances, computeBudget } from './budget';
import { unzipText } from './unzip';
import { buildFromYnab, guessAccounts, parsePlan, parseRegister, pickFiles } from './ynabImport';


function load() {
  const rows = parseRegister(register).rows;
  const planRows = parsePlan(plan);
  const accounts = guessAccounts(rows, planRows);
  return { rows, planRows, accounts, ...buildFromYnab(rows, planRows, accounts, null) };
}

describe('YNAB import', () => {
  it('reads the zip export and finds both files', async () => {
    const bytes = Uint8Array.from(atob(zipBase64.trim()), (c) => c.charCodeAt(0));
    const files = await unzipText(bytes.buffer);
    const picked = pickFiles(files);
    expect(picked.register).toBe(register);
    expect(picked.plan).toBe(plan);
  });

  it('guesses account types', () => {
    const { accounts } = load();
    expect(accounts.map((a) => [a.name, a.type, a.onBudget])).toEqual([
      ['Checking', 'checking', true],
      ['Savings', 'savings', true],
      ['Visa', 'credit', true],
      ['Car Loan', 'loan', false],
    ]);
  });

  it('balances match YNAB', () => {
    const { data } = load();
    const bal = accountBalances(data);
    const by = (n: string) => bal[data.accounts.find((a) => a.name === n)!.id].working;
    expect([by('Checking'), by('Savings'), by('Visa'), by('Car Loan')]).toEqual([215000, 550000, -12500, -965000]);
  });

  it('rebuilds splits, transfers, flags and cleared status', () => {
    const { data, summary } = load();
    const target = data.transactions.find((t) => t.payee === 'Target')!;
    expect(target.amount).toBe(-10000);
    expect(target.splits!.map((s) => [s.amount, s.memo])).toEqual([[-6000, 'Food'], [-4000, 'Game']]);
    const toSav = data.transactions.find((t) => t.payee === 'Transfer : Savings')!;
    expect(toSav.transferTxId).toBeDefined();
    expect(data.transactions.find((t) => t.id === toSav.transferTxId)!.amount).toBe(50000);
    expect(toSav.categoryId).toBeNull();
    // Budget side of a transfer to a tracking account keeps its category.
    const car = data.transactions.find((t) => t.payee === 'Transfer : Car Loan')!;
    expect(data.categories.find((c) => c.id === car.categoryId)!.name).toBe('Car Payment');
    expect(data.transactions.find((t) => t.payee === 'Pharmacy')!.flag).toBe('blue');
    expect(data.transactions.filter((t) => t.cleared === 'reconciled')).toHaveLength(4);
    expect(summary).toMatchObject({ accounts: 4, transactions: 14, months: 2, unmatchedTransfers: 0, from: '2026-09-01', to: '2026-09-30' });
  });

  it("category amounts match YNAB's Plan", () => {
    const { data } = load();
    const months = computeBudget(data, '2026-10');
    const avail = (m: string, name: string) => months.get(m)!.categories[data.categories.find((c) => c.name === name)!.id].available;
    expect(avail('2026-09', 'Groceries')).toBe(34000);
    expect(avail('2026-09', 'Rent')).toBe(0);
    expect(avail('2026-09', 'Medical')).toBe(2500);
    expect(avail('2026-09', 'Visa')).toBe(12500);
    expect(avail('2026-10', 'Groceries')).toBe(74000);
    expect(avail('2026-10', 'Rent')).toBe(120000);
  });

  it('adding to an existing budget reuses accounts and categories by name', () => {
    const first = load().data;
    const { rows, planRows, accounts } = load();
    const again = buildFromYnab(rows, planRows, accounts, first).data;
    expect(again.accounts).toHaveLength(4);
    expect(again.categories.length).toBe(first.categories.length);
  });
});

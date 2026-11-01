import { addMonths, currentMonth, today as todayStr } from './dates';
import { addAccount, saveTransaction, setAssigned, starterData, updateCategory } from './ops';
import { saveScheduled } from './scheduled';
import type { BudgetData } from './types';
import { READY_TO_ASSIGN } from './types';

/** Three months of realistic sample data to explore the app with. */
export function demoData(): BudgetData {
  const now = currentMonth();
  const start = addMonths(now, -2);
  let d = starterData();
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 245000, date: `${start}-01` });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 500000, date: `${start}-01` });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: -42000, date: `${start}-01` });
  d = addAccount(d, { name: 'Car Loan', type: 'loan', onBudget: false, balance: -1180000, date: `${start}-01` });
  d = addAccount(d, { name: 'Retirement', type: 'asset', onBudget: false, balance: 3250000, date: `${start}-01` });

  const acct = (name: string) => d.accounts.find((a) => a.name === name)!.id;
  const cat = (name: string) => d.categories.find((c) => c.name === name)!.id;
  const checking = acct('Checking');
  const visa = acct('Visa');
  const savings = acct('Savings');
  const today = new Date();
  const todayDay = today.getDate();

  const tx = (month: string, day: number, account: string, payee: string, category: string | null, amount: number, transferTo?: string) => {
    if (month === now && day > todayDay) return;
    d = saveTransaction(d, {
      accountId: account,
      date: `${month}-${String(day).padStart(2, '0')}`,
      payee,
      categoryId: category,
      memo: '',
      amount,
      cleared: month === now && day > todayDay - 3 ? 'uncleared' : 'cleared',
      transferAccountId: transferTo,
    });
  };

  const plan: Record<string, number> = {
    'Rent/Mortgage': 145000,
    Electric: 9000,
    Water: 4500,
    Internet: 6500,
    Phone: 5500,
    Insurance: 12000,
    Groceries: 60000,
    Transportation: 18000,
    Medical: 5000,
    'Dining Out': 20000,
    Entertainment: 8000,
    Shopping: 10000,
    Vacation: 15000,
    'Emergency Fund': 25000,
    'Car Replacement': 10000,
  };

  for (let i = 0; i < 3; i++) {
    const m = addMonths(start, i);
    for (const [name, amt] of Object.entries(plan)) d = setAssigned(d, m, cat(name), amt);
    tx(m, 1, checking, 'Acme Corp Payroll', READY_TO_ASSIGN, 215000);
    tx(m, 15, checking, 'Acme Corp Payroll', READY_TO_ASSIGN, 215000);
    tx(m, 1, checking, 'Oakwood Apartments', cat('Rent/Mortgage'), -145000);
    tx(m, 5, checking, 'City Power', cat('Electric'), -(7800 + i * 900));
    tx(m, 6, checking, 'City Water', cat('Water'), -4210);
    tx(m, 8, checking, 'FiberNet', cat('Internet'), -6500);
    tx(m, 9, visa, 'Mobile Co', cat('Phone'), -5500);
    tx(m, 12, checking, 'Safe Auto Insurance', cat('Insurance'), -12000);
    tx(m, 3, visa, 'FreshMart', cat('Groceries'), -(13250 + i * 410));
    tx(m, 10, visa, 'FreshMart', cat('Groceries'), -11890);
    tx(m, 17, visa, 'Corner Market', cat('Groceries'), -4520);
    tx(m, 24, visa, 'FreshMart', cat('Groceries'), -15630);
    tx(m, 4, visa, 'Shell', cat('Transportation'), -4800);
    tx(m, 19, visa, 'Shell', cat('Transportation'), -5150);
    tx(m, 7, visa, 'Taco Town', cat('Dining Out'), -2875);
    tx(m, 14, visa, 'Bella Pizza', cat('Dining Out'), -4210 - i * 1500);
    tx(m, 22, visa, 'Coffee House', cat('Dining Out'), -1260);
    tx(m, 11, visa, 'StreamFlix', cat('Entertainment'), -1599);
    tx(m, 20, visa, 'Cinema 8', cat('Entertainment'), -3400);
    tx(m, 16, visa, 'Online Store', cat('Shopping'), -6799);
    tx(m, 2, checking, 'Transfer', null, -25000, savings);
    tx(m, 25, checking, 'Transfer', null, -60000, visa);
    tx(m, 18, checking, 'Pharmacy', cat('Medical'), -2400);
    if (!(m === now && 13 > todayDay)) {
      d = saveTransaction(d, {
        accountId: visa,
        date: `${m}-13`,
        payee: 'Target',
        categoryId: null,
        memo: '',
        amount: -8650,
        cleared: 'cleared',
        splits: [
          { categoryId: cat('Groceries'), amount: -5420, memo: 'Snacks & produce' },
          { categoryId: cat('Shopping'), amount: -3230, memo: 'Towels' },
        ],
      });
    }
  }

  d = updateCategory(d, cat('Groceries'), { target: { type: 'refill', amount: 60000 } });
  d = updateCategory(d, cat('Emergency Fund'), { target: { type: 'balance', amount: 1000000 } });
  d = updateCategory(d, cat('Vacation'), { target: { type: 'byDate', amount: 200000, month: addMonths(now, 8) } });
  d = updateCategory(d, cat('Rent/Mortgage'), { target: { type: 'monthly', amount: 145000 } });
  d = updateCategory(d, cat('Car Replacement'), { target: { type: 'monthly', amount: 15000 } });
  const visaPay = d.categories.find((c) => c.ccAccountId === visa)!.id;
  // Fund the card payment so it matches what's owed, and move savings into the emergency fund.
  for (let i = 0; i < 3; i++) d = setAssigned(d, addMonths(start, i), visaPay, i === 0 ? 12000 : 15000);
  d = setAssigned(d, start, cat('Emergency Fund'), 525000);

  // Recurring bills and income, starting from their next date.
  const next = (day: number) => {
    const thisMonth = `${now}-${String(day).padStart(2, '0')}`;
    return thisMonth > todayStr() ? thisMonth : `${addMonths(now, 1)}-${String(day).padStart(2, '0')}`;
  };
  const schedule = (payee: string, category: string | null, amount: number, day: number, account = checking, transferAccountId?: string) => {
    d = saveScheduled(d, { accountId: account, payee, categoryId: category, memo: '', amount, frequency: 'monthly', startDate: next(day), transferAccountId });
  };
  schedule('Acme Corp Payroll', READY_TO_ASSIGN, 215000, 15);
  schedule('Acme Corp Payroll', READY_TO_ASSIGN, 215000, 1);
  schedule('Oakwood Apartments', cat('Rent/Mortgage'), -145000, 1);
  schedule('FiberNet', cat('Internet'), -6500, 8);
  schedule('StreamFlix', cat('Entertainment'), -1599, 11, visa);
  schedule('Transfer : Savings', null, -25000, 2, checking, savings);
  return d;
}

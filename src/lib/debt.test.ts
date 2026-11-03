import { describe, expect, it } from 'vitest';
import { monthlyInterest, planPayoff, type DebtInput } from './debt';

const card: DebtInput = { id: 'card', name: 'Card', balance: 500000, apr: 24, minPayment: 15000 };
const car: DebtInput = { id: 'car', name: 'Car', balance: 300000, apr: 6, minPayment: 20000 };

describe('debt payoff', () => {
  it('a single debt at 0% is just balance / payment', () => {
    const r = planPayoff([{ id: 'x', name: 'X', balance: 100000, apr: 0, minPayment: 10000 }], 0, 'avalanche');
    expect(r.months).toBe(10);
    expect(r.totalInterest).toBe(0);
    expect(r.balances).toHaveLength(11);
  });

  it('matches the standard amortization for one loan', () => {
    // $10,000 at 12% paying $500/month takes 23 payments (22.4 months).
    const r = planPayoff([{ id: 'x', name: 'X', balance: 1000000, apr: 12, minPayment: 50000 }], 0, 'avalanche');
    expect(r.months).toBe(23);
    expect(r.totalInterest).toBeGreaterThan(115000);
    expect(r.totalInterest).toBeLessThan(125000);
  });

  it('extra payments finish sooner with less interest', () => {
    const base = planPayoff([card, car], 0, 'avalanche');
    const extra = planPayoff([card, car], 20000, 'avalanche');
    expect(extra.months!).toBeLessThan(base.months!);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  it('avalanche pays the high-interest card first; snowball the smaller balance', () => {
    const av = planPayoff([card, car], 30000, 'avalanche');
    const sn = planPayoff([card, car], 30000, 'snowball');
    const at = (r: typeof av, id: string) => r.debts.find((d) => d.id === id)!.months!;
    expect(at(av, 'card')).toBeLessThan(at(sn, 'card'));
    expect(at(sn, 'car')).toBeLessThan(at(av, 'car'));
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
  });

  it('payments below the interest never pay off', () => {
    const bad = { ...card, minPayment: monthlyInterest(card) - 100 };
    const r = planPayoff([bad], 0, 'avalanche');
    expect(r.months).toBeNull();
    expect(r.debts[0].months).toBeNull();
  });
});

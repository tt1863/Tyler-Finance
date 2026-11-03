import { useMemo, useState } from 'react';
import { LineChart } from '../components/Charts';
import MoneyInput from '../components/MoneyInput';
import { accountBalances } from '../lib/budget';
import { addMonths, currentMonth, monthLabel } from '../lib/dates';
import { monthlyInterest, planPayoff, type DebtInput, type Strategy } from '../lib/debt';
import { fmt, parseMoney } from '../lib/money';
import { isDebtType, updateAccount } from '../lib/ops';
import { STORAGE_KEY } from '../lib/preview';
import { useData, useStore } from '../lib/store';

const PREFS = `${STORAGE_KEY}-debt-plan`;

function loadPrefs(): { extra: number; strategy: Strategy } {
  try {
    return { extra: 0, strategy: 'avalanche', ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') };
  } catch {
    return { extra: 0, strategy: 'avalanche' };
  }
}

const monthsLabel = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, m && `${m} mo`].filter(Boolean).join(' ') || '0 mo';
};

export default function DebtPage() {
  const data = useData();
  const update = useStore((s) => s.update);
  const balances = useMemo(() => accountBalances(data), [data]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const savePrefs = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      // Not important enough to fail over.
    }
  };

  const debtAccounts = data.accounts.filter((a) => !a.closed && isDebtType(a.type) && balances[a.id].working < 0);
  const ready: DebtInput[] = debtAccounts
    .filter((a) => a.debt && a.debt.minPayment > 0)
    .map((a) => ({ id: a.id, name: a.name, balance: -balances[a.id].working, apr: a.debt!.apr, minPayment: a.debt!.minPayment }));
  const missing = debtAccounts.length - ready.length;

  const plan = useMemo(() => planPayoff(ready, prefs.extra, prefs.strategy), [JSON.stringify(ready), prefs]);
  const base = useMemo(() => planPayoff(ready, 0, prefs.strategy), [JSON.stringify(ready), prefs.strategy]);
  const now = currentMonth();
  const when = (months: number | null) => (months === null ? 'Never at this payment' : monthLabel(addMonths(now, months), true));

  const setDebt = (id: string, patch: Partial<{ apr: number; minPayment: number }>) =>
    update((d) => {
      const acct = d.accounts.find((a) => a.id === id)!;
      return updateAccount(d, id, { debt: { apr: 0, minPayment: 0, ...acct.debt, ...patch } });
    });

  if (!debtAccounts.length) {
    return (
      <div className="debt-page">
        <h1>Debt Payoff</h1>
        <p className="empty">No credit cards or loans with a balance. Add one under "+ Add Account" to plan paying it off.</p>
      </div>
    );
  }

  const monthsSaved = plan.months !== null && base.months !== null ? base.months - plan.months : null;
  const interestSaved = base.totalInterest - plan.totalInterest;

  return (
    <div className="debt-page">
      <h1>Debt Payoff</h1>

      {ready.length > 0 && (
        <div className="card">
          <div className="tiles">
            <div className="tile">
              <span className="label">Debt-free</span>
              <span className="hero-number">{when(plan.months)}</span>
              {plan.months !== null && <span className="muted small">in {monthsLabel(plan.months)}</span>}
            </div>
            <div className="tile">
              <span className="label">Total owed</span>
              <span className="tile-number">{fmt(ready.reduce((s, d) => s + d.balance, 0))}</span>
            </div>
            <div className="tile">
              <span className="label">Interest you'll pay</span>
              <span className="tile-number">{fmt(plan.totalInterest)}</span>
            </div>
          </div>
          {prefs.extra > 0 && monthsSaved !== null && (
            <p className="good">
              Paying {fmt(prefs.extra)} extra each month gets you there <b>{monthsLabel(monthsSaved)} sooner</b> and saves{' '}
              <b>{fmt(interestSaved)}</b> in interest.
            </p>
          )}
          {plan.months === null && <p className="error">Some payments don't cover the interest, so that debt would never be paid off. Raise the payment or the extra amount.</p>}

          <div className="debt-controls">
            <label>
              Extra each month
              <input
                inputMode="decimal"
                defaultValue={prefs.extra ? (prefs.extra / 100).toFixed(2) : ''}
                placeholder="0.00"
                onBlur={(e) => savePrefs({ extra: Math.max(0, parseMoney(e.target.value) ?? 0) })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <div>
              <span className="label">Pay off first</span>
              <div className="segmented">
                <button className={prefs.strategy === 'avalanche' ? 'active' : ''} onClick={() => savePrefs({ strategy: 'avalanche' })}>
                  Highest interest
                </button>
                <button className={prefs.strategy === 'snowball' ? 'active' : ''} onClick={() => savePrefs({ strategy: 'snowball' })}>
                  Smallest balance
                </button>
              </div>
            </div>
          </div>
          <p className="hint">
            {prefs.strategy === 'avalanche'
              ? 'Avalanche: extra money goes to the highest interest rate first. This saves the most interest.'
              : 'Snowball: extra money goes to the smallest balance first. Quick wins keep you motivated.'}
          </p>

          {plan.balances.length > 1 && (
            <LineChart
              name="Total owed"
              color="var(--series-1)"
              labels={plan.balances.map((_, i) => monthLabel(addMonths(now, i), true))}
              values={plan.balances}
            />
          )}
        </div>
      )}

      <div className="card">
        <h3>Your debts</h3>
        {missing > 0 && <p className="hint">Add the interest rate and minimum payment for each debt to include it in the plan.</p>}
        <div className="debt-list">
          {debtAccounts.map((a) => {
            const owed = -balances[a.id].working;
            const result = plan.debts.find((r) => r.id === a.id);
            const input = ready.find((d) => d.id === a.id);
            const tooLow = input && input.minPayment <= monthlyInterest(input);
            return (
              <div key={a.id} className="debt-row">
                <div className="debt-head">
                  <b className="truncate">{a.name}</b>
                  <span className="neg">{fmt(owed)}</span>
                </div>
                <div className="debt-fields">
                  <label>
                    Interest rate (APR %)
                    <input
                      inputMode="decimal"
                      defaultValue={a.debt?.apr ?? ''}
                      placeholder="e.g. 24.99"
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v) && v >= 0 && v !== a.debt?.apr) setDebt(a.id, { apr: v });
                      }}
                    />
                  </label>
                  <label>
                    Minimum payment
                    <MoneyInput className="debt-money" value={a.debt?.minPayment ?? 0} ariaLabel={`Minimum payment for ${a.name}`} onCommit={(v) => setDebt(a.id, { minPayment: Math.max(0, v) })} />
                  </label>
                </div>
                {result && (
                  <p className="muted small">
                    Paid off <b>{when(result.months)}</b> · {fmt(result.interest)} interest
                  </p>
                )}
                {tooLow && <p className="error small">This payment doesn't cover the {fmt(monthlyInterest(input))} monthly interest.</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

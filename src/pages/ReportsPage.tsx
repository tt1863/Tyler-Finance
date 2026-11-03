import { useMemo, useState } from 'react';
import { GroupedBarChart, LineChart } from '../components/Charts';
import { accountBalances, computeActivity, netWorthByMonth } from '../lib/budget';
import { addMonths, currentMonth, dateLabel, monthLabel, monthOf, monthRange } from '../lib/dates';
import { fmt } from '../lib/money';
import { spendingTrend, type ReportScope } from '../lib/reports';
import { useData } from '../lib/store';
import { READY_TO_ASSIGN } from '../lib/types';

const RANGES = [
  { value: 0, label: 'This month' },
  { value: 2, label: 'Last 3 months' },
  { value: 5, label: 'Last 6 months' },
  { value: 11, label: 'Last 12 months' },
];

// Validated categorical palette (slot 1 blue, slot 2 orange).
const BLUE = 'var(--series-1)';
const ORANGE = 'var(--series-2)';

type Tab = 'spending' | 'trends' | 'income' | 'networth';

const TREND_RANGES = [3, 6, 12];

function scopeKey(s: ReportScope) {
  return s.kind === 'all' ? 'all' : `${s.kind}:${s.id}`;
}
function parseScope(v: string): ReportScope {
  const [kind, id] = v.split(':');
  return kind === 'group' || kind === 'category' ? { kind, id } : { kind: 'all' };
}

export default function ReportsPage() {
  const data = useData();
  const [tab, setTab] = useState<Tab>('spending');
  const [range, setRange] = useState(2);
  const [byGroup, setByGroup] = useState(false);
  const [trendRange, setTrendRange] = useState(6);
  const [scope, setScope] = useState<ReportScope>({ kind: 'all' });
  const [trendMonth, setTrendMonth] = useState<string | null>(null);
  const to = currentMonth();
  const from = addMonths(to, -range);
  const months = monthRange(from, to);
  // Charts over time show the last 12 months, starting no earlier than your data.
  const firstMonth = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), to).slice(0, 7);
  const chartFrom = [addMonths(to, -11), firstMonth].sort()[1];
  const chartMonths = monthRange(chartFrom, to);

  const { activity, income } = useMemo(() => computeActivity(data), [data]);

  const spending = useMemo(() => {
    const payment = new Set(data.categories.filter((c) => c.ccAccountId).map((c) => c.id));
    const totals = new Map<string, number>();
    for (const m of months) {
      for (const [catId, amt] of Object.entries(activity[m] ?? {})) {
        if (payment.has(catId)) continue;
        const cat = data.categories.find((c) => c.id === catId);
        const key = byGroup ? (cat?.groupId ?? 'other') : catId;
        totals.set(key, (totals.get(key) ?? 0) - amt);
      }
    }
    const name = (key: string) =>
      byGroup
        ? (data.groups.find((g) => g.id === key)?.name ?? 'Other')
        : (data.categories.find((c) => c.id === key)?.name ?? 'Deleted category');
    const list = [...totals.entries()].filter(([, v]) => v > 0).map(([k, v]) => ({ key: k, name: name(k), value: v }));
    list.sort((a, b) => b.value - a.value);
    return list;
  }, [data, activity, months.join(), byGroup]);
  const totalSpent = spending.reduce((s, x) => s + x.value, 0);
  const maxSpent = spending[0]?.value ?? 1;

  const incomeVsSpending = useMemo(() => {
    const payment = new Set(data.categories.filter((c) => c.ccAccountId).map((c) => c.id));
    return chartMonths.map((m) => {
      let spent = 0;
      for (const [catId, amt] of Object.entries(activity[m] ?? {})) if (!payment.has(catId)) spent -= amt;
      // Exclude starting balances from income — they're not earnings.
      const startBal = data.transactions
        .filter((t) => t.payee === 'Starting Balance' && t.categoryId === READY_TO_ASSIGN && monthOf(t.date) === m)
        .reduce((s, t) => s + t.amount, 0);
      return { month: m, income: (income[m] ?? 0) - startBal, spent };
    });
  }, [data, activity, income, chartMonths.join()]);

  const trendMonths = monthRange(addMonths(to, -(trendRange - 1)), to);
  const trend = useMemo(() => spendingTrend(data, trendMonths, scope), [data, trendMonths.join(), scope]);
  const shownMonth = trendMonth && trendMonths.includes(trendMonth) ? trendMonth : null;
  const monthLines = shownMonth ? trend.lines.filter((l) => l.month === shownMonth) : [];
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Deleted category';
  const budgetGroups = data.groups.filter((g) => !g.system && data.categories.some((c) => c.groupId === g.id && !c.ccAccountId));

  const netWorth = useMemo(() => netWorthByMonth(data, chartFrom, to), [data, chartFrom, to]);
  const balances = useMemo(() => accountBalances(data), [data]);
  let assets = 0;
  let debts = 0;
  for (const a of data.accounts) {
    const b = balances[a.id].working;
    if (b >= 0) assets += b;
    else debts += b;
  }

  return (
    <div className="reports-page">
      <h1>Reports</h1>
      <div className="toolbar">
        <div className="segmented">
          {(
            [
              ['spending', 'Spending'],
              ['trends', 'Trends'],
              ['income', 'Income'],
              ['networth', 'Net Worth'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'spending' && (
          <>
            <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="checkbox inline small">
              <input type="checkbox" checked={byGroup} onChange={(e) => setByGroup(e.target.checked)} /> By group
            </label>
          </>
        )}
      </div>

      {tab === 'spending' && (
        <div className="card">
          <div className="hero">
            <span className="label">
              Total spending · {range === 0 ? monthLabel(to) : `${monthLabel(from, true)} – ${monthLabel(to, true)}`}
            </span>
            <span className="hero-number">{fmt(totalSpent)}</span>
            {range > 0 && <span className="muted small">Average {fmt(Math.round(totalSpent / months.length))} / month</span>}
          </div>
          <div className="hbars">
            {spending.map((s) => (
              <div key={s.key} className="hbar-row" title={`${s.name}: ${fmt(s.value)}`}>
                <span className="hbar-label truncate">{s.name}</span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(s.value / maxSpent) * 100}%` }} />
                </span>
                <span className="hbar-value">{fmt(s.value)}</span>
                <span className="hbar-pct muted">{totalSpent ? Math.round((s.value / totalSpent) * 100) : 0}%</span>
              </div>
            ))}
            {spending.length === 0 && <p className="empty">No spending in this period.</p>}
          </div>
        </div>
      )}

      {tab === 'trends' && (
        <div className="card">
          <div className="toolbar tight">
            <select value={trendRange} onChange={(e) => setTrendRange(Number(e.target.value))} aria-label="Range">
              {TREND_RANGES.map((n) => (
                <option key={n} value={n}>
                  Last {n} months
                </option>
              ))}
            </select>
            <select value={scopeKey(scope)} onChange={(e) => setScope(parseScope(e.target.value))} aria-label="Categories">
              <option value="all">All categories</option>
              {budgetGroups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  <option value={`group:${g.id}`}>All {g.name}</option>
                  {data.categories
                    .filter((c) => c.groupId === g.id && !c.ccAccountId)
                    .map((c) => (
                      <option key={c.id} value={`category:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="tiles trend-tiles">
            <div className="tile">
              <span className="label">Average / month</span>
              <span className="hero-number">{fmt(trend.average)}</span>
            </div>
            <div className="tile">
              <span className="label">Total</span>
              <span className="tile-number">{fmt(trend.total)}</span>
            </div>
          </div>
          <GroupedBarChart
            labels={trendMonths.map((m) => monthLabel(m, true).split(' ')[0])}
            series={[{ name: 'Spending', color: BLUE, values: trend.values }]}
            selected={shownMonth ? trendMonths.indexOf(shownMonth) : null}
            onSelect={(i) => setTrendMonth(trendMonths[i])}
          />
          {shownMonth ? (
            <div className="trend-month">
              <h3>
                {monthLabel(shownMonth)} · {fmt(trend.values[trendMonths.indexOf(shownMonth)])}
              </h3>
              {monthLines.length === 0 && <p className="empty">No spending this month.</p>}
              <ul className="report-lines">
                {monthLines.map((l, i) => (
                  <li key={`${l.txId}-${i}`}>
                    <a href={`#/accounts/${l.accountId}`} className="report-line">
                      <span className="rl-main">
                        <span className="truncate">{l.payee || '(no payee)'}</span>
                        <small className="muted truncate">
                          {dateLabel(l.date)} · {catName(l.categoryId)}
                        </small>
                      </span>
                      <span className={l.spent < 0 ? 'pos' : ''}>{fmt(l.spent)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="hint">Tap a month to see its transactions.</p>
          )}
        </div>
      )}

      {tab === 'income' && (
        <div className="card">
          <GroupedBarChart
            labels={incomeVsSpending.map((x) => monthLabel(x.month, true).split(' ')[0])}
            series={[
              { name: 'Income', color: BLUE, values: incomeVsSpending.map((x) => x.income) },
              { name: 'Spending', color: ORANGE, values: incomeVsSpending.map((x) => x.spent) },
            ]}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Income</th>
                <th className="num">Spending</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...incomeVsSpending].reverse().map((x) => (
                <tr key={x.month}>
                  <td>{monthLabel(x.month, true)}</td>
                  <td className="num">{fmt(x.income)}</td>
                  <td className="num">{fmt(x.spent)}</td>
                  <td className={`num ${x.income - x.spent < 0 ? 'neg' : 'pos'}`}>{fmt(x.income - x.spent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'networth' && (
        <div className="card">
          <div className="tiles">
            <div className="tile">
              <span className="label">Net worth</span>
              <span className="hero-number">{fmt(assets + debts)}</span>
            </div>
            <div className="tile">
              <span className="label">Assets</span>
              <span className="tile-number">{fmt(assets)}</span>
            </div>
            <div className="tile">
              <span className="label">Debts</span>
              <span className="tile-number">{fmt(debts)}</span>
            </div>
          </div>
          <LineChart
            name="Net worth"
            color={BLUE}
            labels={netWorth.map((x) => monthLabel(x.month, true))}
            values={netWorth.map((x) => x.value)}
          />
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { GroupedBarChart, LineChart } from '../components/Charts';
import { OUTFLOWS_NEEDED, ageOfMoney, agedOutflows } from '../lib/ageOfMoney';
import { accountBalances, computeActivity, netWorthByMonth } from '../lib/budget';
import { addMonths, currentMonth, dateLabel, monthLabel, monthOf, monthRange, today } from '../lib/dates';
import { fmt } from '../lib/money';
import { csvMoney, download, toCsv } from '../lib/download';
import { linesTable, spendingBreakdown, spendingTrend, type ReportScope, type SpendingLine } from '../lib/reports';
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

type Tab = 'spending' | 'trends' | 'income' | 'networth' | 'age';
const TABS: Tab[] = ['spending', 'trends', 'income', 'networth', 'age'];
const AGE_RANGES = [
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
];

const TREND_RANGES = [3, 6, 12];

function scopeKey(s: ReportScope) {
  return s.kind === 'all' ? 'all' : `${s.kind}:${s.id}`;
}
function parseScope(v: string): ReportScope {
  const [kind, id] = v.split(':');
  return kind === 'group' || kind === 'category' ? { kind, id } : { kind: 'all' };
}

export default function ReportsPage({ initialTab }: { initialTab?: string }) {
  const data = useData();
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'spending');
  const [ageRange, setAgeRange] = useState(12);
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

  const spending = useMemo(() => spendingBreakdown(data, months, byGroup), [data, months.join(), byGroup]);
  const [openRow, setOpenRow] = useState<string | null>(null);
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

  const outflows = useMemo(() => agedOutflows(data), [data]);
  const ageNow = ageOfMoney(outflows);
  const ageHistory = useMemo(() => {
    const ms = monthRange(addMonths(to, -(ageRange - 1)), to);
    // Each month's value is the Age of Money on its last day (today for this month).
    return ms
      .map((m) => ({ month: m, value: ageOfMoney(outflows, `${m}-31`) }))
      .filter((x): x is { month: string; value: number } => x.value !== null);
  }, [outflows, ageRange, to]);

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
              ['age', 'Age of Money'],
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
              <div key={s.key}>
                <button
                  className={`hbar-row tappable ${openRow === s.key ? 'open' : ''}`}
                  aria-expanded={openRow === s.key}
                  onClick={() => setOpenRow(openRow === s.key ? null : s.key)}
                >
                  <span className="hbar-label truncate">{s.name}</span>
                  <span className="hbar-track">
                    <span className="hbar-fill" style={{ width: `${(s.value / maxSpent) * 100}%` }} />
                  </span>
                  <span className="hbar-value">{fmt(s.value)}</span>
                  <span className="hbar-pct muted">{totalSpent ? Math.round((s.value / totalSpent) * 100) : 0}%</span>
                </button>
                {openRow === s.key && <LineList lines={s.lines} catName={byGroup ? catName : undefined} />}
              </div>
            ))}
            {spending.length === 0 && <p className="empty">No spending in this period.</p>}
          </div>
          {spending.length > 0 && (
            <ExportButtons
              onSummary={() =>
                download(
                  `spending-${months[0]}-to-${to}.csv`,
                  toCsv([
                    [byGroup ? 'Category Group' : 'Category', 'Spent', 'Percent'],
                    ...spending.map((x) => [x.name, csvMoney(x.value), Math.round((x.value / totalSpent) * 100)]),
                    ['Total', csvMoney(totalSpent), 100],
                  ]),
                  'text/csv',
                )
              }
              onLines={() =>
                download(`spending-transactions-${months[0]}-to-${to}.csv`, toCsv(linesTable(data, spending.flatMap((x) => x.lines))), 'text/csv')
              }
            />
          )}
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
              <LineList lines={monthLines} catName={catName} />
            </div>
          ) : (
            <p className="hint">Tap a month to see its transactions.</p>
          )}
          <ExportButtons
            onSummary={() =>
              download(
                `spending-trend-${trendMonths[0]}-to-${to}.csv`,
                toCsv([['Month', 'Spent'], ...trendMonths.map((m, i) => [m, csvMoney(trend.values[i])]), ['Average', csvMoney(trend.average)]]),
                'text/csv',
              )
            }
            onLines={() => download(`spending-trend-transactions-${trendMonths[0]}-to-${to}.csv`, toCsv(linesTable(data, trend.lines)), 'text/csv')}
          />
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
          <ExportButtons
            onSummary={() =>
              download(
                `income-vs-spending-${today()}.csv`,
                toCsv([
                  ['Month', 'Income', 'Spending', 'Net'],
                  ...incomeVsSpending.map((x) => [x.month, csvMoney(x.income), csvMoney(x.spent), csvMoney(x.income - x.spent)]),
                ]),
                'text/csv',
              )
            }
          />
        </div>
      )}

      {tab === 'age' && (
        <div className="card">
          <div className="toolbar tight">
            <select value={ageRange} onChange={(e) => setAgeRange(Number(e.target.value))} aria-label="Range">
              {AGE_RANGES.map((r) => (
                <option key={r.months} value={r.months}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="hero">
            <span className="label">Age of Money</span>
            <span className="hero-number">{ageNow === null ? '—' : `${ageNow} day${ageNow === 1 ? '' : 's'}`}</span>
            <span className="muted small">
              {ageNow === null
                ? `Shows after ${OUTFLOWS_NEEDED} cash outflows covered by income (${outflows.length} so far).`
                : `On average, money you spent recently arrived ${ageNow} days earlier. Higher is better: it means you're spending last month's income, not this week's.`}
            </span>
          </div>
          {ageHistory.length > 1 && (
            <LineChart
              name="Age of Money (days)"
              color={BLUE}
              labels={ageHistory.map((x) => monthLabel(x.month, true))}
              values={ageHistory.map((x) => x.value * 100)}
              format={(v) => `${Math.round(v / 100)} days`}
            />
          )}
          <p className="hint">
            Based on the last {OUTFLOWS_NEEDED} cash outflows, first in, first out. Transfers between your cash accounts and
            starting balances aren't counted; credit card spending counts when you pay the card.
          </p>
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
          <ExportButtons
            onSummary={() =>
              download(`net-worth-${today()}.csv`, toCsv([['Month', 'Net Worth'], ...netWorth.map((x) => [x.month, csvMoney(x.value)])]), 'text/csv')
            }
          />
        </div>
      )}
    </div>
  );
}

function ExportButtons({ onSummary, onLines }: { onSummary: () => void; onLines?: () => void }) {
  return (
    <div className="export-row">
      <button className="btn small" onClick={onSummary}>
        ⬇ Export CSV
      </button>
      {onLines && (
        <button className="btn small" onClick={onLines}>
          ⬇ Transactions CSV
        </button>
      )}
    </div>
  );
}

/** The transactions behind a report number; each opens its account. */
function LineList({ lines, catName }: { lines: SpendingLine[]; catName?: (id: string) => string }) {
  if (lines.length === 0) return <p className="empty">No transactions.</p>;
  return (
    <ul className="report-lines">
      {lines.map((l, i) => (
        <li key={`${l.txId}-${i}`}>
          <a href={`#/accounts/${l.accountId}`} className="report-line">
            <span className="rl-main">
              <span className="truncate">{l.payee || '(no payee)'}</span>
              <small className="muted truncate">
                {dateLabel(l.date)}
                {catName && ` · ${catName(l.categoryId)}`}
                {l.memo && ` · ${l.memo}`}
              </small>
            </span>
            <span className={l.spent < 0 ? 'pos' : ''}>{fmt(l.spent)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

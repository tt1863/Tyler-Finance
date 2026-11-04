import { useMemo, useState } from 'react';
import { LineChart } from '../components/Charts';
import { transactionCategoryLabel } from '../components/CategorySelect';
import TransactionForm from '../components/TransactionForm';
import { addDays, addMonths, currentMonth, dateLabel, monthLabel, today as todayStr } from '../lib/dates';
import { cashAccountIds, forecast } from '../lib/forecast';
import { fmt, parseMoney, toInput } from '../lib/money';
import { STORAGE_KEY } from '../lib/preview';
import { enterNow, frequencyLabel, nextDate, skipNext, upcoming } from '../lib/scheduled';
import { useData, useStore } from '../lib/store';
import type { Scheduled } from '../lib/types';

const PREFS = `${STORAGE_KEY}-forecast`;
const RANGES = [30, 60, 90];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Prefs {
  account: string; // 'cash' or an account id
  range: number;
  minimum: number;
}

function loadPrefs(): Prefs {
  try {
    return { account: 'cash', range: 30, minimum: 0, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) };
  } catch {
    return { account: 'cash', range: 30, minimum: 0 };
  }
}

/** "Nov 4" (no year), for chart labels. */
const shortDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const compact = (cents: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(cents / 100);

/** Upcoming bills and paychecks on a calendar, and where your balance is heading. */
export default function CalendarPage() {
  const data = useData();
  const update = useStore((s) => s.update);
  const today = todayStr();
  const [prefs, setPrefsState] = useState(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      // Not saved; fine for this visit.
    }
  };
  const [minText, setMinText] = useState(prefs.minimum ? toInput(prefs.minimum) : '');
  const [month, setMonth] = useState(currentMonth());
  const [day, setDay] = useState<string>(today);
  const [editing, setEditing] = useState<Scheduled | null>(null);

  const cashAccounts = data.accounts.filter((a) => a.onBudget && !a.closed && a.type !== 'credit');
  const account = prefs.account !== 'cash' && cashAccounts.some((a) => a.id === prefs.account) ? prefs.account : 'cash';
  const ids = account === 'cash' ? cashAccountIds(data) : [account];
  const f = useMemo(() => forecast(data, today, prefs.range, ids, prefs.minimum), [data, today, prefs.range, ids.join(), prefs.minimum]);
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const scopeName = account === 'cash' ? 'Your cash accounts' : accountName(account);

  // Calendar: scheduled occurrences from today on, for the shown month.
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${addMonths(month, 1)}-01`, -1);
  const occurrences = useMemo(
    () => upcoming(data, monthStart > today ? monthStart : today, monthEnd),
    [data, monthStart, monthEnd, today],
  );
  const byDay = new Map<string, typeof occurrences>();
  for (const o of occurrences) byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]);
  const firstWeekday = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).getDay();
  const daysInMonth = Number(monthEnd.slice(8));
  const dayItems = byDay.get(day) ?? [];

  return (
    <div className="calendar-page">
      <h1>Bills & Forecast</h1>

      <section className="card">
        <div className="toolbar tight">
          <select value={account} onChange={(e) => setPrefs({ account: e.target.value })} aria-label="Accounts">
            <option value="cash">All cash accounts</option>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Days ahead">
            {RANGES.map((r) => (
              <button key={r} className={prefs.range === r ? 'active' : ''} onClick={() => setPrefs({ range: r })}>
                {r} days
              </button>
            ))}
          </div>
        </div>
        {f.short ? (
          <div className="banner bad">
            ⚠️ {scopeName} {f.short.day.balance < 0 ? 'go negative' : 'drop below your minimum'} on{' '}
            <b>{dateLabel(f.short.day.date)}</b>
            {f.short.cause ? ` after ${f.short.cause.scheduled.payee || 'a scheduled transaction'}` : ''} ({fmt(f.short.day.balance)}).
          </div>
        ) : (
          <div className="banner good">
            ✓ {scopeName} stay{account === 'cash' ? '' : 's'} above {fmt(prefs.minimum)} for the next {prefs.range} days.
          </div>
        )}
        <div className="tiles trend-tiles">
          <div className="tile">
            <span className="label">Today</span>
            <span className="tile-number">{fmt(f.start)}</span>
          </div>
          <div className="tile">
            <span className="label">Lowest · {dateLabel(f.lowest.date)}</span>
            <span className={`tile-number ${f.lowest.balance < 0 ? 'neg' : ''}`}>{fmt(f.lowest.balance)}</span>
          </div>
        </div>
        <LineChart
          name="Projected balance"
          color="var(--series-1)"
          labels={f.days.map((d) => shortDate(d.date))}
          values={f.days.map((d) => d.balance)}
        />
        <label className="forecast-min">
          Warn me below
          <input
            inputMode="decimal"
            value={minText}
            placeholder="0.00"
            onChange={(e) => setMinText(e.target.value)}
            onBlur={() => setPrefs({ minimum: Math.max(0, parseMoney(minText) ?? 0) })}
          />
        </label>
        <p className="hint">Based on today's balances and your scheduled transactions. Add bills and paychecks as scheduled transactions to include them.</p>
      </section>

      <section className="card">
        <div className="month-nav cal-nav">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= currentMonth()}>
            ‹
          </button>
          <h2>{monthLabel(month)}</h2>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            ›
          </button>
        </div>
        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="cal-head">
              {w}
            </span>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`;
            const items = byDay.get(date) ?? [];
            const net = items.reduce((s, o) => s + o.scheduled.amount, 0);
            return (
              <button
                key={date}
                className={`cal-day ${date === day ? 'selected' : ''} ${date === today ? 'today' : ''} ${date < today ? 'past' : ''}`}
                onClick={() => setDay(date)}
                aria-label={`${dateLabel(date)}${items.length ? `, ${items.length} scheduled` : ''}`}
              >
                <span className="cal-num">{i + 1}</span>
                {items.length > 0 && <span className={`cal-amt ${net < 0 ? 'neg' : 'pos'}`}>{compact(net)}</span>}
              </button>
            );
          })}
        </div>

        <h3 className="cal-day-title">{dateLabel(day)}</h3>
        {dayItems.length === 0 ? (
          <p className="empty">{day < today ? 'Past days show in your account registers.' : 'Nothing scheduled.'}</p>
        ) : (
          <ul className="report-lines">
            {dayItems.map(({ scheduled: s, date }) => {
              const isNext = nextDate(s) === date;
              return (
                <li key={s.id + date} className="cal-item">
                  <button className="report-line" onClick={() => setEditing(s)}>
                    <span className="rl-main">
                      <span className="truncate">{s.payee || 'No payee'}</span>
                      <small className="muted truncate">
                        {accountName(s.accountId)} · {s.transferAccountId ? `Transfer to ${accountName(s.transferAccountId)}` : transactionCategoryLabel(data, s) || 'No category'} ·{' '}
                        {frequencyLabel(s.frequency)}
                      </small>
                    </span>
                    <span className={s.amount < 0 ? 'neg' : 'pos'}>{fmt(s.amount)}</span>
                  </button>
                  {isNext && (
                    <span className="export-row cal-actions">
                      <button className="btn small" onClick={() => update((d) => enterNow(d, s.id, today))}>
                        Enter now
                      </button>
                      <button className="btn small" onClick={() => update((d) => skipNext(d, s.id))}>
                        Skip
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {editing && <TransactionForm scheduled={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import CategoryModal from '../components/CategoryModal';
import { ageOfMoney, agedOutflows } from '../lib/ageOfMoney';
import GroupModal from '../components/GroupModal';
import MoneyInput from '../components/MoneyInput';
import Modal from '../components/Modal';
import MoveMoneyModal from '../components/MoveMoneyModal';
import { CategoryQuickBudget, QuickBudgetModal } from '../components/QuickBudget';
import { categoryMonth, categoryTargetStatus, computeBudget, underfundedAmount } from '../lib/budget';
import { addDays, addMonths, currentMonth, monthLabel, today } from '../lib/dates';
import { fmt } from '../lib/money';
import { addCategory, addGroup, needsCategory, setAssigned, snoozeTarget } from '../lib/ops';
import { go } from '../lib/route';
import { upcoming } from '../lib/scheduled';
import { findTransferPairs } from '../lib/transfers';
import { useData, useStore } from '../lib/store';
import type { Category, CategoryGroup } from '../lib/types';

export default function BudgetPage({ month: monthArg }: { month?: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : currentMonth();
  const summary = useMemo(() => computeBudget(data, month).get(month)!, [data, month]);
  const [showHidden, setShowHidden] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingGroup, setEditingGroup] = useState<CategoryGroup | null>(null);
  const [moving, setMoving] = useState<{ categoryId: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  // On phones the details panel sits below the whole budget, so tapping a
  // category's name opens its details as a sheet instead.
  const isPhone = useIsPhone();
  const [sheet, setSheet] = useState<string | null>(null);
  const uncategorized = useMemo(() => needsCategory(data).length, [data]);
  const possibleTransfers = useMemo(() => findTransferPairs(data).length, [data]);
  // Scheduled transactions still to come in this month, by category.
  const upcomingByCat = useMemo(() => {
    const start = month === currentMonth() ? today() : `${month}-01`;
    const end = addDays(`${addMonths(month, 1)}-01`, -1);
    const out: Record<string, number> = {};
    if (month < currentMonth()) return out;
    for (const u of upcoming(data, start, end)) {
      const id = u.scheduled.categoryId;
      if (id) out[id] = (out[id] ?? 0) + u.scheduled.amount;
    }
    return out;
  }, [data, month]);

  const rta = summary.readyToAssign;
  const age = useMemo(() => ageOfMoney(agedOutflows(data)), [data]);
  const totalUnderfunded = data.categories
    .filter((c) => !c.hidden)
    .reduce((s, c) => s + underfundedAmount(c, categoryMonth(summary, c.id), month, data), 0);

  const setMonth = (m: string) => go(`budget/${m}`);

  const newGroup = () => {
    const name = prompt('New category group name');
    if (name?.trim()) update((d) => addGroup(d, name));
  };
  const newCategory = (groupId: string) => {
    const name = prompt('New category name');
    if (name?.trim()) update((d) => addCategory(d, groupId, name));
  };

  const selectedCat = selected ? data.categories.find((c) => c.id === selected) : undefined;
  const sheetCat = sheet ? data.categories.find((c) => c.id === sheet) : undefined;

  return (
    <div className="budget-page">
      <div className="budget-header">
        <div className="month-nav">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            ‹
          </button>
          <h1>{monthLabel(month, true)}</h1>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            ›
          </button>
          {month !== currentMonth() && (
            <button className="link-btn small" onClick={() => setMonth(currentMonth())}>
              Today
            </button>
          )}
        </div>
        <button
          className={`rta ${rta > 0 ? 'positive' : rta < 0 ? 'negative' : 'zero'}`}
          onClick={() => rta !== 0 && setMoving({ categoryId: 'rta' })}
          title={rta !== 0 ? 'Move money' : undefined}
        >
          <span className="rta-amount">{fmt(rta)}</span>
          <span className="rta-label">
            {rta > 0 ? 'Ready to Assign' : rta < 0 ? 'Assigned more than you have' : 'All money assigned'}
          </span>
        </button>
        {age !== null && (
          <a className="aom" href="#/reports/age" title="Age of Money">
            Age of Money <b>{age} day{age === 1 ? '' : 's'}</b>
          </a>
        )}
      </div>

      {possibleTransfers > 0 && (
        <a className="banner info" href="#/accounts">
          🔁 {possibleTransfers} possible transfer{possibleTransfers > 1 ? 's' : ''} to review →
        </a>
      )}
      {uncategorized > 0 && (
        <a className="banner warn" href="#/accounts/all">
          {uncategorized} transaction{uncategorized > 1 ? 's' : ''} need{uncategorized === 1 ? 's' : ''} a category →
        </a>
      )}

      <div className="toolbar">
        <button className="btn" onClick={newGroup}>
          + Category Group
        </button>
        <button className="btn" onClick={() => setQuickOpen(true)}>
          ⚡ Quick budget
        </button>
        <label className="checkbox inline small">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
      </div>

      <div className="budget-layout">
        <div className="budget-table" role="table">
          <div className="budget-row head" role="row">
            <span>Category</span>
            <span className="num">Assigned</span>
            <span className="num activity-col">Activity</span>
            <span className="num">Available</span>
          </div>
          {data.groups
            .filter((g) => showHidden || !g.hidden)
            .map((g) => {
              const cats = data.categories.filter((c) => c.groupId === g.id && (showHidden || !c.hidden));
              const totals = cats.reduce(
                (t, c) => {
                  const cm = categoryMonth(summary, c.id);
                  return { assigned: t.assigned + cm.assigned, activity: t.activity + cm.activity, available: t.available + cm.available };
                },
                { assigned: 0, activity: 0, available: 0 },
              );
              return (
                <div key={g.id} className={`budget-group ${g.hidden ? 'is-hidden' : ''}`}>
                  <div className="budget-row group" role="row">
                    <span className="group-name">
                      <button className="link-btn strong" onClick={() => setEditingGroup(g)}>
                        {g.name}
                      </button>
                      {!g.system && (
                        <button className="icon-btn tiny" aria-label={`Add category to ${g.name}`} onClick={() => newCategory(g.id)}>
                          +
                        </button>
                      )}
                    </span>
                    <span className="num">{fmt(totals.assigned)}</span>
                    <span className="num activity-col">{fmt(totals.activity)}</span>
                    <span className="num">{fmt(totals.available)}</span>
                  </div>
                  {cats.map((c) => {
                    const cm = categoryMonth(summary, c.id);
                    const ts = categoryTargetStatus(data, c, cm, month);
                    // Red: cash overspending (comes out of next month). Yellow: only
                    // credit overspending (added to the card balance), or a target
                    // that still needs money.
                    const creditOnly = cm.available < 0 && cm.creditOverspent >= -cm.available;
                    const pill =
                      cm.available < 0 && !creditOnly
                        ? 'negative'
                        : creditOnly || (ts && ts.underfunded > 0)
                          ? 'warning'
                          : cm.available > 0
                            ? 'positive'
                            : 'zero';
                    return (
                      <div
                        key={c.id}
                        className={`budget-row cat ${c.hidden ? 'is-hidden' : ''} ${selected === c.id ? 'selected' : ''}`}
                        role="row"
                        onClick={() => setSelected(c.id)}
                      >
                        <span className="cat-name">
                          <button className="link-btn" onClick={() => (isPhone ? setSheet(c.id) : setEditingCat(c))}>
                            {c.name}
                          </button>
                          {ts && (
                            <span className="target-bar" title={`${ts.description}: ${fmt(c.target!.amount)}`}>
                              <span
                                className={`target-fill ${ts.snoozed ? 'snoozed' : ts.progress >= 1 ? 'done' : ''}`}
                                style={{ width: `${Math.round(ts.progress * 100)}%` }}
                              />
                            </span>
                          )}
                          {ts && ts.underfunded > 0 && <span className="target-note">{fmt(ts.underfunded)} more needed</span>}
                          {ts?.snoozed && <span className="target-note muted">Snoozed this month</span>}
                        </span>
                        <span className="num">
                          <MoneyInput
                            value={cm.assigned}
                            ariaLabel={`Assigned to ${c.name}`}
                            onCommit={(v) => update((d) => setAssigned(d, month, c.id, v))}
                          />
                        </span>
                        <span className="num activity-col muted">{fmt(cm.activity)}</span>
                        <span className="num">
                          <button className={`pill ${pill}`} onClick={() => setMoving({ categoryId: c.id })}>
                            {fmt(cm.available)}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {data.categories.length === 0 && (
            <p className="empty">No categories yet. Add a category group to get started.</p>
          )}
        </div>

        <aside className="inspector">
          {selectedCat ? (
            <CategoryInspector
              category={selectedCat}
              month={month}
              cm={categoryMonth(summary, selectedCat.id)}
              upcomingAmount={upcomingByCat[selectedCat.id] ?? 0}
              onEdit={() => setEditingCat(selectedCat)}
              onAssign={(v) => update((d) => setAssigned(d, month, selectedCat.id, v))}
            />
          ) : (
            <div className="card">
              <h3>{monthLabel(month)}</h3>
              <dl className="stats">
                <dt>Income this month</dt>
                <dd>{fmt(summary.income)}</dd>
                <dt>Assigned this month</dt>
                <dd>{fmt(summary.assigned)}</dd>
                <dt>Activity</dt>
                <dd>{fmt(summary.activity)}</dd>
                <dt>Total available</dt>
                <dd>{fmt(summary.available)}</dd>
                {summary.overspentLastMonth > 0 && (
                  <>
                    <dt>Overspent last month</dt>
                    <dd className="neg">−{fmt(summary.overspentLastMonth)}</dd>
                  </>
                )}
                {summary.assignedInFuture !== 0 && (
                  <>
                    <dt>Assigned in future months</dt>
                    <dd>{fmt(summary.assignedInFuture)}</dd>
                  </>
                )}
                <dt>Underfunded targets</dt>
                <dd>{fmt(totalUnderfunded)}</dd>
              </dl>
              <p className="hint">Tip: tap a category to see details. In amount fields you can type math like 40+25.</p>
            </div>
          )}
        </aside>
      </div>

      {quickOpen && <QuickBudgetModal month={month} onClose={() => setQuickOpen(false)} />}
      {sheetCat && (
        <Modal title={sheetCat.name} onClose={() => setSheet(null)}>
          <CategoryInspector
            category={sheetCat}
            month={month}
            cm={categoryMonth(summary, sheetCat.id)}
            upcomingAmount={upcomingByCat[sheetCat.id] ?? 0}
            onEdit={() => {
              setSheet(null);
              setEditingCat(sheetCat);
            }}
            onAssign={(v) => update((d) => setAssigned(d, month, sheetCat.id, v))}
            inSheet
          />
        </Modal>
      )}
      {editingCat && <CategoryModal category={editingCat} month={month} onClose={() => setEditingCat(null)} />}
      {editingGroup && <GroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />}
      {moving && <MoveMoneyModal categoryId={moving.categoryId} month={month} summary={summary} onClose={() => setMoving(null)} />}
    </div>
  );
}

function CategoryInspector({
  category,
  month,
  cm,
  onEdit,
  onAssign,
  upcomingAmount,
  inSheet = false,
}: {
  category: Category;
  month: string;
  cm: ReturnType<typeof categoryMonth>;
  upcomingAmount: number;
  onEdit: () => void;
  onAssign: (v: number) => void;
  inSheet?: boolean;
}) {
  const data = useData();
  const update = useStore((s) => s.update);
  const ts = categoryTargetStatus(data, category, cm, month);
  return (
    <div className={inSheet ? 'inspector-sheet' : 'card'}>
      {!inSheet && <h3>{category.name}</h3>}
      <dl className="stats">
        <dt>Left over from last month</dt>
        <dd>{fmt(cm.carryIn)}</dd>
        <dt>Assigned this month</dt>
        <dd>{fmt(cm.assigned)}</dd>
        <dt>Activity</dt>
        <dd>{fmt(cm.activity)}</dd>
        <dt>Available</dt>
        <dd className={cm.available >= 0 ? '' : cm.creditOverspent >= -cm.available ? 'credit-text' : 'neg'}>{fmt(cm.available)}</dd>
        {upcomingAmount !== 0 && (
          <>
            <dt>Scheduled later this month</dt>
            <dd>{fmt(upcomingAmount)}</dd>
            <dt>Available after scheduled</dt>
            <dd className={cm.available + upcomingAmount < 0 ? 'neg' : ''}>{fmt(cm.available + upcomingAmount)}</dd>
          </>
        )}
      </dl>
      {ts ? (
        <div className="target-box">
          <b>Target: {fmt(category.target!.amount)}</b> · {ts.description}
          {ts.needed > 0 && <div className="muted small">Needs {fmt(ts.needed)} this month</div>}
          <div className="target-bar wide">
            <span className={`target-fill ${ts.snoozed ? 'snoozed' : ts.progress >= 1 ? 'done' : ''}`} style={{ width: `${Math.round(ts.progress * 100)}%` }} />
          </div>
          {ts.snoozed ? (
            <p className="hint">
              Snoozed for {monthLabel(month)}. It asks again next month.{' '}
              <button className="link-btn small" onClick={() => update((d) => snoozeTarget(d, category.id, null))}>
                Unsnooze
              </button>
            </p>
          ) : ts.underfunded > 0 ? (
            <div className="toolbar tight">
              <button className="btn primary small" onClick={() => onAssign(cm.assigned + ts.underfunded)}>
                Assign {fmt(ts.underfunded)} to meet target
              </button>
              {/* Like YNAB: only for the current month, never for card payments. */}
              {month === currentMonth() && !category.ccAccountId && (
                <button className="btn small" onClick={() => update((d) => snoozeTarget(d, category.id, month))}>
                  Snooze this month
                </button>
              )}
            </div>
          ) : (
            <p className="good">✓ On track this month</p>
          )}
        </div>
      ) : (
        <p className="hint">No target yet.</p>
      )}
      {cm.available < 0 && (
        <div className="overspent-box">
          {cm.creditOverspent > 0 && (
            <p>
              <b className="credit-text">{fmt(cm.creditOverspent)} overspent on a credit card.</b> It was added to the card's balance
              as new debt. Cover it to set the money aside for the card bill; otherwise it resets at month end.
            </p>
          )}
          {-cm.available > cm.creditOverspent && (
            <p>
              <b className="neg">{fmt(-cm.available - cm.creditOverspent)} overspent in cash.</b> If it isn't covered, it comes out of
              next month's Ready to Assign.
            </p>
          )}
          <button className="btn small" onClick={() => onAssign(cm.assigned - cm.available)}>
            Cover overspending ({fmt(-cm.available)})
          </button>
        </div>
      )}
      {category.note && <p className="note">{category.note}</p>}
      <CategoryQuickBudget category={category} month={month} />
      <button className="btn small" onClick={onEdit}>
        Edit category & target
      </button>
    </div>
  );
}

function useIsPhone() {
  const query = '(max-width: 760px)';
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

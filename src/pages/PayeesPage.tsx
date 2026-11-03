import { useMemo, useState } from 'react';
import CategorySelect, { categoryName } from '../components/CategorySelect';
import Modal from '../components/Modal';
import { dateLabel } from '../lib/dates';
import { forgetPayee, listPayees, renamePayee, setPayeeCategory, type PayeeInfo } from '../lib/payees';
import { useData, useStore } from '../lib/store';

export default function PayeesPage() {
  const data = useData();
  const payees = useMemo(() => listPayees(data), [data]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PayeeInfo | null>(null);
  const shown = payees.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="payees-page">
      <h1>Payees</h1>
      <p className="hint">Rename a payee to fix it everywhere, or rename it to another payee's name to merge them. The category is filled in automatically for new transactions.</p>
      <input className="search payee-search" type="search" placeholder={`Search ${payees.length} payees…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="payee-list">
        {shown.map((p) => (
          <button key={p.name} className="payee-row" onClick={() => setEditing(p)}>
            <span className="payee-main">
              <b className="truncate">{p.name}</b>
              <span className="muted small">
                {p.count} transaction{p.count === 1 ? '' : 's'}
                {p.scheduled ? ` · ${p.scheduled} scheduled` : ''}
                {p.lastUsed ? ` · last ${dateLabel(p.lastUsed)}` : ''}
              </span>
            </span>
            <span className="muted small truncate payee-cat">{p.categoryId ? categoryName(data, p.categoryId) : ''}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="empty">No payees{query ? ' match' : ' yet'}.</p>}
      </div>
      {editing && <PayeeModal payee={editing} all={payees} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PayeeModal({ payee, all, onClose }: { payee: PayeeInfo; all: PayeeInfo[]; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [name, setName] = useState(payee.name);
  const [categoryId, setCategoryId] = useState<string | null>(payee.categoryId);
  const mergeInto = all.find((p) => p.name !== payee.name && p.name.toLowerCase() === name.trim().toLowerCase());
  const unused = payee.count === 0 && payee.scheduled === 0;

  const save = () => {
    update((d) => {
      // Category first (under the current name), then rename so it carries over.
      let next = categoryId !== payee.categoryId ? setPayeeCategory(d, payee.name, categoryId) : d;
      if (name.trim() && name.trim() !== payee.name) next = renamePayee(next, payee.name, name);
      return next;
    });
    onClose();
  };

  return (
    <Modal
      title="Edit payee"
      onClose={onClose}
      footer={
        <>
          {unused && (
            <button
              className="btn danger-outline"
              onClick={() => {
                update((d) => forgetPayee(d, payee.name));
                onClose();
              }}
            >
              Forget
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {mergeInto ? 'Merge' : 'Save'}
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {mergeInto && (
          <p className="hint">
            "{mergeInto.name}" already exists. Saving merges {payee.count} transaction{payee.count === 1 ? '' : 's'} into it.
          </p>
        )}
        {!mergeInto && name.trim() !== payee.name && name.trim() && (
          <p className="hint">Renames {payee.count + payee.scheduled} transaction{payee.count + payee.scheduled === 1 ? '' : 's'} and schedules.</p>
        )}
        <label>
          Category for new transactions
          <CategorySelect data={data} value={categoryId} onChange={setCategoryId} includeRta includeNone="None (don't fill in)" />
        </label>
      </form>
    </Modal>
  );
}

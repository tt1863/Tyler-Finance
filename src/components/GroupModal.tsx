import { useState } from 'react';
import { deleteGroup, reorder, updateGroup } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import type { CategoryGroup } from '../lib/types';
import CategorySelect from './CategorySelect';
import Modal from './Modal';

export default function GroupModal({ group, onClose }: { group: CategoryGroup; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [name, setName] = useState(group.name);
  const [deleting, setDeleting] = useState(false);
  const [reassign, setReassign] = useState<string | null>(null);
  const catIds = new Set(data.categories.filter((c) => c.groupId === group.id).map((c) => c.id));
  const used = data.transactions.some((t) => t.categoryId && catIds.has(t.categoryId));

  if (deleting) {
    return (
      <Modal
        title={`Delete "${group.name}"`}
        onClose={onClose}
        footer={
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => setDeleting(false)}>
              Back
            </button>
            <button
              className="btn danger"
              disabled={used && (!reassign || catIds.has(reassign))}
              onClick={() => {
                update((d) => deleteGroup(d, group.id, reassign));
                onClose();
              }}
            >
              Delete group and its {catIds.size} categories
            </button>
          </>
        }
      >
        <div className="form">
          {used ? (
            <label>
              Move transactions and assigned money to
              <CategorySelect
                data={{ ...data, categories: data.categories.filter((c) => !catIds.has(c.id)) }}
                value={reassign}
                onChange={setReassign}
                includeNone="Choose a category…"
              />
            </label>
          ) : (
            <p>None of these categories have transactions.</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Edit Category Group"
      onClose={onClose}
      footer={
        <>
          {!group.system && (
            <button className="btn danger-outline" onClick={() => setDeleting(true)}>
              Delete
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              update((d) => updateGroup(d, group.id, { hidden: !group.hidden }));
              onClose();
            }}
          >
            {group.hidden ? 'Unhide' : 'Hide'}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (name.trim()) update((d) => updateGroup(d, group.id, { name: name.trim() }));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          Name
          <input value={name} disabled={group.system} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="reorder">
          <span>Order</span>
          <div>
            {([-1, 1] as const).map((dir) => (
              <button key={dir} className="btn small" onClick={() => update((d) => ({ ...d, groups: reorder(d.groups, group.id, dir) }))}>
                {dir < 0 ? '↑ Up' : '↓ Down'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

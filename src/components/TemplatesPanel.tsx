import { useState } from 'react';
import { addTemplateGroups } from '../lib/ops';
import { useData, useStore } from '../lib/store';
import { TEMPLATES, templateById } from '../lib/templates';

/** Settings card: add groups of categories from a template to this budget. */
export default function TemplatesPanel() {
  const data = useData();
  const update = useStore((s) => s.update);
  const [id, setId] = useState(TEMPLATES[0].id);
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState('');
  const template = templateById(id);
  const norm = (s: string) => s.trim().toLowerCase();
  // How many of a group's categories this budget doesn't have yet.
  const missing = (group: string) => {
    const g = data.groups.find((x) => !x.system && norm(x.name) === norm(group));
    return template.groups[group].filter((c) => !g || !data.categories.some((x) => x.groupId === g.id && norm(x.name) === norm(c))).length;
  };

  const add = () => {
    const count = picked.reduce((s, g) => s + missing(g), 0);
    update((d) => addTemplateGroups(d, id, picked));
    setDone(`Added ${count} categor${count === 1 ? 'y' : 'ies'}.`);
    setPicked([]);
  };

  return (
    <section className="card">
      <h3>Category templates</h3>
      <p className="hint">Add ready-made groups of categories. Categories you already have are skipped.</p>
      <select
        value={id}
        aria-label="Template"
        onChange={(e) => {
          setId(e.target.value);
          setPicked([]);
          setDone('');
        }}
      >
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="template-groups">
        {Object.entries(template.groups).map(([group, cats]) => {
          const left = missing(group);
          return (
            <label key={group} className="checkbox">
              <input
                type="checkbox"
                disabled={left === 0}
                checked={picked.includes(group)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, group] : picked.filter((g) => g !== group))}
              />
              <span>
                <b>{group}</b> {left === 0 ? <span className="muted">(already added)</span> : null}
                <br />
                <small className="muted">{cats.join(', ')}</small>
              </span>
            </label>
          );
        })}
      </div>
      <button className="btn primary" disabled={picked.length === 0} onClick={add}>
        Add selected groups
      </button>
      {done && <p className="hint">{done}</p>}
    </section>
  );
}

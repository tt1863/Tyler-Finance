import { FLAG_COLORS, FLAG_HEX, setFlagName } from '../lib/flags';
import { useData, useStore } from '../lib/store';

/** Settings card: name flag colors (e.g. blue = "Reimbursable"). */
export default function FlagsPanel() {
  const data = useData();
  const update = useStore((s) => s.update);
  const counts: Record<string, number> = {};
  for (const t of data.transactions) if (t.flag) counts[t.flag] = (counts[t.flag] ?? 0) + 1;
  return (
    <section className="card">
      <h3>Flags</h3>
      <p className="hint">Flags group transactions across categories, like reimbursements or a trip. Give a color a name to make it easy to search for.</p>
      <div className="flag-names">
        {FLAG_COLORS.map((c) => (
          <label key={c} className="flag-name-row">
            <span className="flag-dot big" style={{ background: FLAG_HEX[c] }} />
            <input
              defaultValue={data.flagNames[c] ?? ''}
              placeholder={c[0].toUpperCase() + c.slice(1)}
              aria-label={`Name for the ${c} flag`}
              onBlur={(e) => e.target.value.trim() !== (data.flagNames[c] ?? '') && update((d) => setFlagName(d, c, e.target.value))}
            />
            <span className="muted small">{counts[c] ?? 0}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

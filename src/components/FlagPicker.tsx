import { FLAG_COLORS, FLAG_HEX, flagLabel } from '../lib/flags';
import type { BudgetData, FlagColor } from '../lib/types';

/** A row of flag colors to pick from (or none). */
export default function FlagPicker({
  data,
  value,
  onChange,
}: {
  data: BudgetData;
  value: FlagColor | null | undefined;
  onChange: (color: FlagColor | null) => void;
}) {
  return (
    <div className="flag-picker" role="radiogroup" aria-label="Flag">
      <button type="button" role="radio" aria-checked={!value} className={`flag-choice none ${!value ? 'active' : ''}`} onClick={() => onChange(null)} title="No flag">
        ∅
      </button>
      {FLAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={flagLabel(data, c)}
          title={flagLabel(data, c)}
          className={`flag-choice ${value === c ? 'active' : ''}`}
          style={{ background: FLAG_HEX[c] }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** A small flag dot for lists. */
export function FlagDot({ data, color }: { data: BudgetData; color?: FlagColor }) {
  if (!color) return null;
  return <span className="flag-dot" style={{ background: FLAG_HEX[color] }} title={flagLabel(data, color)} aria-label={`Flag: ${flagLabel(data, color)}`} />;
}

import type { BudgetData } from '../lib/types';
import { READY_TO_ASSIGN } from '../lib/types';

/** Category dropdown grouped like the budget. */
export default function CategorySelect({
  data,
  value,
  onChange,
  includeRta = false,
  includeNone,
  exclude,
  disabled,
  id,
}: {
  data: BudgetData;
  value: string | null;
  onChange: (id: string | null) => void;
  includeRta?: boolean;
  includeNone?: string;
  exclude?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {includeNone !== undefined && <option value="">{includeNone}</option>}
      {includeRta && (
        <optgroup label="Inflow">
          <option value={READY_TO_ASSIGN}>Ready to Assign</option>
        </optgroup>
      )}
      {data.groups.map((g) => {
        const cats = data.categories.filter(
          (c) => c.groupId === g.id && c.id !== exclude && (!c.hidden || c.id === value),
        );
        if (!cats.length) return null;
        return (
          <optgroup key={g.id} label={g.name}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Category label for a transaction, e.g. "Groceries" or "Split: Groceries, Household". */
export function transactionCategoryLabel(data: BudgetData, t: { categoryId: string | null; splits?: { categoryId: string | null }[] }): string {
  if (t.splits?.length) return `Split: ${t.splits.map((p) => categoryName(data, p.categoryId) || 'Uncategorized').join(', ')}`;
  return categoryName(data, t.categoryId);
}

export function categoryName(data: BudgetData, id: string | null): string {
  if (id === READY_TO_ASSIGN) return 'Ready to Assign';
  if (!id) return '';
  return data.categories.find((c) => c.id === id)?.name ?? 'Deleted category';
}

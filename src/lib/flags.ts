import type { BudgetData, FlagColor } from './types';
import { FLAG_COLORS } from './types';

export { FLAG_COLORS };

/** Display colors for flags (readable on light and dark backgrounds). */
export const FLAG_HEX: Record<FlagColor, string> = {
  red: '#e03131',
  orange: '#f76707',
  yellow: '#f2b705',
  green: '#2f9e44',
  blue: '#1c7ed6',
  purple: '#7048e8',
};

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Reimbursable" if the color was named, otherwise "Blue". */
export function flagLabel(data: BudgetData, color: FlagColor): string {
  return data.flagNames[color]?.trim() || capital(color);
}

/** Does search text match this flag's color or name? */
export function flagMatches(data: BudgetData, color: FlagColor | undefined, query: string): boolean {
  if (!color || !query) return false;
  const q = query.toLowerCase();
  return color.includes(q) || flagLabel(data, color).toLowerCase().includes(q);
}

/** Set (or clear, with null) the flag on transactions. */
export function setFlag(data: BudgetData, ids: string[], color: FlagColor | null): BudgetData {
  const set = new Set(ids);
  return {
    ...data,
    transactions: data.transactions.map((t) => {
      if (!set.has(t.id)) return t;
      if (color) return { ...t, flag: color };
      const { flag: _flag, ...rest } = t;
      return rest;
    }),
  };
}

export function setFlagName(data: BudgetData, color: FlagColor, name: string): BudgetData {
  const flagNames = { ...data.flagNames };
  if (name.trim()) flagNames[color] = name.trim();
  else delete flagNames[color];
  return { ...data, flagNames };
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setCurrency } from './money';
import type { BudgetData } from './types';

interface StoreState {
  data: BudgetData | null;
  /** Previous versions of data for undo (not persisted). */
  history: BudgetData[];
  /** Apply a change. Every change is a pure function of the current data. */
  update: (fn: (d: BudgetData) => BudgetData) => void;
  replace: (data: BudgetData | null) => void;
  undo: () => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      data: null,
      history: [],
      update: (fn) => {
        const current = get().data;
        if (!current) return;
        const next = fn(current);
        if (next === current) return;
        set({ data: next, history: [...get().history.slice(-49), current] });
      },
      replace: (data) => {
        if (data) setCurrency(data.currency);
        set({ data, history: [] });
      },
      undo: () => {
        const history = get().history;
        if (!history.length) return;
        set({ data: history[history.length - 1], history: history.slice(0, -1) });
      },
    }),
    {
      name: 'tyler-finance',
      partialize: (s) => ({ data: s.data }),
      onRehydrateStorage: () => (state) => {
        if (state?.data) setCurrency(state.data.currency);
      },
    },
  ),
);

/** Convenience hook: the loaded budget (only used where data is guaranteed). */
export function useData(): BudgetData {
  const data = useStore((s) => s.data);
  if (!data) throw new Error('No budget loaded');
  return data;
}

import { emptyData, normalize } from '../ops';
import type { BudgetData } from '../types';

/**
 * A budget is synced as many small records (one per account, category,
 * transaction, assigned amount, ...) so devices can edit different items at
 * the same time and both changes survive.
 */
export type RecordKind =
  | 'account'
  | 'group'
  | 'category'
  | 'transaction'
  | 'scheduled'
  | 'assigned'
  | 'payee'
  | 'settings';

export const recordKey = (kind: string, id: string) => `${kind}/${id}`;

export function splitKey(key: string): { kind: RecordKind; id: string } {
  const i = key.indexOf('/');
  return { kind: key.slice(0, i) as RecordKind, id: key.slice(i + 1) };
}

/** JSON with sorted keys, so equal values always produce equal strings. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Fast 53-bit string hash (cyrb53). Used to remember what was last synced compactly. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Break a budget into records keyed by "kind/id". Ordered lists carry a sort index. */
export function toRecords(data: BudgetData | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!data) return out;
  data.accounts.forEach((a, sort) => out.set(recordKey('account', a.id), { ...a, sort }));
  data.groups.forEach((g, sort) => out.set(recordKey('group', g.id), { ...g, sort }));
  data.categories.forEach((c, sort) => out.set(recordKey('category', c.id), { ...c, sort }));
  for (const t of data.transactions) out.set(recordKey('transaction', t.id), t);
  for (const s of data.scheduled) out.set(recordKey('scheduled', s.id), s);
  for (const [month, row] of Object.entries(data.assigned)) {
    for (const [catId, amount] of Object.entries(row)) {
      if (amount !== 0) out.set(recordKey('assigned', `${month}|${catId}`), amount);
    }
  }
  for (const [payee, catId] of Object.entries(data.payeeCategory)) out.set(recordKey('payee', payee), catId);
  out.set(recordKey('settings', 'main'), { currency: data.currency, flagNames: data.flagNames });
  return out;
}

/** Rebuild a budget from records. */
export function fromRecords(records: Map<string, unknown>): BudgetData {
  const d = emptyData();
  const sorted: Record<'account' | 'group' | 'category', { sort: number }[]> = { account: [], group: [], category: [] };
  for (const [key, value] of records) {
    const { kind, id } = splitKey(key);
    switch (kind) {
      case 'account':
      case 'group':
      case 'category':
        sorted[kind].push(value as { sort: number });
        break;
      case 'transaction':
        d.transactions.push(value as BudgetData['transactions'][number]);
        break;
      case 'scheduled':
        d.scheduled.push(value as BudgetData['scheduled'][number]);
        break;
      case 'assigned': {
        const [month, catId] = id.split('|');
        (d.assigned[month] ??= {})[catId] = value as number;
        break;
      }
      case 'payee':
        d.payeeCategory[id] = value as string;
        break;
      case 'settings':
        d.currency = (value as { currency?: string }).currency ?? d.currency;
        d.flagNames = (value as { flagNames?: BudgetData['flagNames'] }).flagNames ?? {};
        break;
    }
  }
  const strip = <T,>(list: { sort: number }[]) =>
    list.sort((a, b) => a.sort - b.sort).map(({ sort: _sort, ...rest }) => rest as T);
  d.accounts = strip(sorted.account);
  d.groups = strip(sorted.group);
  d.categories = strip(sorted.category);
  d.transactions.sort((a, b) => a.date.localeCompare(b.date));
  return normalize(d);
}

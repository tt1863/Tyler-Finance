import type { BudgetData } from '../types';
import { fromRecords, hash, recordKey, splitKey, stableStringify, toRecords } from './records';

export interface RemoteRow {
  kind: string;
  id: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
}

export interface OutgoingRow {
  kind: string;
  id: string;
  data: unknown;
  deleted: boolean;
}

/** The server side of sync. Supabase in the app; an in-memory fake in tests. */
export interface Remote {
  upsert(rows: OutgoingRow[]): Promise<void>;
  /** Rows changed at or after `since` (all rows when null), oldest first. */
  fetchSince(since: string | null): Promise<RemoteRow[]>;
  hasAny(): Promise<boolean>;
}

/** What this device remembers between syncs. */
export interface SyncState {
  userId: string;
  /** Hash of each record as of the last successful sync. */
  base: Record<string, string>;
  /** Server time of the newest change already pulled. */
  cursor: string | null;
}

export const freshState = (userId: string): SyncState => ({ userId, base: {}, cursor: null });

/** Re-read rows slightly older than the cursor in case of commits that landed out of order. */
const OVERLAP_MS = 5000;

const hashOf = (value: unknown) => hash(stableStringify(value));

function hashes(records: Map<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of records) out.set(k, hashOf(v));
  return out;
}

/**
 * One sync pass: push local changes, then pull and merge remote ones.
 * Conflicts are resolved per record: the most recent write to the server wins,
 * but a local edit that hasn't been pushed yet is never overwritten.
 *
 * `getLocal` is called again before merging so edits made while waiting on the
 * network aren't lost. Returns the merged budget, or null if nothing came in.
 */
export async function syncOnce(
  remote: Remote,
  state: SyncState,
  getLocal: () => BudgetData | null,
): Promise<{ data: BudgetData | null; state: SyncState; pushed: number; pulled: number }> {
  const base = { ...state.base };

  // Push. With no budget on this device there's nothing to push; never treat
  // a missing budget as "delete everything in the cloud".
  const current = getLocal();
  const records = toRecords(current);
  const local = hashes(records);
  const outgoing: OutgoingRow[] = [];
  for (const [key, h] of local) {
    if (base[key] !== h) {
      const { kind, id } = splitKey(key);
      outgoing.push({ kind, id, data: records.get(key), deleted: false });
    }
  }
  for (const key of Object.keys(base)) {
    if (current && !local.has(key)) {
      const { kind, id } = splitKey(key);
      outgoing.push({ kind, id, data: null, deleted: true });
    }
  }
  if (outgoing.length) {
    await remote.upsert(outgoing);
    for (const row of outgoing) {
      const key = recordKey(row.kind, row.id);
      if (row.deleted) delete base[key];
      else base[key] = hashOf(row.data);
    }
  }

  // Pull.
  const since = state.cursor ? new Date(new Date(state.cursor).getTime() - OVERLAP_MS).toISOString() : null;
  const rows = await remote.fetchSince(since);
  let cursor = state.cursor;
  const latest = getLocal();
  const working = toRecords(latest);
  const workingHashes = hashes(working);
  let pulled = 0;
  for (const row of rows) {
    if (!cursor || row.updated_at > cursor) cursor = row.updated_at;
    const key = recordKey(row.kind, row.id);
    const remoteHash = row.deleted ? undefined : hashOf(row.data);
    if (remoteHash === base[key]) continue; // Already have it.
    // Keep local edits that haven't been pushed yet; they'll go up next pass.
    if (workingHashes.get(key) !== base[key]) continue;
    if (row.deleted) {
      working.delete(key);
      delete base[key];
    } else {
      working.set(key, row.data);
      base[key] = remoteHash!;
    }
    pulled++;
  }

  return {
    data: pulled ? fromRecords(working) : null,
    state: { ...state, base, cursor },
    pushed: outgoing.length,
    pulled,
  };
}

/** Replace this device's budget with the one in the cloud. */
export async function adoptRemote(remote: Remote, userId: string) {
  return syncOnce(remote, freshState(userId), () => null);
}

/** Replace the cloud budget with this device's budget (cloud-only items are deleted). */
export async function replaceRemote(remote: Remote, userId: string, local: BudgetData) {
  const rows = await remote.fetchSince(null);
  const keep = toRecords(local);
  const base: Record<string, string> = {};
  // Pretend we already know every cloud record, so the push deletes the ones
  // this device doesn't have and overwrites the rest.
  for (const row of rows) if (!row.deleted) base[recordKey(row.kind, row.id)] = 'stale';
  for (const key of keep.keys()) base[key] = 'stale';
  return syncOnce(remote, { userId, base, cursor: null }, () => local);
}

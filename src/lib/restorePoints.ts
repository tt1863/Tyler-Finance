import { STORAGE_KEY } from './preview';
import type { BudgetData } from './types';

/**
 * Restore points: copies of the whole budget saved on this device, in
 * IndexedDB (much more room than localStorage). One is saved automatically
 * each day the app is used; the last KEEP_AUTO automatic ones are kept.
 * Manual ones are kept until deleted.
 */

export const KEEP_AUTO = 14;

export interface RestorePointInfo {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: 'auto' | 'manual' | 'before-restore';
  note: string;
  accounts: number;
  transactions: number;
}

export interface RestorePoint extends RestorePointInfo {
  data: BudgetData;
}

/** Local calendar day of an ISO timestamp. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Whether today's automatic restore point still needs saving. */
export function needsDailyPoint(points: RestorePointInfo[], now: Date): boolean {
  const today = dayOf(now.toISOString());
  return !points.some((p) => p.kind === 'auto' && dayOf(p.at) === today);
}

/** Automatic points beyond the newest KEEP_AUTO, to delete. */
export function prunable(points: RestorePointInfo[]): string[] {
  return points
    .filter((p) => p.kind !== 'manual')
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(KEEP_AUTO)
    .map((p) => p.id);
}

export function makePoint(data: BudgetData, kind: RestorePointInfo['kind'], note = '', now = new Date()): RestorePoint {
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now.toISOString(),
    kind,
    note,
    accounts: data.accounts.length,
    transactions: data.transactions.length,
    data,
  };
}

// --- IndexedDB storage ---

const DB = `${STORAGE_KEY}-restore`;
const STORE = 'points';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? req.error);
        };
      }),
  );
}

/** All restore points, newest first, without their data. */
export async function listPoints(): Promise<RestorePointInfo[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<RestorePoint[]>);
  return all.map(({ data: _data, ...info }) => info).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export const getPoint = (id: string) => run('readonly', (s) => s.get(id) as IDBRequest<RestorePoint | undefined>);
export const deletePoint = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined);

/**
 * Save a restore point. If the browser is out of room, drop the oldest
 * automatic points and try again.
 */
export async function savePoint(point: RestorePoint): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await run('readwrite', (s) => s.put(point));
      for (const id of prunable(await listPoints())) await deletePoint(id);
      return;
    } catch (e) {
      const autos = (await listPoints()).filter((p) => p.kind !== 'manual');
      if (!autos.length) throw e;
      await deletePoint(autos[autos.length - 1].id);
    }
  }
}

/** Save today's automatic point if there isn't one yet. Errors are ignored. */
export async function dailyPoint(data: BudgetData | null, now = new Date()): Promise<void> {
  if (!data || typeof indexedDB === 'undefined') return;
  try {
    if (needsDailyPoint(await listPoints(), now)) await savePoint(makePoint(data, 'auto', '', now));
  } catch {
    // Private browsing or storage blocked: restore points just aren't available.
  }
}

/** Remove every restore point on this device. */
export function deleteAllPoints(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

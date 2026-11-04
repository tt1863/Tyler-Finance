import { describe, expect, it } from 'vitest';
import { KEEP_AUTO, makePoint, needsDailyPoint, prunable, type RestorePointInfo } from './restorePoints';
import { demoData } from './demo';

const info = (at: string, kind: RestorePointInfo['kind'] = 'auto'): RestorePointInfo => ({ id: at, at, kind, note: '', accounts: 0, transactions: 0 });

describe('restore points', () => {
  it('saves one automatic point per day', () => {
    const now = new Date(2026, 10, 4, 9, 0);
    expect(needsDailyPoint([], now)).toBe(true);
    expect(needsDailyPoint([info(new Date(2026, 10, 4, 7, 0).toISOString(), 'manual')], now)).toBe(true);
    expect(needsDailyPoint([info(new Date(2026, 10, 3, 23, 0).toISOString())], now)).toBe(true);
    expect(needsDailyPoint([info(new Date(2026, 10, 4, 0, 5).toISOString())], now)).toBe(false);
  });

  it('keeps the newest automatic points and every manual one', () => {
    const autos = Array.from({ length: KEEP_AUTO + 3 }, (_, i) => info(new Date(2026, 0, i + 1).toISOString()));
    const manual = info(new Date(2025, 0, 1).toISOString(), 'manual');
    const drop = prunable([...autos, manual]);
    expect(drop).toEqual(autos.slice(0, 3).map((p) => p.id).reverse());
  });

  it('records counts', () => {
    const d = demoData();
    const p = makePoint(d, 'manual', 'before import');
    expect(p).toMatchObject({ kind: 'manual', note: 'before import', accounts: d.accounts.length, transactions: d.transactions.length });
  });
});

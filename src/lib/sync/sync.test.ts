import { describe, expect, it } from 'vitest';
import { demoData } from '../demo';
import { reorder, saveTransaction, setAssigned, updateCategory } from '../ops';
import type { BudgetData } from '../types';
import { adoptRemote, freshState, replaceRemote, syncOnce, type SyncState } from './engine';
import { MemoryRemote } from './memoryRemote';
import { fromRecords, stableStringify, toRecords } from './records';

/** A device: its own copy of the budget and its own sync memory. */
class Device {
  constructor(
    public remote: MemoryRemote,
    public data: BudgetData | null,
    public state: SyncState = freshState('user-1'),
  ) {}
  async sync() {
    const r = await syncOnce(this.remote, this.state, () => this.data);
    this.state = r.state;
    if (r.data) this.data = r.data;
    return r;
  }
}

const same = (a: BudgetData | null, b: BudgetData | null) =>
  stableStringify(fromRecords(toRecords(a))) === stableStringify(fromRecords(toRecords(b)));

const tx = (d: BudgetData, payee: string, amount = -1000) =>
  saveTransaction(d, { accountId: d.accounts[0].id, date: '2026-10-10', payee, categoryId: null, memo: '', amount, cleared: 'uncleared' });

describe('records', () => {
  it('round-trips a full budget, including order', () => {
    const d = demoData();
    const back = fromRecords(toRecords(d));
    expect(back.categories.map((c) => c.id)).toEqual(d.categories.map((c) => c.id));
    expect(back.groups.map((g) => g.id)).toEqual(d.groups.map((g) => g.id));
    expect(back.assigned).toEqual(d.assigned);
    expect(back.transactions).toHaveLength(d.transactions.length);
    expect(back.scheduled).toEqual(d.scheduled);
    expect(same(d, back)).toBe(true);
  });
});

describe('sync between two devices', () => {
  it('uploads from the phone and downloads on the iPad', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    const ipad = new Device(remote, null);
    await phone.sync();
    await ipad.sync();
    expect(same(ipad.data, phone.data)).toBe(true);
    // Nothing to do on a second pass.
    const again = await ipad.sync();
    expect(again.pushed + again.pulled).toBe(0);
  });

  it('merges edits made on both devices to different items', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    const ipad = new Device(remote, null);
    await phone.sync();
    await ipad.sync();

    phone.data = tx(phone.data!, 'Phone coffee');
    const cat = ipad.data!.categories.find((c) => c.name === 'Groceries')!.id;
    ipad.data = setAssigned(ipad.data!, '2026-11', cat, 70000);

    await phone.sync();
    await ipad.sync();
    await phone.sync();

    for (const dev of [phone, ipad]) {
      expect(dev.data!.transactions.some((t) => t.payee === 'Phone coffee')).toBe(true);
      expect(dev.data!.assigned['2026-11'][cat]).toBe(70000);
    }
    expect(same(phone.data, ipad.data)).toBe(true);
  });

  it('deletes and reorders sync', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    const pc = new Device(remote, null);
    await phone.sync();
    await pc.sync();
    const victim = phone.data!.transactions[3].id;
    phone.data = { ...phone.data!, transactions: phone.data!.transactions.filter((t) => t.id !== victim) };
    const g = phone.data!.groups[2].id;
    phone.data = { ...phone.data!, groups: reorder(phone.data!.groups, g, -1) };
    await phone.sync();
    await pc.sync();
    expect(pc.data!.transactions.some((t) => t.id === victim)).toBe(false);
    expect(pc.data!.groups.map((x) => x.id)).toEqual(phone.data!.groups.map((x) => x.id));
  });

  it('the latest edit to the same item wins, and an unpushed local edit is kept', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    const pc = new Device(remote, null);
    await phone.sync();
    await pc.sync();
    const id = phone.data!.categories[5].id;
    phone.data = updateCategory(phone.data!, id, { name: 'From phone' });
    await phone.sync();
    pc.data = updateCategory(pc.data!, id, { name: 'From PC' });
    await pc.sync(); // PC's unpushed edit survives the pull, then is pushed.
    expect(pc.data!.categories.find((c) => c.id === id)!.name).toBe('From PC');
    await phone.sync();
    expect(phone.data!.categories.find((c) => c.id === id)!.name).toBe('From PC');
  });

  it('a device with no budget never wipes the cloud', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    await phone.sync();
    phone.data = null;
    await phone.sync();
    expect(await remote.hasAny()).toBe(true);
  });

  it('can replace the cloud with this device, or this device with the cloud', async () => {
    const remote = new MemoryRemote();
    const phone = new Device(remote, demoData());
    await phone.sync();

    let other = tx(demoData(), 'Only on PC');
    const r1 = await replaceRemote(remote, 'user-1', other);
    const fresh = new Device(remote, null);
    await fresh.sync();
    expect(same(fresh.data, other)).toBe(true);

    // Phone chooses the cloud version.
    const r2 = await adoptRemote(remote, 'user-1');
    expect(same(r2.data, other)).toBe(true);
    expect(r1.pushed).toBeGreaterThan(0);
    other = r2.data!;
  });
});

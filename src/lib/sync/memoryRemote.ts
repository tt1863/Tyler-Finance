import type { OutgoingRow, Remote, RemoteRow } from './engine';

/** In-memory stand-in for the Supabase table, used by tests. */
export class MemoryRemote implements Remote {
  rows = new Map<string, RemoteRow>();
  private tick = 0;

  private now() {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.tick * 10000).toISOString();
  }

  async upsert(rows: OutgoingRow[]) {
    for (const r of rows) {
      // Round-trip through JSON like a real database would.
      this.rows.set(`${r.kind}/${r.id}`, { ...JSON.parse(JSON.stringify(r)), updated_at: this.now() });
    }
  }

  async fetchSince(since: string | null) {
    return [...this.rows.values()]
      .filter((r) => !since || r.updated_at >= since)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }

  async hasAny() {
    return [...this.rows.values()].some((r) => !r.deleted);
  }
}

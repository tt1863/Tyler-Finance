import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutgoingRow, Remote, RemoteRow } from './engine';

const TABLE = 'budget_records';
const PAGE = 1000;
const CHUNK = 500;

export class SupabaseRemote implements Remote {
  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  async upsert(rows: OutgoingRow[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({ user_id: this.userId, ...r }));
      const { error } = await this.client.from(TABLE).upsert(chunk, { onConflict: 'user_id,kind,id' });
      if (error) throw error;
    }
  }

  async fetchSince(since: string | null) {
    const out: RemoteRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.client.from(TABLE).select('kind,id,data,deleted,updated_at');
      if (since) q = q.gte('updated_at', since);
      const { data, error } = await q.order('updated_at').order('kind').order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data as RemoteRow[]));
      if (!data || data.length < PAGE) return out;
    }
  }

  async hasAny() {
    const { count, error } = await this.client.from(TABLE).select('id', { count: 'exact', head: true }).eq('deleted', false);
    if (error) throw error;
    return (count ?? 0) > 0;
  }
}

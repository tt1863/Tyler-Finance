// Minimal Plaid API client for Supabase Edge Functions (Deno).

const ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox';
const BASE = ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';

export class PlaidError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function plaid<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('PLAID_CLIENT_ID'),
      secret: Deno.env.get('PLAID_SECRET'),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new PlaidError(json.error_code ?? 'PLAID_ERROR', json.error_message ?? `Plaid ${path} failed`);
  return json as T;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: { current: number | null; available: number | null };
}

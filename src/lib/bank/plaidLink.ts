// Loads Plaid Link (the secure bank sign-in window) from Plaid's site.

interface PlaidHandler {
  open(): void;
  destroy(): void;
}
interface PlaidMetadata {
  institution?: { name?: string } | null;
}
declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
        onExit: (error: { error_message?: string } | null) => void;
      }): PlaidHandler;
    };
  }
}

const SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const TOKEN_KEY = 'tyler-finance-link-token';
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the bank sign-in window. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface LinkResult {
  publicToken: string;
  institutionName: string;
}

/**
 * Open Plaid Link. Resolves with the result, or null if the person closed it.
 * Pass the current URL as receivedRedirectUri when returning from a bank's own
 * sign-in page (OAuth banks).
 */
export async function openPlaidLink(token: string, receivedRedirectUri?: string): Promise<LinkResult | null> {
  await load();
  localStorage.setItem(TOKEN_KEY, token);
  return new Promise((resolve, reject) => {
    const handler = window.Plaid!.create({
      token,
      receivedRedirectUri,
      onSuccess: (publicToken, metadata) => {
        localStorage.removeItem(TOKEN_KEY);
        handler.destroy();
        resolve({ publicToken, institutionName: metadata.institution?.name ?? 'Bank' });
      },
      onExit: (error) => {
        localStorage.removeItem(TOKEN_KEY);
        handler.destroy();
        if (error) reject(new Error(error.error_message ?? 'The bank connection was not completed.'));
        else resolve(null);
      },
    });
    handler.open();
  });
}

/** After a bank's own sign-in page sends you back, the saved token to resume with. */
export function pendingOAuth(): string | null {
  if (!new URLSearchParams(window.location.search).has('oauth_state_id')) return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearOAuthParams() {
  const url = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState(null, '', url);
}

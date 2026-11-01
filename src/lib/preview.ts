/**
 * Pull request previews are built with VITE_PREVIEW set to the branch name.
 * They live on the same website as the real app, so they keep their own
 * saved data and never sign in to sync — nothing in a preview can touch the
 * real budget.
 */
export const PREVIEW = import.meta.env.VITE_PREVIEW ?? '';
export const STORAGE_KEY = PREVIEW ? `tyler-finance-preview-${PREVIEW}` : 'tyler-finance';

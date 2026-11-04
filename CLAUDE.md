# Tyler Finance — working notes

Personal envelope-budgeting web app (React + TypeScript + Vite), inspired by YNAB.
Live at https://tt1863.github.io/Tyler-Finance/ — every push to `main` deploys via
`.github/workflows/deploy.yml`.

## Workflow

- Build each feature on its own branch (`claude/<feature-name>`), never directly on `main`.
- When a feature is ready, open a pull request into `main`. Merging the PR deploys it.
- Every open pull request gets a preview at `/preview/<branch-without-claude/>/`
  (built by `scripts/build-site.sh`; the workflow comments the link on the PR).
  Previews use separate storage (and their own sign-in); they refuse the real
  budget's email, so test sync/banks there with an address like you+test@gmail.com.
- Server functions (`supabase/functions/`) deploy via `.github/workflows/functions.yml`
  on pushes to `main` and `claude/**` (needs the `SUPABASE_ACCESS_TOKEN` repo secret).
  Database changes are SQL files in `supabase/` that the owner runs in the SQL Editor.
- The backlog is GitHub issues (labels: wave, priority, effort). Work from an issue and put
  "Closes #N" in the pull request so merging closes it.
- Merge only when the owner says the feature is ready to ship.
- Before pushing: `npm run typecheck`, `npm test`, `npm run build`, and check the UI
  at phone width (the owner mainly uses the app on a phone).

## Code map

- `src/lib/budget.ts` — budget math (activity, available, Ready to Assign, targets).
- `src/lib/ops.ts` — pure functions that change budget data; `scheduled.ts` for recurring.
- `src/lib/store.ts` — zustand store persisted to localStorage (key `tyler-finance`).
  New data fields need a default in `normalize()` so older saved budgets keep loading.
- Money is integer cents; positive = inflow.
- Linked banks (Plaid): `supabase/functions/bank` (app calls), `bank-webhook` (Plaid calls),
  `_shared/importPlan.ts` (pure import/matching logic, unit-tested), `supabase/bank.sql`.
  Imported transactions have `bankId`; edits must keep it (see `saveTransaction`).
- Credit cards follow YNAB: card spending moves only the funded part of a purchase to the
  card's payment category (`computeBudget` walks each month's transactions in date order);
  the rest is `creditOverspent` (yellow), which resets at month end without reducing
  Ready to Assign. Cash overspending (red) comes out of next month.

- Push notifications: the app uploads a summary (`src/lib/pushSummary.ts`) to `push_summaries`;
  `supabase/functions/push` runs hourly (pg_cron, `supabase/push.sql`) and sends a daily digest using
  `_shared/digest.ts`. VAPID keys are made by the function and kept in `push_config`. The service
  worker template handles `push` and `notificationclick`.
- Offline: `build/serviceWorker.ts` (Vite plugin) writes `dist/sw.js`, which saves every file
  of the build (cache per scope + build hash); `src/lib/updates.ts` registers it and shows the
  "new version" bar. Cache lookups must use `ignoreVary` (module scripts send `Origin`).

## Phone layout rules

- Text fields must be at least 16px on phones, or iOS Safari zooms in on tap and stays zoomed.
- Nothing may be wider than the screen at 320px; check new screens and popups at 320/375/390px.

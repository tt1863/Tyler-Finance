# Tyler Finance — working notes

Personal envelope-budgeting web app (React + TypeScript + Vite), inspired by YNAB.
Live at https://tt1863.github.io/Tyler-Finance/ — every push to `main` deploys via
`.github/workflows/deploy.yml`.

## Workflow

- Build each feature on its own branch (`claude/<feature-name>`), never directly on `main`.
- When a feature is ready, open a pull request into `main`. Merging the PR deploys it.
- Every open pull request gets a preview at `/preview/<branch-without-claude/>/`
  (built by `scripts/build-site.sh`; the workflow comments the link on the PR).
  Previews use separate storage and never sync, so they can't touch the real budget.
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

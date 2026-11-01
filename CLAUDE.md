# Tyler Finance — working notes

Personal envelope-budgeting web app (React + TypeScript + Vite), inspired by YNAB.
Live at https://tt1863.github.io/Tyler-Finance/ — every push to `main` deploys via
`.github/workflows/deploy.yml`.

## Workflow

- Build each feature on its own branch (`claude/<feature-name>`), never directly on `main`.
- When a feature is ready, open a pull request into `main`. Merging the PR deploys it.
- Merge only when the owner says the feature is ready to ship.
- Before pushing: `npm run typecheck`, `npm test`, `npm run build`, and check the UI
  at phone width (the owner mainly uses the app on a phone).

## Code map

- `src/lib/budget.ts` — budget math (activity, available, Ready to Assign, targets).
- `src/lib/ops.ts` — pure functions that change budget data; `scheduled.ts` for recurring.
- `src/lib/store.ts` — zustand store persisted to localStorage (key `tyler-finance`).
  New data fields need a default in `normalize()` so older saved budgets keep loading.
- Money is integer cents; positive = inflow.

## Phone layout rules

- Text fields must be at least 16px on phones, or iOS Safari zooms in on tap and stays zoomed.
- Nothing may be wider than the screen at 320px; check new screens and popups at 320/375/390px.

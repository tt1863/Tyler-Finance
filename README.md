# Tyler Finance

A personal zero-based (envelope) budgeting app, inspired by how YNAB works.
Give every dollar a job: assign the money you have to categories, spend from
them, and move money around when plans change.

## Features

- **Budget** — monthly view with Assigned / Activity / Available per category,
  a "Ready to Assign" total, category groups, hide/reorder, month-to-month
  rollover, and overspending that comes out of next month's Ready to Assign.
- **Quick budget** — one tap to assign what targets need, last month's
  assigned or spent, 3-month averages, reduce overfunding, or reset available to
  $0; for one category (tap its name on a phone) or the whole month.
- **Move money** — tap any Available amount to move money or cover overspending.
- **Targets** — "assign each month", "refill up to", "have a balance by a date",
  and "have a balance of", with progress bars and one-click **Assign Underfunded**.
- **Accounts** — checking, savings, cash, credit cards (budget accounts) and
  loans/assets (tracking accounts that only count toward net worth).
- **Credit cards** — spending on a card moves money from the category into the
  card's payment category, so the money to pay the bill is already set aside.
- **Transactions** — add/edit/delete, transfers between accounts (pick
  "Transfer : Account" as the payee), cleared/uncleared, search, bulk delete,
  payee auto-categorization, and a "needs category" filter.
- **Recurring transactions** — set a transaction to repeat (weekly, every 2
  weeks, monthly, every 3/6 months, yearly) with an optional end date. Due ones
  are entered automatically when you open the app; upcoming ones are listed in
  each account with Enter now / Skip. Future-dated transactions wait until their date.
- **Split transactions** — divide one purchase across several categories (tap
  "Split" next to Category), each part with its own memo.
- **Debt payoff planner** — add each card's or loan's interest rate and minimum
  payment, then see your debt-free date, total interest, and how an extra
  monthly payment (avalanche or snowball) gets you there sooner.
- **Reconcile** — match the cleared balance to your bank and lock it in.
- **CSV import** from your bank, with duplicate detection.
- **Reports** — spending by category/group, income vs spending, net worth.
- **Sync across devices** (optional) — sign in with an emailed 6-digit code to
  keep the budget in sync on phone, tablet and computer via Supabase. Works
  offline; changes merge item by item. See "Cloud sync setup" below.
- **Works offline** — the app saves itself on the device, opens instantly and
  works without signal; a "new version is ready" bar offers updates.
- **Data** — saved in your browser; export/restore JSON backups, export CSV, undo
  (Ctrl/Cmd+Z), dark mode, and a phone-friendly layout.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # budget math tests
npm run build    # static site in dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`. One-time setup: in the repo go to **Settings → Pages** and set
**Source** to **GitHub Actions**.

## Cloud sync setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. In Authentication → Emails → Magic Link, make the email include `{{ .Token }}`
   (the app signs in with the 6-digit code, which also works in home-screen apps).
3. Put the project URL and anon/publishable key in `.env`. Both are public by
   design; row-level security limits each account to its own rows.

Each budget item (account, category, transaction, assigned amount, …) is one row
in `budget_records`. A device pushes the items that changed since its last sync,
then pulls items other devices changed. The newest write to an item wins, and
unsent local edits are never overwritten. Code: `src/lib/sync/`.

## How the budget math works

All amounts are stored as integer cents. For each month and category:

- `available = left over from last month (if positive) + assigned + activity`
- Negative balances don't roll over; the overspending is subtracted from the
  next month's Ready to Assign.
- `Ready to Assign = income to date − everything assigned − past overspending`

The core logic lives in `src/lib/budget.ts` (calculations) and `src/lib/ops.ts`
(changes to data), with tests in `src/lib/budget.test.ts`.

## Not yet built

Bank syncing and age-of-money.

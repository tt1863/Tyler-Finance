# Tyler Finance

A personal zero-based (envelope) budgeting app, inspired by how YNAB works.
Give every dollar a job: assign the money you have to categories, spend from
them, and move money around when plans change.

## Features

- **Budget** — monthly view with Assigned / Activity / Available per category,
  a "Ready to Assign" total, category groups, hide/reorder, month-to-month
  rollover, and overspending that comes out of next month's Ready to Assign.
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
- **Reconcile** — match the cleared balance to your bank and lock it in.
- **CSV import** from your bank, with duplicate detection.
- **Reports** — spending by category/group, income vs spending, net worth.
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

## How the budget math works

All amounts are stored as integer cents. For each month and category:

- `available = left over from last month (if positive) + assigned + activity`
- Negative balances don't roll over; the overspending is subtracted from the
  next month's Ready to Assign.
- `Ready to Assign = income to date − everything assigned − past overspending`

The core logic lives in `src/lib/budget.ts` (calculations) and `src/lib/ops.ts`
(changes to data), with tests in `src/lib/budget.test.ts`.

## Not yet built

Bank syncing, scheduled/recurring transactions, split transactions,
multi-device sync / login, and age-of-money.

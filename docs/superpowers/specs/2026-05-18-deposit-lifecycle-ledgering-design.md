# Deposit Lifecycle Ledgering

> Make the security-deposit lifecycle (collection, refund, withholding) visible in the tenant statement and a new Expenses view, by tracking each deposit as a chargeable invoice — without changing the just-shipped deposit-refund math.

**Date:** 2026-05-18
**Status:** Design

---

## Problem

OneReal never books the deposit lifecycle into tenant-facing ledgers. Two concrete symptoms reported:

1. **A $1,600 deposit refund is invisible.** The refund correctly creates an `expenses` row of type `deposit_refund` ([20260506000002_deposit_refunds.sql:335-344](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L335-L344)). But:
   - `get_tenant_statement` builds its ledger only from receivable invoices, late fees, payments, and credits — it has **no `expenses` branch at all** ([20260327000001_statement_rpcs.sql:26-136](../../../supabase/migrations/20260327000001_statement_rpcs.sql#L26-L136)).
   - The "Outgoing" page lists **payable invoices**, not the `expenses` table ([outgoing/page.tsx:61-70](../../../apps/web/app/(dashboard)/accounting/outgoing/page.tsx#L61-L70)).
   - `useExpenses` is rendered in exactly one place — the per-vendor page ([contacts/providers/[id]/page.tsx:45](../../../apps/web/app/(dashboard)/contacts/providers/%5Bid%5D/page.tsx#L45)) — and a deposit refund has no vendor.
   - It *does* appear in the **property** statement's direct-expenses branch, so the money is not lost — just unreachable from the tenant statement or any expense list.

2. **A collected deposit is invisible.** Entering `lease.deposit_amount` ledgers nothing — no invoice, no income, no transaction. Verified: zero `income` rows with `income_type='deposit'` exist org-wide; `deposit_amount` is a plain numeric column ([20260314000002_portfolio_tables.sql:42](../../../supabase/migrations/20260314000002_portfolio_tables.sql#L42) is the unit-level field; the lease-level field is set via [lease-schema.ts:11](../../../modules/contacts/src/schemas/lease-schema.ts#L11)). A new tenant's $3,600 deposit on 33-DowSt shows only as "Held" on the Deposit card and nowhere else.

Both symptoms predate, and are independent of, the invoice-based deposit-deductions feature ([2026-05-14 spec](2026-05-14-invoice-deposit-deductions-design.md)), whose Assumptions section explicitly flagged "reconciling stated-vs-collected deposits" as out of scope. This spec closes that gap.

---

## Requirements

1. **Deposit tracked as a chargeable invoice.** Each lease's deposit is represented by one receivable invoice (`is_deposit = true`), reusing the existing invoice → payment → income → statement plumbing.
2. **Auto-create on lease create/activate.** When a lease is created with, or transitions to, `status ∈ ('active','month_to_month')` and `deposit_amount > 0`, a deposit invoice is created `open` (the tenant owes it; they pay via the normal payment flow). Idempotent — never a second non-void deposit invoice per lease. Later edits to `deposit_amount` do **not** auto-adjust the invoice.
3. **Backfill existing active leases.** A one-time migration creates the deposit invoice **and** a matching payment + `deposit` income for every lease with `deposit_amount > 0`, `status ∈ ('active','month_to_month')`, and no existing non-void deposit invoice — treating those deposits as already collected. Fixes 33-DowSt's $3,600. Expired/terminated leases are out of scope for backfill.
4. **`lease.deposit_amount` remains the authoritative "Held".** `get_lease_deposit_summary`, the over-refund guard, and the entire deposit-refund feature are **unchanged**. The deposit invoice is a collection-tracking / visibility artifact only — no double-count, no regression to the just-shipped feature.
5. **Deposit is a separate sub-ledger on the tenant statement.** Deposit charge, deposit payment, deposit refund, and deposit settlements appear as deposit-flagged lines that do **not** roll into the rent receivable `running_balance`. The rent ledger stays accounting-correct; the deposit gets its own running total.
6. **Expenses page.** A new `Accounting → Expenses` page lists all `expenses` rows (the expense ledger), with `deposit_refund` rows read-only. "Outgoing" remains payable vendor invoices.

### Non-goals (v1)

- **Changing the deposit-refund math.** Requirement 4 is absolute: zero changes to `get_lease_deposit_summary`, `create_deposit_refund`, `void_deposit_refund`, `void_payment`, or `deposit_refund*` tables.
- **Keeping the deposit invoice synced to `deposit_amount`.** Edits after creation are manual (void + reissue).
- **Backfilling expired/terminated leases.** Their deposits are handled by the refund feature; a backfilled "collected" line on a closed lease is noise.
- **Partial deposit collection UX.** The deposit invoice uses the standard partial-payment behavior already in the invoice/payment system; no special UI.
- **A deposit liability account / double-entry accounting.** The sub-ledger is presentational, not a GL.

---

## Assumptions

- The deposit invoice reuses the existing receivable-invoice machinery: `next_invoice_number(p_org_id)` ([20260315000009_fix_invoice_number_function.sql:7](../../../supabase/migrations/20260315000009_fix_invoice_number_function.sql#L7)), `payments`, `income` (`income_type='deposit'` is already valid — [20260326000001_credits.sql:9-10](../../../supabase/migrations/20260326000001_credits.sql#L9-L10)), and the statement RPC.
- `invoices.tenant_id` is nullable; the primary tenant is resolved like `create_deposit_refund` does — `lease_tenants` ordered by `created_at ASC LIMIT 1` ([20260506000002_deposit_refunds.sql:263-267](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L263-L267)).
- `leases.status` valid set is `('draft','active','expired','terminated','month_to_month')` ([20260315000012_lease_charges.sql:57-59](../../../supabase/migrations/20260315000012_lease_charges.sql#L57-L59)).
- The deposit *refund* and *settlement* statement lines are derived from existing rows (`expenses` of type `deposit_refund`, and `deposit_refund_invoice_settlements`); this spec adds no new write path for them — only statement read branches.

---

## Data Model

### `invoices` — one new column

| Column | Type | Notes |
|---|---|---|
| `is_deposit` | `BOOLEAN NOT NULL DEFAULT false` | Marks the security-deposit invoice. Used to (a) route into the deposit sub-ledger and (b) **exclude from the rent `running_balance`**. |

```sql
ALTER TABLE public.invoices
  ADD COLUMN is_deposit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_invoices_deposit
  ON public.invoices (lease_id)
  WHERE is_deposit = true;
```

The partial index supports the idempotency check ("does a non-void deposit invoice exist for this lease?"). No other schema changes. `deposit_refunds`, `deposit_refund_invoice_settlements`, and `leases.deposit_amount` are untouched (Requirement 4).

**Why a column, not a heuristic or a new table:** a description/`income_type` match is fragile (the codebase already has one hacky `description LIKE '%deposit%'` heuristic in `record_payment_with_overpayment` — not extended here). A separate `deposit_charges` table would discard the invoice→payment→income→statement plumbing the receivable-invoice approach exists to reuse.

---

## Backend (RPC + migration)

A single migration `20260518000001_deposit_lifecycle_ledgering.sql`:

1. `ALTER TABLE invoices ADD COLUMN is_deposit` + partial index.
2. `CREATE` the `create_lease_deposit_invoice` RPC.
3. `CREATE OR REPLACE get_tenant_statement` (add deposit sub-ledger; exclude deposits from rent unions).
4. `CREATE OR REPLACE create_deposit_refund` adding `AND i.is_deposit = false` to its Step-7 invoice-eligibility query (body-only, identical 9-arg signature → clean replace, no `DROP`; Resolved Decision 2).
5. Backfill block (Section "Backfill").

(This 5-step list is authoritative and matches "Migration & Rollout" below.)

### RPC: `create_lease_deposit_invoice`

```
create_lease_deposit_invoice(
  p_org_id     UUID,
  p_lease_id   UUID,
  p_mark_paid  BOOLEAN DEFAULT false
) RETURNS JSONB    -- { invoice_id, status, skipped }
```

`SECURITY DEFINER`. Algorithm:

1. **Authorize:** `p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) → RAISE` (mirrors the deposit-refund RPCs). The backfill block invokes it from the migration (definer/superuser) so the guard is bypassed there by design.
2. **Idempotency:** if a non-void `invoices` row exists with `lease_id = p_lease_id AND is_deposit = true` → return `{ skipped: true }`, no-op.
3. **Resolve lease:** lock the lease; require `deposit_amount > 0` (else `RAISE 'Lease has no deposit on file'`). Read `unit_id → property_id`, `start_date`. Resolve primary `tenant_id` via `lease_tenants ORDER BY created_at ASC LIMIT 1` (`RAISE` if none — same contract as `create_deposit_refund`).
4. **Create the invoice:** `direction='receivable'`, `is_deposit=true`, `amount=deposit_amount`, `amount_paid=0`, `status='open'`, `description='Security deposit'`, `invoice_number=next_invoice_number(p_org_id)`, `due_date=lease.start_date`, `issued_date=CURRENT_DATE`, tenant/lease/property/unit set. Capture `v_invoice_id`.
5. **If `p_mark_paid` (backfill path) — ordering is load-bearing, do not reorder:**
   - INSERT `income` **first** — `income_type='deposit'`, `amount=deposit_amount`, `description='Security deposit collected ' || invoice_number`, `transaction_date=lease.start_date`, property/unit. Capture `v_income_id`.
   - INSERT `payments` **second, carrying `income_id=v_income_id`** — `invoice_id=v_invoice_id`, `amount=deposit_amount`, `payment_date=lease.start_date`, `payment_method='other'`, `notes='Backfilled deposit collection'` (no `expense_id`; `status='active'`).
   - UPDATE the invoice `amount_paid=deposit_amount, status='paid'`.
   - **Invariant (why this ordering matters):** the property statement's "Direct income (manual entries only)" union excludes income that has a linked payment via `NOT EXISTS (SELECT 1 FROM payments px WHERE px.income_id = inc.id)` ([20260327000001_statement_rpcs.sql:293-295](../../../supabase/migrations/20260327000001_statement_rpcs.sql#L293-L295)). The payment **must** carry `income_id` so the backfilled deposit income is excluded there and is not double-surfaced (once as the manual-income line, once as the deposit collection). A planner who inserts the payment without `income_id`, or omits the payment, silently double-counts every backfilled deposit in every property statement.
6. Return `{ invoice_id, status, skipped:false }`.

`payment_method='other'` for backfill because the historical collection method is unknown. Provenance of the live CHECK set: `20260315000008_billing_tables.sql:93` defined `('cash','check','bank_transfer','online','other')`; `20260315000010_add_card_payment_method.sql` added `'card'`; the 2026-05-14 migration ([20260514000001_invoice_deposit_deductions.sql:19-21](../../../supabase/migrations/20260514000001_invoice_deposit_deductions.sql#L19-L21)) dropped+recreated it as `('cash','check','bank_transfer','online','other','deposit')` — silently removing `'card'`. The live set therefore contains `'other'` (valid here) and `'deposit'`; `'deposit'` specifically means "paid *from* a held deposit" (settlement semantics) so it must not be reused for a deposit *collection*.

### Backfill (in the migration, after the RPC is created)

```sql
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT l.id AS lease_id, l.org_id
    FROM public.leases l
    WHERE l.deposit_amount IS NOT NULL AND l.deposit_amount > 0
      AND l.status IN ('active','month_to_month')
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.lease_id = l.id AND i.is_deposit = true AND i.status <> 'void'
      )
  LOOP
    PERFORM public.create_lease_deposit_invoice(r.org_id, r.lease_id, true);
  END LOOP;
END $$;
```

Idempotent (re-running the migration is a no-op thanks to the RPC's Step 2). Leases with no resolvable tenant are skipped via the RPC's `RAISE` caught per-iteration — *the loop wraps each call in a `BEGIN/EXCEPTION WHEN OTHERS THEN` sub-block that logs (`RAISE NOTICE`) and continues*, so one bad lease cannot abort the whole backfill.

### `get_tenant_statement` changes

Two coordinated edits ([20260327000001_statement_rpcs.sql:7-137](../../../supabase/migrations/20260327000001_statement_rpcs.sql#L7-L137)):

**(a) Exclude deposits from the rent ledger.** Add `AND i.is_deposit = false` to the existing "Charges", "Late fees", and "Payments" unions so deposit invoices/payments stop feeding the rent `running_balance`.

**(b) Add deposit sub-ledger unions** (new `txn_type` values, all carrying a deposit amount in dedicated output columns — see signature change below):

- `deposit_charge` — the `is_deposit=true` invoice, dated `due_date`. Filter `status NOT IN ('void','draft')` (mirrors the existing rent-charge union's `status NOT IN ('void','draft')`).
- `deposit_payment` — payments on the deposit invoice, dated `payment_date`. **Must filter `p.status <> 'void'`** so a voided deposit payment stops contributing to `deposit_running` (otherwise "deposit held" is silently overstated — `void_payment` retains the payment row and only sets `status='void'`, [20260506000003_void_payment.sql:192-195](../../../supabase/migrations/20260506000003_void_payment.sql#L192-L195)).
- `deposit_refund` — `expenses` where `expense_type='deposit_refund'` and `lease_id` joins to this tenant+property (via the refund's `tenant_id`/`lease_id`/`property_id`), dated `transaction_date`.
- `deposit_settlement` — `deposit_refund_invoice_settlements` joined through `deposit_refunds` (scoped to tenant+property), dated the refund's `refund_date`; description references the settled invoice number. Scope to `deposit_refunds.status='active'` so voided refunds' settlements drop out (consistent with `get_lease_deposit_summary`).

**Scope boundary (do not "fix" adjacent code):** the *existing* rent "Payments" union (statement_rpcs.sql:69-85) has a pre-existing latent bug — it does not filter `p.status='void'`. That is **out of scope** here; do not add a status filter to the rent Payments union (it would change rent `running_balance` for historical voided payments — unrelated churn). The `status<>'void'` filter applies **only** to the new `deposit_payment` union.

**Signature change.** The RETURNS TABLE gains two columns so callers can render the deposit sub-ledger separately:

```
... existing columns ...,
deposit_in   NUMERIC,   -- deposit charge / refund-reversal (money the deposit ledger gains)
deposit_out  NUMERIC,   -- deposit payment in, refund out, settlement out
deposit_running NUMERIC -- SUM(deposit_in - deposit_out) OVER (ORDER BY txn_date, sort_key)
```

The existing `running_balance` window is computed **only** over non-deposit rows (deposit rows contribute 0 to it). A second window computes `deposit_running` only over deposit rows. This keeps the two ledgers fully isolated in one result set, ordered chronologically.

> Sign convention (deposit sub-ledger, from the landlord's "amount held" perspective) — **decided**: `deposit_payment` collection → held **+** (`deposit_in`); `deposit_charge` is **informational only** (`0/0`, exactly like today's `credit` union which emits `0/0` and contributes nothing to a running balance — it represents an obligation, not cash held); `deposit_refund` and `deposit_settlement` → held **−** (`deposit_out`). This makes `deposit_running` track "cash deposit currently held," matching the Deposit card / `get_lease_deposit_summary.held` mental model.

---

## Server Actions & Hooks

- **`createLease`** ([modules/contacts/src/actions/create-lease.ts](../../../modules/contacts/src/actions/create-lease.ts)) — after the `lease_tenants` rows are inserted and unit-occupancy sync, if `status = 'active'` and `deposit_amount > 0`, call `db.rpc('create_lease_deposit_invoice', { p_org_id, p_lease_id: data.id, p_mark_paid: false })`. Best-effort: a deposit-invoice failure must not fail lease creation (log + continue; lease creation already returns before non-critical sync). Invalidate `['invoices']`.
- **`updateLease`** ([modules/contacts/src/actions/update-lease.ts](../../../modules/contacts/src/actions/update-lease.ts)) — when the update transitions `status` into `'active'` (from a non-active prior status) and `deposit_amount > 0`, call the same RPC with `p_mark_paid:false`. The RPC's idempotency guard makes repeated activations safe.
- **`month_to_month` coverage:** the lease form schema can only emit `('draft','active','expired','terminated')` ([lease-schema.ts:13](../../../modules/contacts/src/schemas/lease-schema.ts#L13)) and `updateLease` treats `month_to_month` as system-managed — so these two actions only ever fire the RPC for `'active'`. `month_to_month` leases are covered solely by the **migration backfill** (which reads `leases.status` directly and includes `month_to_month`). This is acceptable: the RPC is idempotent, so whatever system process transitions a lease to `month_to_month` does not need to also create the invoice — it was created on initial activation. Do not add dead `month_to_month` branches to these two actions.
- **`useEligibleInvoiceSettlements`** ([modules/billing/src/hooks/use-deposit-refunds.ts](../../../modules/billing/src/hooks/use-deposit-refunds.ts)) — **required change (resolves the deposit-invoice-as-settlement-candidate bug):** add `.eq('is_deposit', false)` to the invoice query. Without this, a freshly-created `open` deposit invoice on the lease matches the settlement picker's filter (receivable + open + same lease) and would be offered as a "settle from deposit" candidate — settling a deposit invoice *from the deposit* is nonsensical. The matching server-side guard is in the migration (see Backend / Migration step 4).
- **`useTenantStatement` hook** (wherever the statement is consumed) — pass through the new deposit columns; no query change beyond selecting them (the RPC returns them).
- **`useExpenses`** ([modules/accounting/src/hooks/use-expenses.ts](../../../modules/accounting/src/hooks/use-expenses.ts)) — already exists and is sufficient; no change. (`deposit_refund` expenses have no `provider_id`, so the new page's vendor column is simply null for them — fine.)

No new server action is required for backfill (migration-only).

---

## UI

### Tenant statement — deposit sub-section

The statement renderer splits rows by `txn_type`: existing rent rows render as today with their `running_balance`; deposit-flagged rows (`deposit_charge|deposit_payment|deposit_refund|deposit_settlement`) render in a clearly-labeled **"Security Deposit"** sub-section with the `deposit_running` column. The two sections are visually separated; the rent balance total is unaffected. Locate the statement component via the `get_tenant_statement` consumer; follow its existing table styling.

### `Accounting → Expenses` page (new)

New route `apps/web/app/(dashboard)/accounting/expenses/page.tsx`, mirroring the structure of `outgoing/page.tsx` (date-range buttons, property filter, search) but driven by `useExpenses` instead of `useInvoices`:

- Columns: date, type, property/unit, description, amount, (vendor if any).
- `expense_type` filter dropdown includes `deposit_refund`.
- `deposit_refund` rows are **read-only** (no edit/delete) with a "View refund" affordance — consistent with the existing invariant that refund expenses are managed only via the refund record ([2026-05-06-deposit-refunds-design.md:72](2026-05-06-deposit-refunds-design.md#L72)).
- Add the nav entry next to "Outgoing" / "Incoming".

"Outgoing" is unchanged (payable vendor invoices).

---

## Edge Cases

| Case | Handling |
|---|---|
| Lease created as `draft` | No deposit invoice yet; created when it transitions to active (Req 2 / `updateLease`). |
| `deposit_amount` edited after invoice exists | No auto-adjust (Non-goal). Manager voids + reissues; the void’d invoice's `status='void'` means the idempotency guard allows a fresh one. |
| `deposit_amount` = 0 / NULL | No invoice (RPC Step 3 `RAISE`, caught best-effort by callers/backfill). |
| Lease has no tenant yet at activation | RPC `RAISE`; `createLease` calls it only *after* `lease_tenants` insert, so the primary tenant exists. Backfill skips & logs. |
| Re-running the migration | Idempotent (RPC Step 2 + `NOT EXISTS` in backfill loop). |
| Expired lease (e.g. Destiny) | Not backfilled. Its **refund** still shows on the statement via the `deposit_refund`/`deposit_settlement` unions (independent of a collection invoice). |
| Deposit invoice voided | Excluded from both ledgers (`status='void'` filters in the statement unions, matching the existing `status NOT IN ('void','draft')` pattern). |
| Tenant pays deposit partially | Standard partial-payment behavior; `deposit_payment` lines accumulate; `deposit_running` reflects actual collected. |
| Deposit invoice as a settle-from-deposit candidate | Prevented — `is_deposit=false` added to both `create_deposit_refund`'s eligibility query (migration step 4) and `useEligibleInvoiceSettlements` (Server Actions & Hooks). See Resolved Decisions. |

---

## Resolved Decisions

Both items below were open during design and are **decided** (confirmed in spec review); they are firm requirements, not deferred:

1. **`deposit_charge` is informational (`0/0`).** It contributes nothing to `deposit_running`, exactly like the existing `credit` union ([20260327000001_statement_rpcs.sql:89-97](../../../supabase/migrations/20260327000001_statement_rpcs.sql#L89-L97)). `deposit_running` therefore means "cash deposit currently held," not "expected vs. collected." (See the Sign convention block in Backend.)
2. **Deposit invoices are excluded from the settlement picker** — `AND i.is_deposit = false` is added to `create_deposit_refund`'s invoice-eligibility query (Migration step 4, body-only `CREATE OR REPLACE`, signature-compatible, does not violate the deposit-refund "unchanged" guarantee since it only removes an illegitimate candidate) **and** `.eq('is_deposit', false)` to `useEligibleInvoiceSettlements`. This is in scope because this spec introduces the conflicting `is_deposit` row type.

---

## Migration & Rollout

**Single migration** `20260518000001_deposit_lifecycle_ledgering.sql`:

1. `ALTER invoices ADD COLUMN is_deposit` + partial index.
2. `CREATE FUNCTION create_lease_deposit_invoice`.
3. `CREATE OR REPLACE get_tenant_statement` (deposit sub-ledger + rent-union exclusions + new return columns).
4. `CREATE OR REPLACE create_deposit_refund` adding `AND i.is_deposit = false` to its Step-7 invoice-eligibility query (Resolved Decision 2). **Body-only change, identical 9-arg signature → clean `CREATE OR REPLACE`, no `DROP FUNCTION` needed.** Must run *after* step 1 (the `is_deposit` column must exist).
5. Backfill `DO` block (active/month_to_month leases), *after* step 2 (the RPC must exist).

**Rollout:**
1. Apply via the Supabase CLI link (`npx supabase db push`) — same path as the 2026-05-14 migration; the worktree needs `supabase/.temp` copied in (gitignored).
2. Ship code (statement renderer, Expenses page, `createLease`/`updateLease` wiring, and the `useEligibleInvoiceSettlements` `is_deposit` filter) in one PR/commit.
3. First verification: 33-DowSt active lease shows a paid $3,600 deposit collection in the tenant statement's deposit sub-section; Destiny's $1,600 refund + $250 settlement show as deposit-out lines; rent running balance unchanged for both.

---

## Testing Approach

SQL/manual (no automated suite; `pnpm type-check` is the gate — consistent with prior specs):

1. **Backfill** — pick an active lease with `deposit_amount>0`, run migration → exactly one `is_deposit` invoice, `paid`, with a matching `other` payment + `deposit` income; re-run migration → no duplicates.
2. **33-DowSt** — its $3,600 appears as a paid deposit collection in the statement deposit sub-section.
3. **New-lease open path** — create an active lease with a deposit → one `open` deposit invoice, no payment/income; record a payment via the normal flow → `deposit_payment` line appears, `deposit_running` increases.
4. **Refund visibility** — Destiny: `deposit_refund` ($1,600) and `deposit_settlement` ($250) lines present in the deposit sub-section; her rent `running_balance` unchanged vs. before.
5. **Rent isolation** — a lease with both rent invoices and a deposit: rent `running_balance` excludes the deposit entirely; `deposit_running` excludes rent entirely.
6. **Regression (Req 4)** — `get_lease_deposit_summary`, the over-refund guard, and a full create→void deposit-refund cycle behave identically to pre-change (the deposit-refund feature is untouched).
7. **Expenses page** — lists `deposit_refund` + ordinary expenses; `deposit_refund` rows read-only; filters work.
8. **Idempotency/edges** — draft→active transition creates exactly one invoice; voided deposit invoice allows reissue; zero/NULL deposit creates none.
9. **Financial aggregates shift (expected, document it)** — after backfill, `get_financial_totals` / category breakdown for a historical period containing a backfilled lease's `start_date` increases by exactly that lease's deposit amount (a new `deposit` income category slice appears). This is expected, not a double-count: every normal payment already writes an `income` row these RPCs sum. Verify the **property statement** does NOT show a duplicate manual-income line for the backfilled deposit (confirms the payment correctly carries `income_id`).
10. **Voided deposit payment** — record then void a deposit payment; the `deposit_payment` line and its contribution to `deposit_running` disappear (confirms the `p.status <> 'void'` filter).
11. **Settle-picker exclusion** — a lease with an `open` deposit invoice: it does NOT appear in the refund dialog's invoice-settlement picker, and `create_deposit_refund` rejects it if passed directly (Resolved Decision 2).

---

## Out of Scope (Future)

- Syncing the deposit invoice to later `deposit_amount` edits.
- Backfilling expired/terminated leases.
- A true deposit-liability GL account / double-entry treatment.
- Statutory deposit-handling (interest, jurisdictional deadlines).
- Tenant-portal visibility of the deposit sub-ledger.

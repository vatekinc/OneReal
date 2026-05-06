# Security Deposit Refunds

> Track lifecycle of security deposit refunds — from collection to deductions to refund — with full ledger integration.

**Date:** 2026-05-06
**Status:** Design

---

## Problem

The system can record a deposit being collected (income with `income_type='deposit'`) but has no mechanism to refund it. Specifically:

1. **No expense category** — `expenses.expense_type` enum has no `deposit_refund` option, so a refund payment has nowhere clean to live in the ledger.
2. **No tenant linkage on expenses** — `expenses` only has `provider_id`. A refund is paid to a tenant, not a vendor.
3. **Expired-lease tenants are filtered out** — invoice/expense dialogs only show tenants with `status='active'` leases ([invoice-dialog.tsx:110](../../../apps/web/components/billing/invoice-dialog.tsx#L110)). Once a lease ends, the tenant disappears from the dropdown — even though they're still owed their deposit back.
4. **No accounting trail** — there's no record of "deposit held $X, deductions $Y, refunded $Z" tied to the lease, which is required for tenant disputes and (in many states) statutory itemized statements.

The user's immediate symptom: cannot record a security deposit refund for a tenant whose lease has expired.

---

## Requirements

1. **Refund records tied to a lease** — each refund knows which lease's deposit it draws from.
2. **Multiple refunds per lease (1:N)** — supports phased returns or correction history.
3. **Linked deductions** — withheld amounts reference real `expenses` rows (repairs, cleaning, unpaid rent), not free-text amounts. One source of truth for accounting.
4. **Auto-paired ledger entry** — creating a refund automatically inserts an `expenses` row of type `deposit_refund` so the cash outflow shows up in P&L and Outgoing reports without a second user action.
5. **Over-refund prevention** — the sum of all active refunds + all linked deductions for a lease cannot exceed `lease.deposit_amount`. Hard reject in the RPC.
6. **Reversibility** — voiding a refund deletes the paired expense and frees the linked deductions for re-use on a future refund. Junction rows are deleted on void (no audit trail kept; YAGNI for v1).
7. **UI entry points** — three:
   - Lease detail page — canonical "Deposit" card with held/refunded/withheld/balance + refund history + "Refund Deposit" button.
   - Tenant detail page — small surface on each lease row that opens the refund dialog.
   - Outgoing page — `deposit_refund` filter shows the auto-created expenses naturally.
8. **Works on expired leases** — the new refund dialog must not filter out tenants/leases by status.

### Non-goals (v1)

- Interest on deposits (WV does not require it for residential).
- Statutory deadline tracking (WV is 60 days post-move-out; layer on later as a `due_by` computed column + dashboard widget).
- Itemized PDF statement to the tenant (schema supports it; rendering is future work).
- Multi-tenant deposit splits when a lease has co-tenants — v1 picks `lease_tenants[0]` like invoice generation already does.

---

## Data Model

### `expenses` table — modifications

| Column | Type | Change |
|---|---|---|
| `tenant_id` | UUID FK tenants ON DELETE SET NULL | NEW, nullable |
| `lease_id` | UUID FK leases ON DELETE SET NULL | NEW, nullable |
| `expense_type` CHECK | drop + recreate | adds `'deposit_refund'` |

`tenant_id` and `lease_id` are nullable because most expenses (mortgage, taxes, HOA) are not tied to a lease. They become populated for: deposit refunds (auto), and optionally for repair/cleaning expenses tagged at expense-creation time.

**Constraint update SQL:**

```sql
ALTER TABLE public.expenses DROP CONSTRAINT expenses_expense_type_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_type_check
  CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty',
    'deposit_refund', 'other'
  ));
```

**Property deletion interaction:** `expenses.property_id` is `NOT NULL ON DELETE CASCADE`. If a property is deleted, all its refund expenses are cascaded away, leaving `deposit_refunds.expense_id` as NULL. This is acceptable for v1 — property deletion is a rare destructive operation that already cascades many records. The `deposit_refunds.lease_id ON DELETE RESTRICT` already prevents the more common case of a lease being deleted while refunds exist.

**Invariant on refund expense rows:** rows where `expense_type = 'deposit_refund'` are written and voided exclusively by the deposit-refund RPCs. They are never referenced by `payments` or `invoices`, and the Outgoing UI must render them as read-only (no edit/delete actions) — voiding goes through the refund record.

### `deposit_refunds` table — new

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `org_id` | UUID | FK organizations, NOT NULL |
| `lease_id` | UUID | FK leases ON DELETE RESTRICT, NOT NULL |
| `tenant_id` | UUID | FK tenants ON DELETE RESTRICT, NOT NULL |
| `refund_amount` | DECIMAL(10,2) | NOT NULL, CHECK > 0 |
| `refund_date` | DATE | NOT NULL |
| `payment_method` | TEXT | NOT NULL, CHECK IN (`'check'`, `'ach'`, `'cash'`, `'other'`) |
| `refund_number` | TEXT | NOT NULL, format `DR-YYYY-NNNN`, UNIQUE per org |
| `reference_number` | TEXT | NULLABLE |
| `notes` | TEXT | NULLABLE |
| `expense_id` | UUID | FK expenses ON DELETE SET NULL — paired auto-created expense row |
| `status` | TEXT | NOT NULL, default `'active'`, CHECK IN (`'active'`, `'void'`) |
| `created_by` | UUID | FK auth.users ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` |

**Indexes:**
- `(org_id, lease_id)` — list refunds per lease
- `(org_id, tenant_id)` — list refunds per tenant
- `(org_id, status)` — filter active vs void
- UNIQUE `(org_id, refund_number)` — enforces refund-number uniqueness per org

**Trigger:** `extensions.moddatetime(updated_at)` BEFORE UPDATE — matches the credits/invoices pattern.

### `deposit_refund_deductions` junction — new

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `deposit_refund_id` | UUID | FK deposit_refunds ON DELETE CASCADE, NOT NULL |
| `expense_id` | UUID | FK expenses ON DELETE RESTRICT, NOT NULL |
| `created_at` | TIMESTAMPTZ | default `now()` |
| | | UNIQUE (`deposit_refund_id`, `expense_id`) |

`expense_id` uses `ON DELETE RESTRICT` so we don't lose the deduction reference if someone tries to delete the underlying expense — they must unlink first.

**No `status` column** — deduction-row "active-ness" is derived by joining `deposit_refunds.status = 'active'`. On void, junction rows are deleted (per requirement #6), so an EXISTS check against active refunds is sufficient. The `UNIQUE(deposit_refund_id, expense_id)` constraint prevents duplicates within a single refund; the "no double-count across refunds" rule is enforced by application code (the RPC) since these tables are only written by `SECURITY DEFINER` RPCs — direct writes are blocked by RLS.

**Indexes:**
- `(deposit_refund_id)` — implicit from FK / PK
- `(expense_id)` — covering index for the "is this expense already linked to an active refund?" check in `create_deposit_refund` step 4.

### RLS

Standard `org_id IN get_user_org_ids()` for SELECT, `get_user_managed_org_ids()` for INSERT/UPDATE/DELETE on both new tables — matches the credits and invoices pattern.

**RPC authorization:** Both new RPCs are `SECURITY DEFINER` (matching `apply_credits_to_invoice` and `record_payment_with_overpayment`) and therefore bypass RLS. They MUST include an explicit guard at the top of the function body:

```sql
IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
  RAISE EXCEPTION 'Not authorized for this organization';
END IF;
```

This mirrors the implicit guarantee RLS provides for direct table writes.

---

## Backend (RPCs)

### `create_deposit_refund`

```
create_deposit_refund(
  p_org_id UUID,
  p_lease_id UUID,
  p_refund_amount DECIMAL(10,2),
  p_refund_date DATE,
  p_payment_method TEXT,
  p_reference_number TEXT,
  p_notes TEXT,
  p_deduction_expense_ids UUID[]
) RETURNS JSONB
```

**Algorithm:**

1. **Authorize** — reject if `p_org_id NOT IN get_user_managed_org_ids()` (see RLS section).
2. Lock lease row (`SELECT ... FOR UPDATE`); fetch `deposit_amount`, `units.property_id`, `units.id`, `start_date`, `end_date`. Resolve `tenant_id` via `SELECT tenant_id FROM lease_tenants WHERE lease_id = p_lease_id ORDER BY created_at ASC LIMIT 1` — deterministic primary tenant.
3. Reject if `deposit_amount IS NULL OR deposit_amount = 0` ("Lease has no deposit on file").
4. Reject if `tenant_id` resolution returned NULL ("Lease has no tenants linked").
5. Compute `existing_refunds_total = SUM(refund_amount)` from `deposit_refunds` where `lease_id = p_lease_id AND status = 'active'`.
6. For each `expense_id` in `p_deduction_expense_ids`:
   - Verify it exists, belongs to `p_org_id`, and either: (a) `expense.lease_id = p_lease_id`, or (b) `expense.property_id = lease.property_id` AND `expense.transaction_date >= lease.start_date` AND `expense.transaction_date <= COALESCE(lease.end_date, CURRENT_DATE) + INTERVAL '60 days'`. NULL `end_date` (active month-to-month) is treated as "today" for the upper bound.
   - Verify it is not already linked to an active refund: `NOT EXISTS (SELECT 1 FROM deposit_refund_deductions d JOIN deposit_refunds r ON r.id = d.deposit_refund_id WHERE d.expense_id = <id> AND r.status = 'active')`.
   - Reject the entire RPC with a clear error message naming the offending expense if either check fails.
7. Compute `deductions_total = SUM(expenses.amount)` for the validated expense ids (zero if none).
8. Validate: `existing_refunds_total + deductions_total + p_refund_amount <= lease.deposit_amount`. Reject with: `"Refund of $X plus $Y in deductions exceeds remaining deposit balance of $Z"`.
9. Compute `refund_number` via `next_deposit_refund_number(p_org_id)` (sequence-backed, mirrors `next_invoice_number` pattern). Format: `DR-YYYY-NNNN`.
10. INSERT `expenses` row: `expense_type='deposit_refund'`, `amount=p_refund_amount`, `lease_id=p_lease_id`, `tenant_id=<resolved>`, `property_id`, `unit_id`, `transaction_date=p_refund_date`, `description='Deposit refund <refund_number>'`. Capture `expense_id`.
11. INSERT `deposit_refunds` row with `expense_id` from step 10 and the resolved `tenant_id`.
12. INSERT `deposit_refund_deductions` rows for each validated expense.
13. Return `{refund_id, expense_id, refund_number, balance_remaining}` where `balance_remaining = deposit_amount - existing_refunds_total - deductions_total - p_refund_amount`.

### `get_lease_deposit_summary`

```
get_lease_deposit_summary(p_org_id UUID, p_lease_id UUID)
RETURNS TABLE (held NUMERIC, refunded NUMERIC, withheld NUMERIC, balance NUMERIC, refund_count INT)
```

`SECURITY DEFINER` with the same `p_org_id` authorization guard. Returns aggregated math over `deposit_refunds` (status='active') and their linked deductions for a single lease. The lease detail card and the refund dialog both call this — single source of truth, no client-side recomputation drift.

### `next_deposit_refund_number`

Mirrors `next_invoice_number` ([20260315000009](../../../supabase/migrations/20260315000009_fix_invoice_number_function.sql)) — `SECURITY DEFINER`, uses `pg_advisory_xact_lock(hashtext(p_org_id::TEXT || '_deposit_refund'))` for concurrency, computes max existing sequence by parsing `deposit_refunds.refund_number LIKE 'DR-YYYY-%'` for the current org and year. Returns `DR-YYYY-NNNN`. **Not a Postgres `CREATE SEQUENCE`** — counter state lives in the table, matching the existing pattern.

This requires adding a `refund_number TEXT NOT NULL UNIQUE(org_id, refund_number)` column to `deposit_refunds`.

### `void_deposit_refund`

```
void_deposit_refund(p_org_id UUID, p_refund_id UUID) RETURNS VOID
```

**Algorithm:**

1. **Authorize** — reject if `p_org_id NOT IN get_user_managed_org_ids()`.
2. Lock refund; require `status='active'`. Reject if already void.
3. UPDATE `deposit_refunds` SET `status='void'`.
4. DELETE the paired `expenses` row by `expense_id` — keeps P&L clean. (Safe because the invariant in the schema section guarantees these rows are not referenced by `payments` or `invoices`.)
5. DELETE `deposit_refund_deductions` rows for this refund — frees the linked expenses for use on a future refund.

---

## Server Actions & Hooks

**Server actions** (in `modules/billing/src/actions/` since the module already owns expenses/credits):

- `createDepositRefund(orgId, values)` — calls the RPC, invalidates `['deposit-refunds']`, `['deposit-refunds', leaseId]`, `['expenses']`, `['financial-stats']`.
- `voidDepositRefund(orgId, refundId)` — calls the RPC.

**React Query hooks** (in `modules/billing/src/hooks/`):

- `useDepositRefunds({ orgId, leaseId?, tenantId? })` — list/filter with joined expense + tenant + lease for display.
- `useDepositSummary(orgId, leaseId)` — returns `{ held, refunded, withheld, balance, refund_count }`. Wraps the `get_lease_deposit_summary` RPC. Used by both the lease detail card and the refund dialog header.

---

## UI

### Lease detail page — new "Deposit" card

```
┌─ Deposit ─────────────────────────────────────────  [+ Refund Deposit]
│  Held         $2,000.00
│  Refunded     $1,000.00  (1 refund)
│  Withheld       $300.00  (2 deductions)
│  Balance        $700.00
│
│  Refunds
│  ─────────────────────────────────────────────────────────
│  5/6/2026   $1,000.00  Check #1234   active  [void]
│             Deductions: Carpet repair $200, Cleaning $100
```

- "Refund Deposit" button is disabled with tooltip "No deposit on this lease" when `lease.deposit_amount` is null/zero.
- Button is disabled with tooltip "Deposit fully accounted for" when `balance <= 0`.

### Refund dialog — new component `deposit-refund-dialog.tsx`

```
Refund Deposit — 33-DowSt / Destiny Heaven Graham
Deposit held: $2,000.00 · Already refunded: $0.00 · Withheld: $0.00 · Available: $2,000.00

┌ Deductions (link existing expenses to withhold from refund) ─┐
│ [✓] 4/15/2026  Carpet repair          $200.00              │
│ [✓] 4/20/2026  Cleaning service       $100.00              │
│ [ ] 3/01/2026  Plumbing (during lease) $150.00             │
│ Withheld: $300.00                                          │
│ [ ] Show all expenses for this property during lease window│
└────────────────────────────────────────────────────────────┘

Refund Amount *  [1,700.00]      ← max = available - withheld (live-updated)
Refund Date *    [2026-05-06]
Method *         [Check ▾]
Reference #      [1234]
Notes            [...]

                                              [Cancel] [Refund]
```

**Expense candidates query:**
- Default: `lease_id = p_lease_id` AND `expense_id NOT IN (active deduction rows)`.
- Fallback toggle: also includes `property_id = lease.property_id` AND `transaction_date BETWEEN lease.start_date AND lease.end_date + 60 days`.

### Tenant detail page

Add a small "Deposit" indicator on each lease row in the existing Leases table — clicking opens the same refund dialog. Allows recording a refund without navigating to the lease detail page.

### Outgoing page

- Add `deposit_refund` to the `expense_type` filter dropdown.
- The auto-created refund expenses already render in the table — surfacing the linked tenant name (now stored on the expense) is a small column tweak.
- **Refund-expense rows are read-only here:** edit and delete actions hidden when `expense_type='deposit_refund'`, replaced with a "View refund" link that deep-links to the lease detail page where voiding happens via the refund record. Backstops the schema invariant against stray manual edits orphaning the `deposit_refunds.expense_id`.

### Expense dialog — change

Two changes to support tagging:

1. **Optional tenant selector**, shown when the property is selected. Tenant choices are filtered to those with any lease (active or expired) on the selected property.
2. **`lease_id` is auto-derived**, not a separate UI field — when both property and tenant are picked, the dialog runs the same active-lease lookup the invoice dialog now uses ([invoice-dialog.tsx:122-135](../../../apps/web/components/billing/invoice-dialog.tsx#L122-L135)) and stores the result silently in form state.

**Editing constraint:** if an expense is currently linked as a deduction to an active deposit refund, the update path must reject changes to `tenant_id`, `lease_id`, `property_id`, `amount`, or `transaction_date`. Enforced server-side in `updateExpense` by checking `EXISTS (active deposit_refund_deductions row)` for that expense before applying the update.

---

## Edge Cases

| Case | Handling |
|---|---|
| Lease has no `deposit_amount` | Refund button disabled with tooltip |
| Lease deletion with active refunds | Blocked by `ON DELETE RESTRICT` on `deposit_refunds.lease_id` |
| Voiding a refund whose paired expense was edited | DELETE by id still works; no condition |
| Two refund dialogs racing on same lease | Row lock on lease in RPC step 1 serializes them |
| Expense already linked to another active refund | Caught in RPC step 4 |
| Linked expense from a different property | Caught in RPC step 4 |
| Co-tenants on a lease | v1 picks `lease_tenants[0]`; tenant chooses how to internally split |
| Status filter excludes expired leases in dialogs | New dialog explicitly does not filter by lease status |
| Deduction picker date window | Property+date fallback uses a fixed 60-day grace after `lease.end_date` (NULL end_date treated as `CURRENT_DATE`). Hard-coded constant in the RPC for v1; surface as a setting if statute timelines change. |

---

## Migration & Rollout

**Single migration file** `20260506000002_deposit_refunds.sql`:

1. ALTER `expenses` — add `tenant_id`, `lease_id`, drop+recreate `expense_type` CHECK constraint with `'deposit_refund'`.
2. CREATE `deposit_refunds` + `deposit_refund_deductions` + indexes + RLS policies + `moddatetime` trigger on `deposit_refunds`.
3. CREATE `next_deposit_refund_number(org_id)` RPC (table-backed counter, advisory-lock pattern from `next_invoice_number`).
4. CREATE `create_deposit_refund`, `void_deposit_refund`, and `get_lease_deposit_summary` RPCs.
5. No backfill required — purely additive.

**Rollout steps:**

1. Apply migration via `npx supabase db push`.
2. Ship the code (single PR / commit).
3. First real test: refund Destiny Heaven Graham's 33-DowSt deposit (the case from the user's screenshot that prompted this feature).

---

## Testing Approach

Manual (no test suite exists for accounting flows yet):

1. **Happy path** — full refund, no deductions. Verify expense row created, lease balance ties out.
2. **With deductions** — link two expenses, partial refund. Verify withheld math, junction rows, expense linkage.
3. **Over-refund** — attempt `existing + deductions + new > deposit_amount`. Expect rejection with clear error.
4. **Void** — void a refund. Verify paired expense deleted, junction rows deleted, deductions usable on next refund.
5. **Race** — open two refund dialogs on same lease in two tabs, submit both. Verify second one fails cleanly.
6. **Math check** — lease detail page held/refunded/withheld/balance must tie out across refunds and voids.
7. **Expired-lease tenant** — verify the dialog opens for the expired-lease case from the screenshot.

---

## Out of Scope (Future)

- Statutory deadline tracking and dashboard reminders.
- Itemized statement PDF for tenant.
- Tenant portal visibility into refund status.
- Multi-tenant deposit splits.
- Interest accrual on held deposits.

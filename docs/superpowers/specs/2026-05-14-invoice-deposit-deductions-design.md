# Invoice-Based Deposit Deductions

> Let a receivable invoice (a charge billed to the tenant) be settled directly from a held security deposit during a deposit refund — closing the invoice, recognizing the income, and keeping the deposit math tied out.

**Date:** 2026-05-14
**Status:** Design

---

## Problem

The deposit-refund feature ([2026-05-06-deposit-refunds-design.md](2026-05-06-deposit-refunds-design.md)) lets a manager withhold money from a deposit by linking **expenses** (costs the landlord incurred). The deduction picker, both in the UI and the RPC, reads exclusively from the `expenses` table:

- `useEligibleDeductions` queries `db.from('expenses')` ([use-deposit-refunds.ts:105-123](../../../modules/billing/src/hooks/use-deposit-refunds.ts#L105-L123)).
- `create_deposit_refund` validates `p_deduction_expense_ids` strictly against `expenses` ([20260506000002_deposit_refunds.sql:289-300](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L289-L300)).
- The dialog section is even labeled "Deductions (link existing expenses)" ([deposit-refund-dialog.tsx:145](../../../apps/web/components/billing/deposit-refund-dialog.tsx#L145)).

The user's symptom: a tenant (Destiny) whose lease expired has a $1,850 deposit. The manager created a **receivable invoice** for $250 of move-out repairs (billing the tenant), and wants to refund $1,600. The $250 invoice never appears in the deduction picker because it is an invoice, not an expense — so the refund cannot be completed cleanly.

Modeling a tenant charge as a receivable invoice is the correct instrument for "the tenant owes me for damages." What is missing is a way to satisfy that invoice from the deposit the landlord already holds, in one transaction, without double-counting (tenant owing $250 **and** losing $250 of deposit).

---

## Requirements

1. **Receivable invoices selectable as deductions** — during a deposit refund, the manager can pick eligible receivable invoices for the lease in addition to expenses.
2. **Settle-from-deposit semantics** — selecting an invoice settles its **full outstanding balance** (`amount - amount_paid`) from the deposit: the invoice is marked `paid`, a deposit-sourced `payments` row and an `income` row are created. The tenant no longer owes it. **Only `status IN ('open','partially_paid')` receivable invoices are eligible — `draft` is intentionally excluded** (a draft is not yet a real obligation; the manager must finalize it to `open` first). This is deliberately stricter than `record_payment_with_overpayment`, which rejects only `void`/`paid` and would allow paying a `draft` ([20260326000001_credits.sql:286-288](../../../supabase/migrations/20260326000001_credits.sql#L286-L288)); settling from a held deposit is a higher-stakes, irreversible-feeling action and should not operate on un-finalized charges.
3. **No double-counting (tenant side)** — withholding from the deposit and the invoice settlement are the same event; the tenant is charged exactly once.
4. **Single source of truth for deposit math** — `get_lease_deposit_summary` must fold invoice settlements into `withheld` and `balance`, so the lease/refund UI ties out (Destiny: held 1850 / refunded 1600 / withheld 250 / balance 0). The `create_deposit_refund` over-refund guard must use the **same aggregation** as the summary (see Requirement 6) so the guard and the displayed balance never disagree.
5. **Symmetric reversibility** — voiding a refund fully reverses each invoice settlement: invoice `amount_paid` reduced by the exact deposit-sourced amount, status recomputed *from the resulting `amount_paid`* (not blindly to `open`, so invoices that also took real payments stay correct), and the deposit-sourced `payments` and `income` rows deleted.
6. **Over-refund prevention spanning all active refunds** — the guard rejects when `held − (Σ prior active refund_amount) − (Σ all active expense deductions on the lease) − (Σ all active invoice settlements on the lease) − (this call's new expense deductions) − (this call's new invoice settlements) − p_refund_amount < 0`. It must count prior active expense deductions **and** prior active invoice settlements from *other* refunds on the lease, not just this call's — otherwise phased refunds can over-draw the deposit and the guard will contradict `get_lease_deposit_summary.balance`. (This also corrects a latent narrowness in the original `create_deposit_refund`, whose guard counted only this call's deductions.)
7. **Concurrency-safe** — outstanding balance is recomputed under a row lock at RPC time; an invoice already settled by an active refund cannot be linked again.
8. **Deposit-sourced ledger rows are RPC-owned; the one reachable mutation path must be blocked.** The `payments` and `income` rows a settlement creates (like the existing `deposit_refund` expense row, [2026-05-06-deposit-refunds-design.md:72](2026-05-06-deposit-refunds-design.md#L72)) are written and reversed exclusively by these RPCs. Surface audit (verified): there is **no** standalone income or payments list — the Transactions page is a `ComingSoon` placeholder ([transactions/page.tsx](../../../apps/web/app/(dashboard)/transactions/page.tsx)), and income rows have no UI mutation path. The **only** reachable way to corrupt a settlement is voiding its payment via `payment-dialog.tsx` → the `void_payment` RPC ([20260506000003_void_payment.sql:138](../../../supabase/migrations/20260506000003_void_payment.sql#L138)), which deletes the paired income and reverses the invoice **without** touching `deposit_refund_invoice_settlements` — leaving an orphaned settlement and broken deposit math. Defense (two layers, mirroring the refund-expense "void via the record" invariant): (a) **`void_payment` RPC** rejects with a clear error when the target payment is referenced by a `deposit_refund_invoice_settlements` row ("This payment was created by deposit refund <DR-…>; void that refund instead."); (b) **`payment-dialog.tsx`** hides/disables the void action for `payment_method='deposit'` payments and shows a "Settled from deposit refund — void the refund to reverse" note. The RPC guard is the authority; the UI is convenience. `void_payment` becomes a fourth RPC modified by this migration.

### Non-goals (v1)

- **Partial-amount settlement UI** — a selected invoice always settles its full outstanding balance. The junction stores an explicit `amount` so partial settlement can be added later with no migration churn.
- **Payable invoices** — vendor bills are conceptually expenses, already covered by the expense-deduction path. Out of scope here.
- **Tenant-level / property-window invoice candidates** — eligibility is restricted to receivable invoices whose `lease_id` is exactly this lease (mirrors the default expense filter). The expense path's "show property window" toggle is not mirrored for invoices in v1.
- **Auto-collection of the deposit itself** — see Assumptions; entering `lease.deposit_amount` does not create an invoice/income, and this spec does not change that.

---

## Assumptions

- **`lease.deposit_amount` is a stated figure, not a ledgered collection.** Entering a deposit on the lease creates no invoice, no `lease_charge`, and no income row — confirmed: no `deposit` reference in [lease_charges](../../../supabase/migrations/20260315000012_lease_charges.sql) or [generate-invoices.ts](../../../modules/billing/src/actions/generate-invoices.ts), and `deposit_amount` is a plain numeric field ([lease-schema.ts:11](../../../modules/contacts/src/schemas/lease-schema.ts#L11)). `get_lease_deposit_summary` treats `leases.deposit_amount` as "held" regardless of whether collection was recorded. This spec preserves that behavior; "Held" remains the stated deposit. Reconciling stated-vs-collected deposits is a separate gap, out of scope.
- The new RPC paths are the **only** writers of `deposit_refund_invoice_settlements`; direct table writes are blocked by RLS, so cross-refund uniqueness is enforced in the RPC (same pattern as `deposit_refund_deductions`).

### Accounting model (why a settlement recognizes income)

A receivable invoice represents **earned revenue** — a real amount the tenant owes (e.g. move-out damages billed to them). Settling it from the deposit is a *collection* of that earned revenue using funds the landlord already holds, so recognizing an `income` row equal to the settled balance is correct and necessary; without it the receivable would vanish (invoice → `paid`) with no corresponding income, understating revenue.

This is independent of whether the landlord expensed their own remediation cost: if the manager recorded a repair `expense` (e.g. paid a contractor), P&L nets to ≈$0 (income from tenant offsets the repair cost); if they did not, the settlement correctly books the recovered revenue with no cost — that is an accurate picture (the tenant reimbursed a cost the landlord chose not to separately ledger). The "no double-counting" guarantee (Requirement 3) is strictly about not charging the **tenant** twice (deposit withholding *and* an open invoice); it is not a claim about P&L symmetry, which is intentionally handled by the income-recognition rule stated here.

The paired `deposit_refund` **expense** row created for the cash refund (`p_refund_amount`) is unchanged and unrelated to settlement income — it represents only the cash returned to the tenant.

---

## Data Model

### `payments` table — modification

`payments.payment_method` CHECK is currently `('cash','check','bank_transfer','online','other')` ([20260315000008_billing_tables.sql:93](../../../supabase/migrations/20260315000008_billing_tables.sql#L93)) — no value represents "paid from the held deposit." Add `'deposit'`, mirroring how `expenses.expense_type` was extended with `'deposit_refund'`:

```sql
ALTER TABLE public.payments DROP CONSTRAINT payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash','check','bank_transfer','online','other','deposit'));
```

This keeps the payment ledger self-describing (a settlement payment is visibly deposit-sourced). Fallback if a constraint change is undesirable: use `'other'` with a fixed `notes` marker — rejected here because it makes ledger reporting ambiguous.

### `deposit_refund_invoice_settlements` junction — new

A **separate** junction from `deposit_refund_deductions`. The expense junction has no amount column (it derives from `expenses.amount`) and no financial side-effects; invoice settlement needs an explicit settled amount plus pointers to the rows it creates so void can reverse them precisely. Two clean concepts beat one overloaded table.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `deposit_refund_id` | UUID | FK deposit_refunds ON DELETE CASCADE, NOT NULL |
| `invoice_id` | UUID | FK invoices ON DELETE RESTRICT, NOT NULL |
| `amount` | DECIMAL(10,2) | NOT NULL, CHECK > 0 — outstanding balance settled at refund time |
| `payment_id` | UUID | FK payments ON DELETE SET NULL — the deposit-sourced payment created |
| `income_id` | UUID | FK income ON DELETE SET NULL — the income recognized |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` |
| | | UNIQUE (`deposit_refund_id`, `invoice_id`) |

`invoice_id` uses `ON DELETE RESTRICT` so a settled invoice cannot be hard-deleted out from under a refund. `payment_id`/`income_id` are `ON DELETE SET NULL` so a manual ledger cleanup doesn't orphan the junction; void then deletes whichever of them is still non-null (see `void_deposit_refund`). Each is reversed **independently** so a partial manual deletion (payment deleted, income surviving, or vice versa) still unwinds cleanly. The integrity invariant: these rows are RPC-owned and the ledger UIs render them read-only (Requirement 8), so manual deletion is an out-of-band event the void path tolerates but does not rely on.

**`amount` is exact, not rounded.** `invoices.amount` and `invoices.amount_paid` are `DECIMAL(10,2)`; `amount = invoice.amount − invoice.amount_paid` is computed in SQL as a `DECIMAL(10,2)` difference (no float/round path). Therefore `amount_paid + amount == invoice.amount` exactly, satisfying the `invoices_amount_paid_check (amount_paid <= amount)` constraint ([20260326000001_credits.sql:15-16](../../../supabase/migrations/20260326000001_credits.sql#L15-L16)) with no tolerance margin. Implementers must keep this in integer-cents-equivalent decimal arithmetic and not introduce a numeric/float intermediate.

**Indexes:**
- `(deposit_refund_id)` — implicit via FK / list settlements per refund.
- `(invoice_id)` — covering index for the "is this invoice already settled by an active refund?" check.

**No `status` column** — settlement "active-ness" is derived by joining `deposit_refunds.status = 'active'`, matching `deposit_refund_deductions`. On void the junction rows are deleted.

### RLS

Standard org-scoped policies, identical shape to `deposit_refund_deductions` ([20260506000002_deposit_refunds.sql:98-125](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L98-L125)):

- SELECT: settlement's `deposit_refund_id` belongs to a refund in `get_user_org_ids()`.
- INSERT / DELETE: same, scoped to `get_user_managed_org_ids()`.

Both modified RPCs remain `SECURITY DEFINER` and keep the existing top-of-body authorization guard (`p_org_id NOT IN get_user_managed_org_ids() → raise`).

---

## Backend (RPC changes)

A new migration `20260514000001_invoice_deposit_deductions.sql`:

1. Extend `payments.payment_method` CHECK (above).
2. CREATE `deposit_refund_invoice_settlements` + indexes + RLS.
3. `CREATE OR REPLACE` the three RPCs below (full replace; signature change on `create_deposit_refund`).
4. No backfill — purely additive.

### `create_deposit_refund` — signature & algorithm change

New trailing parameter:

```
create_deposit_refund(
  p_org_id UUID,
  p_lease_id UUID,
  p_refund_amount DECIMAL(10,2),
  p_refund_date DATE,
  p_payment_method TEXT,
  p_reference_number TEXT,
  p_notes TEXT,
  p_deduction_expense_ids UUID[],
  p_settle_invoice_ids UUID[]          -- NEW
) RETURNS JSONB
```

Inserted between the existing expense-deduction handling (current steps 6–7) and the over-refund check (current step 8):

- **De-duplicate** `p_settle_invoice_ids` (same `ARRAY(SELECT DISTINCT unnest(...))` pattern used for expense ids).
- For each invoice id, **lock and validate** (`SELECT ... FOR UPDATE`): exists, `org_id = p_org_id`, `direction = 'receivable'`, `status IN ('open','partially_paid')`, `lease_id = p_lease_id`, and not already linked to an active settlement (`NOT EXISTS` join through `deposit_refund_invoice_settlements` → `deposit_refunds` where `status='active'`). Reject the whole RPC with a message naming the offending invoice if any check fails.
- Compute each invoice's `outstanding = amount - amount_paid` at lock time; reject if `outstanding <= 0` (it was paid since the picker loaded). `v_new_invoice_total = SUM(outstanding)` for this call's invoices.
- **Over-refund check — corrected to span all active refunds on the lease.** The existing migration guard ([line 325](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L325)) is `v_existing_total + v_deductions_total + p_refund_amount > deposit_amount`, where `v_existing_total` is only `SUM(prior active refund_amount)` ([lines 279-282](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L279-L282)) and `v_deductions_total` is only **this call's** expense deductions — prior refunds' deductions are not counted. That is a latent narrowness that becomes a real over-draw path once invoice settlements (which can carry large balances with zero cash `refund_amount`) and phased refunds exist. Replace the guard so it aggregates exactly what `get_lease_deposit_summary` does:

  ```
  v_prior_refunds       := Σ refund_amount        from active deposit_refunds on the lease
  v_prior_expense_ded   := Σ expense.amount       from active deposit_refund_deductions on the lease
  v_prior_invoice_settl := Σ settlement.amount    from active deposit_refund_invoice_settlements on the lease
  IF v_prior_refunds + v_prior_expense_ded + v_prior_invoice_settl
     + v_deductions_total            -- this call's NEW expense deductions
     + v_new_invoice_total           -- this call's NEW invoice settlements
     + p_refund_amount
     > v_lease.deposit_amount
  THEN raise 'Refund of $% + $% deductions + $% invoice settlements exceeds remaining deposit balance of $%'
  END IF;
  ```

  This makes the guard and `get_lease_deposit_summary.balance` provably agree (same terms), satisfying Requirements 4 and 6. Note: the prior-deductions inclusion changes existing behavior for the expense-only path too — this is an intentional correctness fix, called out in the rollout/testing sections.

After the `deposit_refunds` row is inserted (current step 11), for each validated invoice:

1. INSERT `income` — `org_id`, `property_id` and `unit_id` from the invoice, `amount = outstanding`, `income_type = 'other'` (it is damages recovery, not rent/deposit collection; `'other'` is valid per the `income_income_type_check` set), `description = 'Deposit applied to ' || invoice.invoice_number`, `transaction_date = p_refund_date`. Capture `income_id`.
2. INSERT `payments` — `org_id`, `invoice_id`, `amount = outstanding`, `payment_date = p_refund_date`, `payment_method = 'deposit'`, `reference_number = v_refund_number`, `notes = 'Settled from security deposit'`, `income_id` from step 1. Capture `payment_id`.
3. UPDATE `invoices` SET `amount_paid = amount_paid + outstanding`, `status = 'paid'` (outstanding is the full remaining balance by construction → always fully paid).
4. INSERT `deposit_refund_invoice_settlements` row (`deposit_refund_id`, `invoice_id`, `amount = outstanding`, `payment_id`, `income_id`).

Return JSON gains `invoice_settlements_total` and the `balance_remaining` math subtracts it.

### `get_lease_deposit_summary`

Add a fourth aggregate alongside `v_held` / `v_refunded` / `v_withheld`:

```sql
SELECT COALESCE(SUM(s.amount), 0)
  INTO v_invoice_withheld
  FROM public.deposit_refund_invoice_settlements s
  JOIN public.deposit_refunds r ON r.id = s.deposit_refund_id
  WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';
```

`withheld := v_withheld + v_invoice_withheld`; `balance := v_held - v_refunded - withheld`. The returned `withheld` column now represents expense deductions **plus** invoice settlements, so the existing UI tiles need no shape change — only the value updates.

### `void_deposit_refund`

After setting `status='void'` and before the existing expense-deletion logic, for each settlement row of this refund, in this exact order:

1. `SELECT ... FOR UPDATE` the settlement's invoice. **Concurrency note (load-bearing):** `invoices.amount_paid`/`status` are also written by `apply_credits_to_invoice` ([20260326000001_credits.sql:240-242](../../../supabase/migrations/20260326000001_credits.sql#L240-L242)), `record_payment_with_overpayment` ([:326-329](../../../supabase/migrations/20260326000001_credits.sql#L326-L329)), and `reverse_invoice_credit_applications` ([:392-431](../../../supabase/migrations/20260326000001_credits.sql#L392-L431)). Recomputing `status` from the *resulting* `amount_paid` is correct **only because this `FOR UPDATE` serializes against those RPCs, each of which holds an exclusive lock on the invoice row before mutating it** — `apply_credits_to_invoice` and `record_payment_with_overpayment` via explicit `SELECT … FOR UPDATE`, `reverse_invoice_credit_applications` via the row write-lock its bare `UPDATE public.invoices` itself takes. (Do **not** "fix" `reverse_invoice_credit_applications` for a missing explicit lock — it is not missing; the `UPDATE` is the lock.) An implementer must not "optimize" this `SELECT ... FOR UPDATE` away.
2. UPDATE `invoices` SET `amount_paid = amount_paid - settlement.amount`, then `status = CASE WHEN (amount_paid - settlement.amount) <= 0 THEN 'open' WHEN (amount_paid - settlement.amount) < amount THEN 'partially_paid' ELSE 'paid' END` (evaluated on the pre-update values; the `'paid'` ELSE branch covers an invoice still fully covered by other real payments after this settlement is removed). **Why subtract-and-reclassify, not `void_payment`'s sum-of-active-payments recompute:** safe here because a settlement always settles the *full* outstanding balance and its deposit-sourced payment is deleted in this same transaction, so subtracting the exact `settlement.amount` is provably equal to recomputing from remaining payments. Do not "harmonize" this with `void_payment`'s approach — the simpler form is correct for this constrained case.
3. DELETE the `payments` row by `settlement.payment_id` **if non-null** (it may have been manually deleted out-of-band → already SET NULL; skip silently).
4. DELETE the `income` row by `settlement.income_id` **if non-null** (independent of step 3 — partial manual cleanup is tolerated).
5. DELETE the `deposit_refund_invoice_settlements` row explicitly. (Do **not** rely on `deposit_refunds` CASCADE — explicit deletion here keeps ordering decisive and matches how the existing `void_deposit_refund` deletes `deposit_refund_deductions` before the paired expense, [20260506000002_deposit_refunds.sql:411-414](../../../supabase/migrations/20260506000002_deposit_refunds.sql#L411-L414).)

Order: the full settlement reversal (steps 1–5 for every settlement) runs before the existing paired-refund-expense deletion, mirroring how the existing void deletes junction rows before the expense.

---

## Server Actions & Hooks

- **`createDepositRefund(orgId, values)`** ([create-deposit-refund.ts](../../../modules/billing/src/actions/create-deposit-refund.ts)) — pass `p_settle_invoice_ids: parsed.data.settle_invoice_ids`. Add `['invoices']` and `['payments']` to the invalidated query keys (settlement mutates them).
- **`deposit-refund-schema.ts`** — add `settle_invoice_ids: z.array(z.string().uuid()).default([])`.
- **`use-deposit-refunds.ts`** — new hook `useEligibleInvoiceSettlements(orgId, leaseId)`: select `invoices` where `org_id=orgId`, `direction='receivable'`, `status in ('open','partially_paid')`, `lease_id=leaseId`; exclude invoices already in an active settlement (same client-side filter pattern `useEligibleDeductions` uses for linked expenses). Return `{ id, invoice_number, description, amount, amount_paid, outstanding: amount-amount_paid, due_date }`. `useDepositRefunds`'s select gains a `settlements:deposit_refund_invoice_settlements(amount, invoice:invoices(invoice_number, description))` join for history display.

---

## UI — `deposit-refund-dialog.tsx`

A second list section directly below the existing "Deductions (link existing expenses)" block:

```
┌ Invoice settlements (apply deposit to unpaid tenant charges) ─┐
│ [✓] INV-2026-0042  Move-out repairs        $250.00            │
│ [ ] INV-2026-0051  Late fee — April         $75.00            │
│ Settling: $250.00                                             │
└───────────────────────────────────────────────────────────────┘
```

- New form state `settle_invoice_ids` (parallel to `deduction_expense_ids`), toggled by checkbox; amount shown is the invoice's `outstanding`.
- The "Withheld (selected)" summary tile and the `withheld` / `available` / `maxRefundable` math ([deposit-refund-dialog.tsx:68-80](../../../apps/web/components/billing/deposit-refund-dialog.tsx#L68-L80)) add the selected invoices' outstanding balances alongside expense deductions.
- Empty state: "No unpaid receivable invoices for this lease." when the list is empty.
- On submit, `settle_invoice_ids` is included in the values passed to `createDepositRefund`.
- The picker is best-effort/stale by design (client-side exclusion, like `useEligibleDeductions`); the RPC is the authority. If a stale pick is submitted, the RPC rejects with a clear message and the dialog surfaces it via the existing `toast.error(result.error)` path — no silent failure.

### `deposit-card.tsx` — explicit change

`deposit-card.tsx` currently renders only `r.deductions` ([deposit-card.tsx:148-160](../../../apps/web/components/billing/deposit-card.tsx#L148-L160)). It must be modified to also render the new `settlements` array (provided by the `useDepositRefunds` select join added in Server Actions & Hooks) on each refund row, e.g. `Settled invoices: Move-out repairs $250.00`. This is a required file change, listed in the Files Changed summary below so planning does not drop it.

### Files changed (summary)

| File | Change |
|---|---|
| `supabase/migrations/20260514000001_invoice_deposit_deductions.sql` | New migration (CHECK extend, junction, 3 RPC replaces) |
| `modules/billing/src/schemas/deposit-refund-schema.ts` | Add `settle_invoice_ids` |
| `modules/billing/src/actions/create-deposit-refund.ts` | Pass `p_settle_invoice_ids`; invalidate `['invoices']`, `['payments']` |
| `modules/billing/src/hooks/use-deposit-refunds.ts` | New `useEligibleInvoiceSettlements`; add `settlements:` join to `useDepositRefunds` |
| `apps/web/components/billing/deposit-refund-dialog.tsx` | Invoice-settlement list section + math |
| `apps/web/components/billing/deposit-card.tsx` | Render `settlements` in refund history |
| `apps/web/components/billing/payment-dialog.tsx` | Hide/disable void for `payment_method='deposit'` payments (Requirement 8b) |

The `void_payment` RPC change (Requirement 8a) is part of the migration row above. No Transactions/Income-list work — that surface does not exist (verified `ComingSoon` placeholder).

---

## Edge Cases

| Case | Handling |
|---|---|
| Invoice partially paid by real cash after picker loads | Outstanding recomputed under `FOR UPDATE` at RPC time; only the true remaining balance is settled |
| Invoice fully paid after picker loads | RPC rejects (`status` no longer `open/partially_paid`, or `outstanding <= 0`) with a clear message |
| Same invoice linked to two refund dialogs racing | Invoice row lock in the RPC serializes; second fails the "already on an active settlement" check |
| Invoice already settled by an active refund | Caught in validation (mirrors expense double-link rule) |
| Invoice on a different lease/property | Excluded by `lease_id = p_lease_id` filter |
| Void after invoice received an unrelated real payment | Status recomputed from resulting `amount_paid`, not forced to `open` |
| Real `record_payment` attempted on an already-settled invoice | Invoice is `paid`; existing `record_payment_with_overpayment` already rejects `paid` invoices ([20260326000001_credits.sql:286-288](../../../supabase/migrations/20260326000001_credits.sql#L286-L288)) — no conflict |
| Selecting both an invoice and a separate expense | Independent paths; both fold into the single over-refund check and the `withheld` total |
| Phased refunds: refund #1 settled an invoice, refund #2 created later on same lease | Over-refund guard (Req 6) sums *prior active* settlements + deductions + refunds, so #2 cannot over-draw; guard matches `get_lease_deposit_summary.balance` |
| `draft` receivable invoice the manager wants to settle | Rejected by the `status IN ('open','partially_paid')` filter; manager must finalize the invoice to `open` first (intentional, Req 2) |
| Manager tries to void the deposit-sourced payment via payment-dialog | `void_payment` RPC rejects (Req 8a); dialog hides the action (Req 8b). Reversal only via voiding the deposit refund |
| Deposit-sourced payment/income manually removed out-of-band | Junction `payment_id`/`income_id` → NULL via `ON DELETE SET NULL`; void skips the null side, reverses the other independently; deposit math self-heals on void |
| Deposit not actually collected on the books | Out of scope (see Assumptions); "Held" remains the stated `lease.deposit_amount` |

---

## Migration & Rollout

**Single migration** `20260514000001_invoice_deposit_deductions.sql`:

1. Extend `payments.payment_method` CHECK (drop + recreate) to add `'deposit'`.
2. CREATE `deposit_refund_invoice_settlements` + indexes + RLS policies.
3. `CREATE OR REPLACE` four RPCs: `create_deposit_refund` (new signature + corrected over-refund aggregation), `get_lease_deposit_summary`, `void_deposit_refund`, and `void_payment` (Requirement 8a guard).
4. No backfill. **Behavior change to flag:** the corrected over-refund guard now also counts prior active *expense* deductions on the lease (Requirement 6) — stricter than before for the existing expense-only path. Intentional; covered in Testing case 6.

**Caller-compatibility note:** `create_deposit_refund` gains a required `p_settle_invoice_ids` argument. The Supabase RPC is called by name with a params object ([create-deposit-refund.ts](../../../modules/billing/src/actions/create-deposit-refund.ts)), so the action and migration ship in the **same PR/commit**; there are no other callers (verified — only the billing action invokes it).

**Rollout:**

1. Apply migration via `npx supabase db push`.
2. Ship the code (single commit; remember the dual push to `origin/master` and `azdo master:main` per project convention).
3. First real test: Destiny's lease — settle the $250 move-out invoice, refund $1,600, confirm balance $0 and the invoice shows `paid`.

---

## Testing Approach

SQL/pgTAP-style checks for the RPC (or scripted via the Supabase SQL editor, matching the manual approach of the prior deposit spec):

1. **Settle path** — refund $1,600 with the $250 invoice selected → invoice `paid`, `amount_paid=250`, one `payments` row (`method='deposit'`), one `income` row, one settlement junction row, summary `withheld=250 / balance=0`.
2. **Over-refund guard** — expense deductions + invoice settlements + refund > `deposit_amount` → rejected with the extended message.
3. **Void reversal** — void the refund → invoice back to `open` (`amount_paid=0`), `payments` and `income` rows deleted, junction row gone, paired refund expense deleted (existing behavior intact).
4. **Double-link rejection** — attempt to settle an invoice already on an active refund → rejected.
5. **Stale picker** — pay the invoice via the normal flow, then attempt settlement → rejected (`status`/`outstanding` check).
6. **Mixed + corrected guard regression** — one expense deduction + one invoice settlement on one refund → both in `withheld`, math ties out. Plus an explicit regression for the behavior change: two refunds on one lease where refund #1 has an expense deduction; refund #2's guard must count refund #1's deduction (previously it did not) and reject an over-draw — guard result must equal `get_lease_deposit_summary.balance`.
7. **Void with intervening payment** — partially pay an invoice with cash, settle the remainder from deposit, void → status recomputes to `partially_paid`, not `open`; only the deposit-sourced payment/income deleted, the cash payment untouched.
8. **void_payment guard** — attempt `void_payment` on a deposit-sourced payment → rejected with the Req 8a message; the invoice/settlement remain intact.
9. **Phased refunds** — refund #1 settles invoice A (zero cash refund); refund #2 attempts a cash refund that, combined with #1's settlement, exceeds the deposit → rejected by the spanning guard.
10. **UI walkthrough** — the exact Destiny scenario end-to-end; the empty-state message when a lease has no receivable invoices; and the payment-dialog hiding void for a deposit-sourced payment.

---

## Out of Scope (Future)

- Partial-amount invoice settlement (UI + per-row amount entry; schema already supports it).
- Settling payable invoices / tenant-level / property-window invoice candidates.
- Reconciling stated `lease.deposit_amount` against actually-collected deposit income.
- Itemized move-out statement (deposit held → deductions → invoices settled → refunded) PDF for the tenant.
- Tenant-portal visibility into settled charges.

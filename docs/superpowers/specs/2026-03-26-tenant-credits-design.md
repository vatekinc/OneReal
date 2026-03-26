# Tenant Credits System

> Allow landlords to issue credits to tenants that can be applied to future rent invoices.

**Date:** 2026-03-26
**Status:** Design

---

## Problem

The system has no mechanism to handle:
- Overpayments (tenant pays more than owed)
- Goodwill credits (landlord discounts for maintenance inconvenience, move-in deals)
- Advance payments (tenant pays future rent before the invoice exists)

Currently, the only option is to void an invoice entirely. There's no way to partially adjust or carry forward a balance.

---

## Requirements

1. **Credit Sources:**
   - `manual` — Landlord-issued goodwill credit (reason required)
   - `overpayment` — Auto-created when a payment exceeds invoice balance
   - `advance_payment` — Tenant pays ahead before an invoice exists

2. **Credit Scope:** Tenant-level by default, optionally scoped to a specific lease.

3. **Application:** Manual only — landlord chooses when and to which invoice a credit is applied. No auto-application during invoice generation.

4. **UI Locations:**
   - Credits tab in accounting section (`/accounting/credits`)
   - Credit summary widget on tenant detail page

---

## Data Model

### `credits` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default gen_random_uuid() | Primary key |
| `org_id` | UUID | FK organizations, NOT NULL | Organization |
| `tenant_id` | UUID | FK tenants, NOT NULL | Credit belongs to this tenant |
| `lease_id` | UUID | FK leases, NULLABLE | Optional lease scope |
| `property_id` | UUID | FK properties, NULLABLE | Denormalized for filtering |
| `amount` | DECIMAL(10,2) | NOT NULL, > 0 | Original credit amount |
| `amount_used` | DECIMAL(10,2) | NOT NULL, default 0, CHECK (amount_used <= amount) | Amount applied to invoices |
| `reason` | TEXT | NOT NULL | Description/justification |
| `source` | TEXT | NOT NULL, CHECK IN ('manual', 'overpayment', 'advance_payment') | How the credit was created |
| `invoice_id` | UUID | FK invoices, NULLABLE | Source invoice (overpayment only) |
| `status` | TEXT | NOT NULL, default 'active', CHECK IN ('active', 'fully_applied', 'void') | Current status |
| `created_by` | UUID | FK auth.users, NULLABLE | User who created the credit |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | Last update timestamp |

**Indexes:**
- `(org_id, tenant_id)` — query credits by tenant
- `(org_id, status)` — filter active credits
- `(org_id, property_id)` — filter by property

**RLS Policies:**
- SELECT: `org_id IN (SELECT get_user_org_ids())`
- INSERT/UPDATE/DELETE: `org_id IN (SELECT get_user_managed_org_ids())`
- Tenant portal: out of scope for now (see Out of Scope section)

### `credit_applications` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default gen_random_uuid() | Primary key |
| `org_id` | UUID | FK organizations, NOT NULL | Organization |
| `credit_id` | UUID | FK credits, NOT NULL | Source credit |
| `invoice_id` | UUID | FK invoices, NOT NULL | Invoice being reduced |
| `amount` | DECIMAL(10,2) | NOT NULL, > 0 | Amount applied |
| `status` | TEXT | NOT NULL, default 'active', CHECK IN ('active', 'reversed') | Application status |
| `applied_by` | UUID | FK auth.users, NULLABLE | User who applied the credit |
| `applied_at` | TIMESTAMPTZ | NOT NULL, default now() | When applied |
| `reversed_at` | TIMESTAMPTZ | NULLABLE | When reversed (if voided) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | Creation timestamp |

**Indexes:**
- `(credit_id)` — application history for a credit
- `(invoice_id)` — credits applied to an invoice
- `(org_id)` — RLS filtering

**Foreign key behavior:**
- `credit_id` — ON DELETE RESTRICT (cannot delete a credit with applications)
- `invoice_id` — ON DELETE CASCADE (matches existing payments FK pattern)

**RLS Policies:** Same pattern as `credits` table.

---

## Overpayment Detection

**Location:** `modules/billing/src/actions/record-payment.ts` calls new RPC `record_payment_with_overpayment`

**Current behavior:** Rejects payments exceeding invoice remaining balance.

**New behavior via RPC function `record_payment_with_overpayment`:**

All steps execute in a single database transaction with row-level locking to prevent race conditions:

1. `SELECT ... FOR UPDATE` on the invoice row to acquire lock
2. Calculate `remaining = amount - amount_paid`
3. If `payment_amount <= remaining`: existing behavior — update invoice, create payment + income record
4. If `payment_amount > remaining`:
   - Apply `remaining` to the invoice (set `amount_paid = amount`, status = `'paid'`)
   - Create payment record for the full `payment_amount`
   - Create income record for the full `payment_amount`
   - Calculate excess: `payment_amount - remaining`
   - Auto-create `credits` record:
     - `amount` = excess
     - `source` = `'overpayment'`
     - `invoice_id` = the overpaid invoice
     - `tenant_id`, `lease_id`, `property_id` inherited from invoice
     - `reason` = `'Overpayment on invoice {invoice_number}'`
   - Return credit info in response for toast notification

**Why RPC:** Sequential Supabase client calls are not wrapped in a transaction. Two concurrent payments on the same invoice could both read the same `amount_paid` and corrupt the balance. The RPC function uses `SELECT ... FOR UPDATE` to serialize access.

---

## Credit Application Flow

**Trigger:** "Apply Credit" action on an open or partially_paid invoice.

**Steps:**
1. Fetch available credits for the invoice's tenant:
   - Status = `'active'`
   - `amount_used < amount`
   - If credit has `lease_id`, it must match the invoice's `lease_id`
   - Tenant-scoped credits (no `lease_id`) available for any invoice
2. User selects credits and enters amounts (defaults to min of credit remaining, invoice remaining)
3. On submit — calls RPC `apply_credits_to_invoice` (single database transaction with row locking):
   - `SELECT ... FOR UPDATE` on the invoice and all selected credit rows
   - Validate: total applied <= invoice remaining balance
   - Validate: per-credit applied <= credit remaining balance
   - For each credit:
     - Insert `credit_applications` record
     - Update `credits.amount_used += applied_amount`
     - If `amount_used >= amount`, set `status = 'fully_applied'`
   - Update `invoice.amount_paid += total_applied`
   - Update invoice status: `paid` if `amount_paid >= amount`, else `partially_paid`
   - Do NOT create an `income` record (see Accounting note below)

**Accounting note:** Credit applications do NOT create income records. The income was already recorded at the point of origin:
- `overpayment` credits: income recorded when the original payment was made
- `advance_payment` credits: income recorded at credit creation time (see Advance Payment section)
- `manual` credits: no cash received, so no income record (it's a discount/write-off)

This avoids double-counting revenue.

**Constraints:**
- Cannot apply more than invoice's remaining balance
- Cannot apply more than credit's remaining balance
- Lease-scoped credits only apply to invoices under that lease
- Cannot apply credits to void or draft invoices

---

## Advance Payment Accounting

When creating a credit with `source = 'advance_payment'`, an `income` record is created immediately:
- `income_type` = `'advance_payment'`
- `amount` = credit amount
- `property_id` = from the credit (or the tenant's active lease property)
- `transaction_date` = credit creation date

This ensures cash received is reflected in financial reports right away. When the credit is later applied to an invoice, no second income record is created (avoiding double-counting).

---

## Invoice Constraint

The migration must add a CHECK constraint to the existing `invoices` table:

```sql
ALTER TABLE public.invoices ADD CONSTRAINT invoices_amount_paid_check CHECK (amount_paid <= amount);
```

This protects against race conditions where concurrent payments and/or credit applications could push `amount_paid` beyond `amount`. This is a safety net for both existing payment flows and the new credit application flow.

---

## Income Type Constraint

The migration must update the `income` table's `income_type` CHECK constraint to allow new types:

```sql
ALTER TABLE public.income DROP CONSTRAINT income_income_type_check;
ALTER TABLE public.income ADD CONSTRAINT income_income_type_check
  CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'advance_payment', 'other'));
```

---

## RPC Functions

### `get_tenant_credit_balance(p_org_id UUID, p_tenant_id UUID, p_lease_id UUID DEFAULT NULL)`

**Returns:** `{ total_credits NUMERIC, total_used NUMERIC, available_balance NUMERIC, active_count INTEGER }`

When `p_lease_id` is provided, returns credits available for that lease (tenant-scoped credits + lease-scoped credits matching that lease). When NULL, returns all credits for the tenant.

```sql
SELECT
  COALESCE(SUM(amount), 0) AS total_credits,
  COALESCE(SUM(amount_used), 0) AS total_used,
  COALESCE(SUM(amount - amount_used), 0) AS available_balance,
  COUNT(*)::INTEGER AS active_count
FROM credits
WHERE org_id = p_org_id
  AND tenant_id = p_tenant_id
  AND status = 'active'
  AND (p_lease_id IS NULL OR lease_id IS NULL OR lease_id = p_lease_id);
```

### `apply_credits_to_invoice(p_org_id UUID, p_invoice_id UUID, p_applications JSONB)`

**Transactional RPC** — acquires `FOR UPDATE` locks on the invoice and all referenced credits. Validates amounts, inserts `credit_applications`, updates `credits.amount_used` and `credits.status`, updates `invoice.amount_paid` and `invoice.status`. Returns applied amounts.

`p_applications` format: `[{"credit_id": "uuid", "amount": 50.00}, ...]`

### `record_payment_with_overpayment(p_org_id UUID, p_invoice_id UUID, p_amount NUMERIC, p_payment_method TEXT, p_payment_date DATE, p_reference_number TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL)`

**Transactional RPC** — acquires `FOR UPDATE` lock on the invoice. Records payment, creates income record, updates invoice. If overpayment detected, creates credit record. Returns `{payment_id, credit_id (nullable), overpayment_amount}`.

### Impact on existing functions

- **`get_invoice_aging`** — No changes. Credit applications increase `amount_paid`, which is already accounted for in outstanding calculations.
- **`get_rent_collection_rate`** — No changes. Credit applications increase `collected_amount` (via `amount_paid`), correctly reflecting that the money was already received.
- **`get_financial_totals`** — Credit application income records are included in totals automatically.

---

## UI Components

### A. Credits Tab (`/accounting/credits`)

**Location:** `apps/web/app/(dashboard)/accounting/credits/page.tsx`

**Table columns:** Date | Tenant | Property | Source | Amount | Used | Remaining | Status

**Filters:** Tenant, Property, Status (active/fully_applied/void), Source (manual/overpayment/advance_payment)

**Actions:**
- "New Credit" button — opens credit creation dialog
- Row actions: Apply to Invoice, Void Credit
- Row expansion or click-through: shows application history

### B. Tenant Detail Credit Widget

**Location:** `apps/web/components/contacts/tenant-credit-widget.tsx`

**Content:**
- Available credit balance (prominent number)
- Active credit count
- Mini table: recent/active credits with remaining amounts
- Quick actions: "Issue Credit", "Record Advance Payment"
- Link to full credits tab filtered by tenant

### C. New Credit Dialog

**Location:** `apps/web/components/billing/credit-dialog.tsx`

**Fields:**
- Source type selector: Manual Credit | Advance Payment
  - (Overpayment is auto-created, not manually selectable)
- Tenant picker (required, searchable)
- Lease picker (optional — "Scope to specific lease" toggle, filtered by selected tenant)
- Amount (required, > 0)
- Reason/notes (required for manual, auto-filled for advance payment)
- Payment method (shown only for advance_payment source)

### D. Apply Credit Dialog

**Location:** `apps/web/components/billing/apply-credit-dialog.tsx`

**Trigger:** "Apply Credit" action on invoice row (visible only if tenant has available credits)

**Content:**
- Invoice summary: number, tenant, amount, remaining balance
- Available credits list (checkboxes):
  - Each row: source badge, date, reason, remaining amount, input for amount to apply
  - Default amount: min(credit remaining, invoice remaining)
- Running total of credit being applied
- Validation: total cannot exceed invoice remaining balance

### E. Invoice Table Updates

- "Apply Credit" in row action dropdown (conditional on tenant having credits)
- Payment history section shows credit applications with distinct "Credit" badge alongside regular payments

---

## Module Structure

### New files in `modules/billing/`:
- `schemas/credit-schema.ts` — Zod schemas for credit creation and application
- `actions/create-credit.ts` — Server action for manual credit / advance payment creation
- `actions/apply-credit.ts` — Server action for applying credits to invoices
- `actions/void-credit.ts` — Server action calling `void_credit` RPC (uses FOR UPDATE locking to prevent races with concurrent applications)
- `hooks/use-credits.ts` — React Query hooks for fetching credits

### Modified files:
- `modules/billing/src/actions/record-payment.ts` — Call overpayment RPC instead of direct updates
- `modules/billing/src/actions/void-invoice.ts` — Handle reversing credit applications before voiding
- `packages/types/src/models.ts` — Add `Credit` and `CreditApplication` interfaces
- Sidebar navigation component — Add "Credits" link under Accounting section
- Tenant detail page — Add credit widget

### New migration:
- `supabase/migrations/YYYYMMDD_credits.sql` — Table creation, indexes, RLS, RPC function

---

## TypeScript Interfaces

```typescript
interface Credit {
  id: string;
  org_id: string;
  tenant_id: string;
  lease_id: string | null;
  property_id: string | null;
  amount: number;
  amount_used: number;
  reason: string;
  source: 'manual' | 'overpayment' | 'advance_payment';
  invoice_id: string | null;
  status: 'active' | 'fully_applied' | 'void';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  tenant?: Tenant;
  lease?: Lease;
  property?: Property;
}

interface CreditApplication {
  id: string;
  org_id: string;
  credit_id: string;
  invoice_id: string;
  amount: number;
  status: 'active' | 'reversed';
  applied_by: string | null;
  applied_at: string;
  reversed_at: string | null;
  created_at: string;
  // Joined fields
  credit?: Credit;
  invoice?: Invoice;
}
```

---

## Edge Cases

1. **Void a credit with partial applications** — Keep `amount` unchanged (preserves audit trail). Set `status = 'void'` via `void_credit` RPC (with `FOR UPDATE` locking). Existing applications stay intact. The remaining balance (amount - amount_used) is effectively zero because voided credits are excluded from available credits queries. For `advance_payment` credits: voiding does NOT reverse the associated income record — the cash was received. If the landlord needs to refund, they handle that separately outside the credits system.
2. **Void an invoice with applied credits** — Must reverse credit applications first (via RPC for transactional safety): reduce `credits.amount_used` for each application, set credit status back to `'active'` if it was `'fully_applied'`, soft-delete `credit_applications` records by setting `status = 'reversed'` (not hard delete, preserves audit trail). Then void the invoice. Note: existing `void-invoice.ts` blocks voiding if `amount_paid > 0` — this needs to be updated to handle credit-only payments by reversing them first.
3. **Delete a tenant with credits** — Blocked if active credits exist (same as existing invoice foreign key protection).
4. **Overpayment on already partially paid invoice** — Works correctly: remaining = `amount - amount_paid`, excess = `payment - remaining`.
5. **Multiple credits applied to one invoice** — Supported via multiple `credit_applications` rows. Total cannot exceed invoice remaining.
6. **One credit applied across multiple invoices** — Supported via partial applications. `amount_used` tracks cumulative usage.
7. **Multi-tenant leases** — Overpayment credits inherit `tenant_id` from the invoice (which already has a single `tenant_id`). A lease-scoped credit belongs to a specific tenant on that lease; it cannot be applied to invoices for a different tenant on the same lease.
8. **Advance payment without a property** — If a tenant-scoped advance payment credit has no `property_id`, the `income` record uses the property from the tenant's most recent active lease. If none found, `property_id` is left NULL (requires removing NOT NULL on income.property_id or using a fallback).

---

## Out of Scope

- Auto-application of credits during invoice generation
- Credit expiration dates
- Credit transfers between tenants
- Tenant portal credit visibility (can be added later)
- Credit reporting/analytics beyond the balance RPC

---

## Version History
- **2026-03-26:** Initial design

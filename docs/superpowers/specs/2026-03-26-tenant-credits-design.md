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
| `amount` | NUMERIC(12,2) | NOT NULL, > 0 | Original credit amount |
| `amount_used` | NUMERIC(12,2) | NOT NULL, default 0, >= 0 | Amount applied to invoices |
| `reason` | TEXT | NOT NULL | Description/justification |
| `source` | TEXT | NOT NULL, CHECK IN ('manual', 'overpayment', 'advance_payment') | How the credit was created |
| `invoice_id` | UUID | FK invoices, NULLABLE | Source invoice (overpayment only) |
| `status` | TEXT | NOT NULL, default 'active', CHECK IN ('active', 'fully_applied', 'void') | Current status |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | Last update timestamp |

**Indexes:**
- `(org_id, tenant_id)` — query credits by tenant
- `(org_id, status)` — filter active credits
- `(org_id, property_id)` — filter by property

**RLS Policies:**
- SELECT: `org_id IN (SELECT get_user_org_ids())`
- INSERT/UPDATE/DELETE: `org_id IN (SELECT get_user_managed_org_ids())`
- Tenant portal: tenants can SELECT credits where `tenant_id` matches their tenant record

### `credit_applications` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default gen_random_uuid() | Primary key |
| `org_id` | UUID | FK organizations, NOT NULL | Organization |
| `credit_id` | UUID | FK credits, NOT NULL | Source credit |
| `invoice_id` | UUID | FK invoices, NOT NULL | Invoice being reduced |
| `amount` | NUMERIC(12,2) | NOT NULL, > 0 | Amount applied |
| `applied_at` | TIMESTAMPTZ | NOT NULL, default now() | When applied |

**Indexes:**
- `(credit_id)` — application history for a credit
- `(invoice_id)` — credits applied to an invoice

**RLS Policies:** Same pattern as `credits` table.

---

## Overpayment Detection

**Location:** `modules/billing/src/actions/record-payment.ts`

**Current behavior:** Rejects payments exceeding invoice remaining balance.

**New behavior:**
1. If `payment_amount > invoice_remaining_balance`:
   - Apply `invoice_remaining_balance` to the invoice (marks it `paid`)
   - Calculate excess: `payment_amount - invoice_remaining_balance`
   - Auto-create `credits` record:
     - `amount` = excess
     - `source` = `'overpayment'`
     - `invoice_id` = the overpaid invoice
     - `tenant_id`, `lease_id`, `property_id` inherited from invoice
     - `reason` = `'Overpayment on invoice {invoice_number}'`
   - Return overpayment info in response for toast notification
2. If `payment_amount <= invoice_remaining_balance`: existing behavior unchanged

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
3. On submit (single transaction):
   - Validate: total applied <= invoice remaining balance
   - Validate: per-credit applied <= credit remaining balance
   - For each credit:
     - Insert `credit_applications` record
     - Update `credits.amount_used += applied_amount`
     - If `amount_used >= amount`, set `status = 'fully_applied'`
   - Update `invoice.amount_paid += total_applied`
   - Update invoice status: `paid` if `amount_paid >= amount`, else `partially_paid`
   - Create `income` record (type = `'credit_applied'`) for accounting sync

**Constraints:**
- Cannot apply more than invoice's remaining balance
- Cannot apply more than credit's remaining balance
- Lease-scoped credits only apply to invoices under that lease
- Cannot apply credits to void or draft invoices

---

## RPC Functions

### `get_tenant_credit_balance(p_org_id UUID, p_tenant_id UUID)`

**Returns:** `{ total_credits NUMERIC, total_used NUMERIC, available_balance NUMERIC, active_count INTEGER }`

**Query:**
```sql
SELECT
  COALESCE(SUM(amount), 0) AS total_credits,
  COALESCE(SUM(amount_used), 0) AS total_used,
  COALESCE(SUM(amount - amount_used), 0) AS available_balance,
  COUNT(*)::INTEGER AS active_count
FROM credits
WHERE org_id = p_org_id
  AND tenant_id = p_tenant_id
  AND status = 'active';
```

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
- `actions/void-credit.ts` — Server action to void a credit
- `hooks/use-credits.ts` — React Query hooks for fetching credits

### Modified files:
- `modules/billing/src/actions/record-payment.ts` — Add overpayment detection
- `packages/types/src/models.ts` — Add `Credit` and `CreditApplication` interfaces

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
  applied_at: string;
  // Joined fields
  credit?: Credit;
  invoice?: Invoice;
}
```

---

## Edge Cases

1. **Void a credit with partial applications** — Only void remaining balance. Existing applications stay intact. Set `amount = amount_used`, status = `'void'`.
2. **Void an invoice with applied credits** — Reverse the credit applications: reduce `credits.amount_used`, set credit status back to `'active'` if it was `'fully_applied'`. Delete the `credit_applications` records.
3. **Delete a tenant with credits** — Blocked if active credits exist (same as existing invoice foreign key protection).
4. **Overpayment on already partially paid invoice** — Works correctly: remaining = `amount - amount_paid`, excess = `payment - remaining`.
5. **Multiple credits applied to one invoice** — Supported via multiple `credit_applications` rows. Total cannot exceed invoice remaining.
6. **One credit applied across multiple invoices** — Supported via partial applications. `amount_used` tracks cumulative usage.

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

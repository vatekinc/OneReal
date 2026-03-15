# Phase 4B: Enhanced Lease Management Design Spec

> **Status:** Approved
> **Date:** 2026-03-15
> **Builds on:** Phase 4A (Invoice System & Accounting Restructure)
> **Reference:** `docs/superpowers/specs/2026-03-15-phase4a-invoice-system-design.md`

---

## Overview

Phase 4B adds three capabilities to the lease and billing system:

1. **Flexible lease charges** — Per-lease additional charges (pet rent, parking, yearly fees, one-time fees) beyond the base rent, each generating its own invoice.
2. **Late fee assessment** — Configurable per-lease late fee settings (flat or percentage, with grace period), creating separate invoices for overdue amounts.
3. **Month-to-month conversion** — Leases auto-convert to month-to-month status when they expire, continuing invoice generation until manually terminated.

Invoice generation remains manual (via the "Generate Invoices" button). Scheduled automation, email notifications, and PDF export are deferred to future phases.

---

## Architecture

**No new modules.** All changes extend existing modules:

- `modules/contacts/` — Lease charge CRUD (actions, hooks, schemas)
- `modules/billing/` — Updated invoice generation logic
- `packages/types/` — New and updated TypeScript interfaces
- `apps/web/` — Updated lease dialog UI

**New database table:** `lease_charges`
**Modified tables:** `leases` (late fee config + M2M flag + new status), `invoices` (charge linkage + late fee linkage)

---

## Database Schema

### New Table: `lease_charges`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| org_id | UUID | FK → organizations, NOT NULL |
| lease_id | UUID | FK → leases ON DELETE CASCADE, NOT NULL |
| name | TEXT | NOT NULL (e.g., "Pet Rent", "Parking", "Admin Fee") |
| amount | DECIMAL(10,2) | NOT NULL, CHECK (amount > 0) |
| frequency | TEXT | NOT NULL, CHECK IN ('monthly', 'yearly', 'one_time') |
| start_date | DATE | NOT NULL (when billing starts for this charge) |
| end_date | DATE | nullable (null = ongoing until lease ends; for one_time: set equal to start_date) |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

**RLS:** Same org-based pattern as all other tables — `get_user_org_ids()` for SELECT, `get_user_managed_org_ids()` for INSERT/UPDATE/DELETE.

**Indexes:**
- `(lease_id)` — for fetching charges by lease
- `(org_id, is_active)` — for org-wide queries

### Modified Table: `leases`

**New columns:**

| Column | Type | Notes |
|--------|------|-------|
| late_fee_type | TEXT | nullable, CHECK IN ('flat', 'percentage'). null = no late fees configured. |
| late_fee_amount | DECIMAL(10,2) | nullable. Dollar amount (if flat) or percentage value (if percentage). |
| late_fee_grace_days | INTEGER | nullable, default NULL. Days after due date before fee applies. Only set when `late_fee_type` is configured. |
| auto_month_to_month | BOOLEAN | NOT NULL, default true. Whether to auto-convert to month-to-month at expiry. |

**Updated constraint:**

```sql
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_status_check;
ALTER TABLE leases ADD CONSTRAINT leases_status_check
  CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'month_to_month'));
```

### Modified Table: `invoices`

**New columns:**

| Column | Type | Notes |
|--------|------|-------|
| lease_charge_id | UUID | FK → lease_charges ON DELETE SET NULL, nullable. Set when invoice is generated from an additional charge. Used for idempotency. If the charge definition is deleted, invoices survive with a null reference. |
| late_fee_for_invoice_id | UUID | FK → invoices(id) ON DELETE SET NULL, nullable. Set on late fee invoices, points to the overdue invoice that triggered it. If the source invoice is deleted, the late fee invoice survives with a null reference. |

---

## Lease-to-Month-to-Month Conversion

### Trigger

When `end_date` passes and `auto_month_to_month = true`.

### Mechanism

**Display status (client-side, read-only):** The `useLeases` hook computes a `displayStatus` field — same pattern as the `overdue` display status for invoices in Phase 4A. The hook does NOT write to the DB.

- If `status = 'active'` AND `end_date < today` AND `auto_month_to_month = true` → `displayStatus = 'month_to_month'`
- If `status = 'active'` AND `end_date < today` AND `auto_month_to_month = false` → `displayStatus = 'expired'`
- Otherwise → `displayStatus = status`

**DB status update (server-side only):** The `generate-invoices` action is the **sole writer** of the `month_to_month` status. When it fetches leases with `status IN ('active', 'month_to_month')`, it first checks for active leases past `end_date`:
- If `auto_month_to_month = true` → updates status to `'month_to_month'` in DB, then generates invoices
- If `auto_month_to_month = false` → updates status to `'expired'` in DB, skips invoice generation

This means the DB `status` column may lag behind the display status until the next invoice generation. This is acceptable — the display status is authoritative for UI, and the DB status catches up during the next generation cycle.

### Status Transition Rules for `update-lease` Action

- Users can manually set status to `terminated` from any status (including `month_to_month`)
- Users can manually set status to `active` only from `draft`
- Users cannot manually set status to `month_to_month` — this is system-managed
- If a user toggles `auto_month_to_month = true` on an already-expired lease (DB status = `expired`), the status does NOT retroactively change. The lease stays expired. Auto-conversion only applies to leases that are still `active` when their `end_date` passes.

### Month-to-Month Behavior

- Invoices keep generating monthly (same as `active`)
- `end_date` stays as the original end date (historical record)
- Lease can be terminated at any time by changing status to `terminated`
- No new `end_date` is set — open-ended until manually terminated

### UI

- Lease dialog: new "Auto Month-to-Month" toggle (defaults to on)
- Lease status badge: new color for `month_to_month` (purple)
- Status label: "Month-to-Month"

---

## Flexible Lease Charges

### Charge Model

Each lease can have zero or more additional charges in the `lease_charges` table. These are **on top of** the base `rent_amount` on the lease. Charges have three frequency types:

- **monthly** — billed every month (e.g., pet rent, parking)
- **yearly** — billed once per year, in the month matching `start_date` month (e.g., annual HOA assessment)
- **one_time** — billed once, never repeated (e.g., move-in fee, admin fee)

### Lease Dialog Changes

New **"Additional Charges"** section below existing fields in the lease create/edit dialog. Shows a list of charge rows with an "Add Charge" button.

Each charge row contains:
- **Name** (text input)
- **Amount** (number input, $)
- **Frequency** (select: Monthly / Yearly / One-Time)
- **Remove** button (trash icon)

Charges are managed inline in the lease form. When creating a lease, charges are added alongside other fields. When editing, existing charges appear and can be added/removed.

### Charge CRUD

Charges are stored as separate rows in `lease_charges`. The lease dialog manages them through dedicated server actions:

- `create-lease-charge` — Create a charge on a lease
- `update-lease-charge` — Update a charge
- `delete-lease-charge` — Delete a charge

For new leases (create flow), charges are created after the lease itself is created (sequential: create lease → create charges).

---

## Invoice Generation Updates

### Current Flow (Phase 4A)

1. Fetch active leases
2. One invoice per lease (rent only)
3. Idempotency check: `lease_id + due_date month`

### Updated Flow (Phase 4B)

1. Fetch leases with `status IN ('active', 'month_to_month')`
2. Auto-update status for expired leases with `auto_month_to_month = true` → set to `month_to_month`
3. For each lease:
   - **Rent invoice** — same as today, from `lease.rent_amount`. Idempotency: `lease_id + due_date month + lease_charge_id IS NULL`. **Breaking change from Phase 4A:** The existing idempotency query must add a `.is('lease_charge_id', null)` filter, otherwise charge-based invoices for the same lease would incorrectly satisfy the rent idempotency check.
   - **Monthly charges** — one invoice per active `lease_charge` where `frequency = 'monthly'` and charge dates are in range. Idempotency: `lease_charge_id + due_date month`
   - **Yearly charges** — one invoice per active `lease_charge` where `frequency = 'yearly'` AND target month matches `start_date` month. Idempotency: `lease_charge_id + due_date month/year`
   - **One-time charges** — one invoice per active `lease_charge` where `frequency = 'one_time'` AND no invoice exists with this `lease_charge_id`. Generated only once ever.
4. **Late fee assessment** (see next section)

### Invoice Description Format

| Source | Description |
|--------|-------------|
| Rent | "Rent - April 2026" (unchanged) |
| Monthly charge | "{charge.name} - April 2026" |
| Yearly charge | "{charge.name} - 2026" |
| One-time charge | "{charge.name}" |
| Late fee | "Late Fee - INV-2026-0012" |

---

## Late Fee Logic

### When Late Fees Are Assessed

Late fees are triggered during invoice generation (manual "Generate Invoices" button). When the user generates invoices for a month, the action also scans for overdue invoices.

### Assessment Process

1. Find all overdue invoices for leases with late fee configuration:
   - `status IN ('open', 'partially_paid')`
   - `due_date < today`
   - Lease has `late_fee_type IS NOT NULL`
   - **Exclude invoices that are themselves late fees** (`late_fee_for_invoice_id IS NULL`) — prevents cascading late fees on late fees
2. For each overdue invoice:
   - Check grace period: `today - due_date > late_fee_grace_days`
   - Check idempotency: no existing invoice with `late_fee_for_invoice_id = this_invoice.id`
   - If eligible, create a separate late fee invoice:
     - `description`: "Late Fee - {invoice.invoice_number}"
     - `amount`: flat → `late_fee_amount` / percentage → `Math.round((invoice.amount - invoice.amount_paid) * (late_fee_amount / 100) * 100) / 100` (rounded to 2 decimal places)
     - `direction`: `receivable`
     - `lease_id`: same as original invoice
     - `tenant_id`: same as original invoice
     - `property_id`: same as original invoice
     - `late_fee_for_invoice_id`: original invoice's ID
     - `due_date`: today (immediately due)
     - `issued_date`: today
     - `status`: `open`

### Late Fee Configuration UI

New section in lease dialog below "Additional Charges":

**Late Fee Settings**
- **Enable Late Fees** (toggle, default off)
- When enabled:
  - **Type** (select: Flat Fee / Percentage)
  - **Amount** (number — dollars if flat, % if percentage)
  - **Grace Period** (number input, days, default 5)

### Generate Invoices Dialog Update

Preview now shows two counts:
- "N invoices to generate" (rent + charges)
- "N late fees to assess" (overdue invoices past grace period)

Both are created in one batch when the user clicks "Generate".

---

## TypeScript Interfaces

### New: `LeaseCharge`

```ts
export interface LeaseCharge {
  id: string;
  org_id: string;
  lease_id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'one_time';
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

### Updated: `Lease`

Add fields:

```ts
export interface Lease {
  // ... existing fields ...
  late_fee_type: 'flat' | 'percentage' | null;
  late_fee_amount: number | null;
  late_fee_grace_days: number | null;
  auto_month_to_month: boolean;
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'month_to_month';
}
```

### Updated: `Invoice`

Add fields:

```ts
export interface Invoice {
  // ... existing fields ...
  lease_charge_id: string | null;
  late_fee_for_invoice_id: string | null;
}
```

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260315000012_lease_charges.sql` | New `lease_charges` table, alter `leases`, alter `invoices` |
| `modules/contacts/src/schemas/lease-charge-schema.ts` | Zod schema for charge form values |
| `modules/contacts/src/actions/create-lease-charge.ts` | Create charge on a lease |
| `modules/contacts/src/actions/update-lease-charge.ts` | Update a charge |
| `modules/contacts/src/actions/delete-lease-charge.ts` | Delete a charge |
| `modules/contacts/src/hooks/use-lease-charges.ts` | React Query hook — fetch charges for a lease |

### Modified Files

| File | Changes |
|------|---------|
| `packages/types/src/models.ts` | Add `LeaseCharge` interface, update `Lease` and `Invoice` interfaces |
| `modules/contacts/src/schemas/lease-schema.ts` | Add `late_fee_type`, `late_fee_amount`, `late_fee_grace_days`, `auto_month_to_month` |
| `modules/contacts/src/actions/create-lease.ts` | Handle new lease fields |
| `modules/contacts/src/actions/update-lease.ts` | Handle new fields + M2M status transition |
| `modules/contacts/src/hooks/use-leases.ts` | Compute `month_to_month` display status |
| `apps/web/components/contacts/lease-dialog.tsx` | Add "Additional Charges" section, "Late Fee Settings" section, "Auto Month-to-Month" toggle |
| `modules/billing/src/actions/generate-invoices.ts` | Generate invoices for all charge types + assess late fees |
| `modules/billing/src/hooks/use-invoice-generation-preview.ts` | Include charge-based invoices and late fees in preview count |
| `apps/web/components/billing/generate-invoices-dialog.tsx` | Show late fee count in preview |
| `modules/contacts/src/index.ts` | Export new schemas and hooks |

### Unchanged

- Invoice table structure (only 2 nullable columns added — no existing data affected)
- Payment flow (payments work against any invoice regardless of source)
- Income/expense auto-creation on payment
- Incoming/Outgoing pages (display all invoices — new invoice types appear automatically)
- Financial Overview (reads from income/expenses tables — unaffected)

---

## Edge Cases

- **Lease with no rent_amount but has charges:** Generate invoices only for the charges, skip rent invoice.
- **Charge start_date after lease start_date:** Charge only generates invoices from its own start_date onward.
- **Charge end_date boundary:** A charge is skipped if `end_date < first day of the target month`. If `end_date` falls mid-month (e.g., April 15 for April generation), the charge IS generated for that month.
- **One-time charge already invoiced:** Idempotency check on `lease_charge_id` prevents duplicates.
- **Yearly charge timing:** Yearly charges are generated ONLY for the exact month matching the charge's `start_date` month. No retroactive generation — if the user skips a month, the yearly charge for that month is not auto-caught-up. Users can create a manual invoice if needed.
- **Late fee on partially paid invoice:** Percentage calculated on remaining balance `(amount - amount_paid)`, not full amount. Rounded to 2 decimal places.
- **Late fee on a late fee invoice:** Explicitly prevented — late fee assessment excludes invoices where `late_fee_for_invoice_id IS NOT NULL`.
- **Late fee on invoice that already has a late fee:** Idempotency check on `late_fee_for_invoice_id` prevents duplicate late fees for the same source invoice.
- **Month-to-month lease terminated mid-month:** No more invoices generated. Existing unpaid invoices remain open.
- **Deleting a lease charge:** The `lease_charge_id` FK on invoices uses `ON DELETE SET NULL`. Invoices generated from the deleted charge survive with `lease_charge_id = NULL`. The charge definition is removed but its billing history remains.
- **Editing a charge amount:** Only affects future invoice generations. Already-generated invoices keep their original amount.
- **One-time charge on month-to-month lease:** If a one-time charge is added to a lease that later goes month-to-month, the charge is still generated (once) if it hasn't been invoiced yet. The idempotency check on `lease_charge_id` ensures it only generates once regardless of lease status transitions.

---

## Scope Boundaries

### In Scope (Phase 4B)

- `lease_charges` table with RLS
- Lease charge CRUD (actions, hooks, schema)
- Lease dialog UI updates (charges, late fees, M2M toggle)
- Updated invoice generation (multi-charge + late fees + M2M support)
- Updated generation preview (charge count + late fee count)
- Month-to-month status and lazy conversion logic
- Late fee configuration and assessment

### Deferred to Future Phases

> **Note:** Phase 4A originally planned scheduled auto-generation for Phase 4B. After user review, this was consciously deferred further — the manual "Generate Invoices" flow is sufficient for current needs.

- Scheduled auto-generation (pg_cron / Edge Function / Vercel Cron)
- Email notifications for overdue invoices
- Invoice PDF export
- Charge templates at org/property level
- Daily/weekly late fee accrual (only assessed during invoice generation)

---

## Migration Plan

**Single migration:** `20260315000012_lease_charges.sql`

Creates:
- `lease_charges` table with RLS policies and indexes
- Alters `leases`: adds late fee columns, M2M flag, updates status CHECK constraint
- Alters `invoices`: adds `lease_charge_id` and `late_fee_for_invoice_id` columns

**No data migration needed** — all new columns are nullable or have defaults. Existing leases get `auto_month_to_month = true` by default. Existing invoices get `NULL` for the new columns.

# Phase 4A: Invoice System & Accounting Restructure Design Spec

## Overview

Phase 4A introduces a **unified invoice system** for tracking both receivable (incoming) and payable (outgoing) invoices, along with a **partial payment** workflow. It restructures the Accounting sidebar from a single flat link into a collapsible menu with three sub-pages: Financial Overview, Incoming, and Outgoing.

**Key behaviors:**
- Invoices are auto-generated monthly from active leases (receivables)
- Vendor bills are created manually as payable invoices
- Payments against invoices auto-create income records (receivables) or expense records (payables)
- Partial payments are supported — invoices track `amount_paid` as a running total
- Late fees and recurring custom charges are deferred to Phase 4B

---

## Architecture

**New module:** `modules/billing/` — follows established module pattern:
```
modules/billing/
├── src/
│   ├── actions/       # Server actions (invoices, payments, generation)
│   ├── hooks/         # React Query hooks (useInvoices, usePayments)
│   ├── schemas/       # Zod validation schemas
│   └── index.ts       # Barrel exports (schemas + hooks only)
├── package.json
└── tsconfig.json
```

**Modified module:** `modules/accounting/` — existing income/expense hooks stay, new integration with billing module for auto-created records.

**New pages:**
- `apps/web/app/(dashboard)/accounting/incoming/page.tsx`
- `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`

**Modified pages:**
- `apps/web/app/(dashboard)/accounting/page.tsx` — remains as Financial Overview; update "Income" and "Expenses" buttons to link to `/accounting/incoming` and `/accounting/outgoing`

**Existing pages migrated into new structure:**
- `apps/web/app/(dashboard)/accounting/income/page.tsx` — **remove**; direct income entry moves into the Incoming page (or can be done via ad-hoc invoice creation)
- `apps/web/app/(dashboard)/accounting/expenses/page.tsx` — **remove**; direct expense entry moves into the Outgoing page's "Expenses" tab

The existing standalone income and expenses pages are being replaced by the new Incoming/Outgoing pages which provide a superset of functionality (invoices + direct manual entries). The existing manual income/expense dialogs and components are reused within the new pages.

**Modified components:**
- `apps/web/components/dashboard/sidebar.tsx` — Accounting becomes collapsible with children

---

## Database Schema

### New Tables

#### `invoices`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| org_id | UUID | FK → organizations, NOT NULL |
| invoice_number | TEXT | NOT NULL, unique per org (e.g., INV-2026-0001) |
| direction | TEXT | NOT NULL. Values: `'receivable'`, `'payable'` |
| status | TEXT | NOT NULL, default `'open'`. Values: `'draft'`, `'open'`, `'partially_paid'`, `'paid'`, `'void'`, `'overdue'` |
| lease_id | UUID | FK → leases, nullable (set for auto-generated receivables) |
| tenant_id | UUID | FK → tenants, nullable (set for receivables) |
| provider_id | UUID | FK → service_providers, nullable (set for payables) |
| property_id | UUID | FK → properties, NOT NULL |
| unit_id | UUID | FK → units, nullable |
| description | TEXT | NOT NULL (e.g., "Rent - April 2026") |
| amount | DECIMAL(10,2) | NOT NULL, CHECK (amount > 0) |
| amount_paid | DECIMAL(10,2) | NOT NULL, default 0 (running total of payments) |
| due_date | DATE | NOT NULL |
| issued_date | DATE | NOT NULL, default CURRENT_DATE |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

**RLS:** Same pattern as other tables — `get_user_org_ids()` for SELECT, `get_user_managed_org_ids()` for INSERT/UPDATE/DELETE.

**Indexes:**
- `(org_id, direction, status)` — for filtered listing
- `(lease_id, due_date)` — for idempotent generation check
- `(org_id, invoice_number)` — unique constraint

#### `payments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| org_id | UUID | FK → organizations, NOT NULL |
| invoice_id | UUID | FK → invoices, NOT NULL |
| amount | DECIMAL(10,2) | NOT NULL, CHECK (amount > 0) |
| payment_date | DATE | NOT NULL |
| payment_method | TEXT | NOT NULL. Values: `'cash'`, `'check'`, `'bank_transfer'`, `'online'`, `'other'` |
| reference_number | TEXT | nullable (check number, transaction ID) |
| notes | TEXT | nullable |
| income_id | UUID | FK → income, nullable (set when receivable payment auto-creates income) |
| expense_id | UUID | FK → expenses, nullable (set when payable payment auto-creates expense) |
| created_at | TIMESTAMPTZ | default now() |

**RLS:** Same org-based pattern.

### Invoice Status Flow

```
draft ──► open ──► partially_paid ──► paid
  │         │
  │         └──► overdue (past due_date, checked on read)
  │                │
  └──► void       └──► partially_paid ──► paid
```

**Note:** `overdue` is a computed status — invoices remain `open` or `partially_paid` in the database, but display as `overdue` when `due_date < today` and `status` is `open` or `partially_paid`. This avoids a scheduled job just for status updates. The computation lives in the `useInvoices` hook, which adds a `displayStatus` field derived from `status` and `due_date`.

### Key Design Decisions

**Receivable (Incoming):**
- `tenant_id` is set, `provider_id` is null
- Auto-generated from active leases (monthly)
- Payment creates an **income** record in the existing `income` table
- Links to `lease_id` for audit trail

**Payable (Outgoing):**
- `provider_id` is set, `tenant_id` is null
- Manually created for vendor bills (e.g., plumber invoice, contractor bill)
- Payment creates an **expense** record in the existing `expenses` table
- Links to service provider

**Partial payments:**
- Each payment is a separate row in `payments`
- `invoices.amount_paid` is updated as a running sum
- If `amount_paid >= amount` → status = `'paid'`
- If `0 < amount_paid < amount` → status = `'partially_paid'`

---

## Sidebar & Routing Structure

### Sidebar Change

Accounting changes from a flat nav item to a collapsible parent (same pattern as Contacts):

**Current:**
```
📊 Dashboard
🏠 Properties
🧮 Accounting          → /accounting
👥 Contacts ▼
    Tenants
    Service Providers
```

**New:**
```
📊 Dashboard
🏠 Properties
🧮 Accounting ▼
    Financial Overview  → /accounting
    Incoming            → /accounting/incoming
    Outgoing            → /accounting/outgoing
👥 Contacts ▼
    Tenants
    Service Providers
```

### Route Mapping

| Sidebar Item | Route | Content |
|---|---|---|
| Financial Overview | `/accounting` | Existing dashboard (charts + stats) |
| Incoming | `/accounting/incoming` | Receivable invoices (tabs: Open, Paid, All) |
| Outgoing | `/accounting/outgoing` | Payable invoices + manual expenses (tabs: Open Bills, Paid Bills, Expenses) |

---

## Page Layouts

### Incoming Page (`/accounting/incoming`)

**Header:** "Incoming" title with two action buttons:
- **Generate Invoices** — opens batch generation dialog
- **+ New Invoice** — opens manual invoice creation dialog

**Tabs:** Open (default) | Paid | All

**Filters:** Search bar, Property dropdown, Tenant dropdown

**Table columns:**
| Invoice # | Tenant | Property | Due Date | Amount | Paid | Status | Actions |
|---|---|---|---|---|---|---|---|

**Status badges:**
- Open (yellow)
- Partial (blue)
- Overdue (red, for open/partial past due date)
- Paid (green)

**Actions per row:**
- "Pay" button — opens Record Payment dialog
- Edit icon — opens invoice edit dialog

### Outgoing Page (`/accounting/outgoing`)

**Header:** "Outgoing" title with two action buttons:
- **+ New Bill** — opens payable invoice creation dialog
- **+ Quick Expense** — opens existing manual expense entry (current behavior)

**Tabs:** Open Bills (default) | Paid Bills | Expenses

- Open Bills / Paid Bills tabs show the same table layout as Incoming but for payable invoices (vendor name instead of tenant)
- Expenses tab shows **all** expense records (both manually entered and auto-created from bill payments). This replaces the standalone `/accounting/expenses` page. Includes the existing "+ Add Expense" dialog for quick manual entry.

### Record Payment Dialog

Triggered by clicking "Pay" on an invoice:

| Field | Type | Notes |
|---|---|---|
| Amount | Number | Pre-filled with remaining balance (`amount - amount_paid`) |
| Date | Date picker | Defaults to today |
| Method | Select | cash, check, bank_transfer, online, other |
| Reference # | Text | Optional (check number, transaction ID) |
| Notes | Text | Optional |

**On submit:**
1. Creates a `payments` row
2. Updates `invoices.amount_paid += payment.amount`
3. Auto-creates an `income` row (if receivable) or `expense` row (if payable)
4. Updates invoice status: `paid` if fully paid, `partially_paid` if partial

---

## Auto-Generation Flow

### Monthly Invoice Generation

**Triggers:**
1. **Manual** — "Generate Invoices" button on Incoming page
2. **Scheduled** — deferred to Phase 4B (pg_cron or Edge Function on 1st of each month)

**Process:**
1. Scan all active leases where `status = 'active'`
2. For each lease, check if an invoice already exists for this `lease_id` + target month (idempotent — no duplicates)
3. For each qualifying lease, create an invoice:
   - `direction = 'receivable'`
   - `lease_id = lease.id`
   - `tenant_id = lease.tenant_id`
   - `property_id = unit.property_id`
   - `unit_id = lease.unit_id`
   - `amount = lease.rent_amount`
   - `due_date = {year}-{month}-{lease.payment_due_day}`
   - `status = 'open'`
   - `description = "Rent - {Month Year}"`
   - `invoice_number = next sequence`

### Generate Invoices Dialog

Opened by clicking "Generate Invoices" on the Incoming page:

| Field | Type | Notes |
|---|---|---|
| Month | Select | Defaults to current month, shows "April 2026" format |

**Preview:** Shows count of active leases that don't already have invoices for the selected month.

**Action:** "Generate N Invoices" button creates all qualifying invoices in batch.

### Ad-Hoc Invoice Creation

Beyond auto-generation, users can manually create invoices:
- **Receivable:** One-off charges to tenants (outside lease schedule)
- **Payable:** Vendor bills from service providers (e.g., plumber, contractor)

For payable invoices tied to maintenance issues, the user creates the invoice from the Outgoing page, selects the service provider and property, and enters the amount.

---

## Invoice Number Sequence

Format: `INV-{YEAR}-{SEQUENCE}` (e.g., `INV-2026-0001`)

Sequence is per-org, auto-incrementing. Implemented as a database function:
- Query `MAX` of existing invoice numbers for the org in the current year
- Increment and zero-pad to 4 digits

---

## Module Structure

### `modules/billing/`

**Schemas:**

`invoice-schema.ts`:
```ts
export const invoiceSchema = z.object({
  direction: z.enum(['receivable', 'payable']),
  tenant_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  due_date: z.string().min(1, 'Due date is required'),
  issued_date: z.string().optional(),
});
```

`payment-schema.ts`:
```ts
export const paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be positive'),
  payment_date: z.string().min(1, 'Payment date is required'),
  payment_method: z.enum(['cash', 'check', 'bank_transfer', 'online', 'other']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
```

**Actions:**
- `create-invoice.ts` — Create a single invoice (manual)
- `generate-invoices.ts` — Batch-generate invoices for a month from active leases
- `update-invoice.ts` — Edit invoice details
- `void-invoice.ts` — Mark invoice as void
- `record-payment.ts` — Record a payment against an invoice (creates payment row, updates invoice, auto-creates income/expense)

**Hooks:**
- `use-invoices.ts` — Fetch invoices with filters (direction, status, property, tenant/provider)
- `use-payments.ts` — Fetch payments for an invoice
- `use-invoice-generation-preview.ts` — Preview how many invoices would be generated for a month

---

## Integration with Existing Tables

### Income Table
When a receivable invoice payment is recorded, auto-create an `income` row:

| income column | Source |
|---|---|
| `org_id` | `invoice.org_id` |
| `property_id` | `invoice.property_id` |
| `unit_id` | `invoice.unit_id` (nullable) |
| `amount` | `payment.amount` |
| `income_type` | `'rent'` (or mapped: deposit invoices → `'deposit'`, other → `'other'`) |
| `description` | `"Payment for {invoice.invoice_number}"` |
| `transaction_date` | `payment.payment_date` |

### Expenses Table
When a payable invoice payment is recorded, auto-create an `expense` row:

| expense column | Source |
|---|---|
| `org_id` | `invoice.org_id` |
| `property_id` | `invoice.property_id` |
| `unit_id` | `invoice.unit_id` (nullable) |
| `amount` | `payment.amount` |
| `expense_type` | `'maintenance'` (default, or mapped from provider category) |
| `description` | `"Payment for {invoice.invoice_number}"` |
| `transaction_date` | `payment.payment_date` |
| `provider_id` | `invoice.provider_id` |

### Financial Overview
The existing `/accounting` page (Financial Overview) continues to work as-is — it reads from `income` and `expenses` tables, which are now populated both by manual entries and by invoice payments.

---

## TypeScript Interfaces

Add to `packages/types/src/models.ts`:

```ts
export interface Invoice {
  id: string;
  org_id: string;
  invoice_number: string;
  direction: 'receivable' | 'payable';
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'void';
  lease_id: string | null;
  tenant_id: string | null;
  provider_id: string | null;
  property_id: string;
  unit_id: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  issued_date: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  org_id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'online' | 'other';
  reference_number: string | null;
  notes: string | null;
  income_id: string | null;
  expense_id: string | null;
  created_at: string;
}
```

---

## Edge Cases

- **Overpayment:** The `record-payment` action rejects payments where `payment.amount > (invoice.amount - invoice.amount_paid)`. Users must enter at most the remaining balance.
- **Voiding invoices with payments:** Invoices with any recorded payments cannot be voided. Only invoices with `amount_paid = 0` can be voided.
- **Editing invoices with payments:** The `amount` field cannot be reduced below `amount_paid`. Other fields (description, due_date) can still be edited.
- **Payments are immutable:** Once recorded, payments cannot be edited or deleted. To correct a mistake, void the invoice (if no payments) or create a new adjusting invoice.
- **Duplicate generation guard:** The `generate-invoices` action checks for existing invoices with the same `lease_id` + month/year before creating, ensuring idempotency even if the button is clicked multiple times.

---

## Scope Boundaries

### In Scope (Phase 4A)
- `invoices` and `payments` database tables with RLS
- Incoming page with invoice listing, filtering, tabs
- Outgoing page with bill listing + existing expenses tab
- Record Payment dialog with partial payment support
- Manual invoice generation (button)
- Ad-hoc invoice and bill creation
- Sidebar restructure (Accounting → collapsible with 3 children)
- Invoice number sequencing
- Auto-create income/expense records on payment

### Deferred to Phase 4B
- Flexible lease charges (custom recurring fees, pet deposits, yearly charges)
- Lease-to-month-to-month conversion
- Late fee calculation and auto-addition
- Scheduled auto-generation via pg_cron (Phase 4A uses manual generation only)
- Email notifications for overdue invoices
- Invoice PDF export

---

## Migration Plan

**New migration:** Creates `invoices` and `payments` tables, RLS policies, indexes, invoice number sequence function, and `moddatetime` trigger on `invoices.updated_at` (following the established pattern from migrations 003, 006, 007).

**No changes** to existing `income`, `expenses`, `leases`, `tenants`, or `service_providers` tables — the new system integrates through foreign keys and auto-created records.

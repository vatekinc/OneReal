# Payable Invoices for Outgoing Expenses

## Overview

Pivot the Outgoing page from raw expense records to payable invoices with full payment lifecycle tracking. Recurring expense templates generate payable invoices (instead of raw expenses), and manual bills are also created as payable invoices. When payments are recorded on payable invoices, expense records are auto-created via the existing `recordPayment` action.

This leverages the existing invoice system which already supports `direction: 'payable'`, the `InvoiceTable` component (shows Vendor column for payable), the `InvoiceDialog` (shows "New Bill" title and vendor selector for payable), and the `PaymentDialog` (works on any invoice direction).

## Database

### Extend `invoices` table

```sql
-- Expense type for payable invoices (categorization: mortgage, utilities, etc.)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS expense_type TEXT;

-- Link payable invoices back to recurring expense templates
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recurring_expense_id UUID
  REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;

-- Idempotency for generated invoices: stores 'YYYY-MM' string for target month
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS generated_for_period TEXT;

-- Partial unique index: one generated invoice per template per period
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_recurring_period
  ON public.invoices(recurring_expense_id, generated_for_period)
  WHERE recurring_expense_id IS NOT NULL;
```

- `expense_type`: nullable TEXT (only relevant for payable invoices). Same enum values as the `expenses` table: `'mortgage'`, `'maintenance'`, `'repairs'`, `'utilities'`, `'insurance'`, `'taxes'`, `'management'`, `'advertising'`, `'legal'`, `'hoa'`, `'home_warranty'`, `'other'`. No CHECK constraint on invoices since it's nullable for receivable invoices.
- `recurring_expense_id`: links auto-generated payable invoices back to their recurring expense template. Null for manually created invoices and receivable invoices.
- `generated_for_period`: stores `"YYYY-MM"` for the target month. Used for idempotency (same pattern as the `expenses` table). Null for manually created invoices.
- The partial unique index prevents duplicate generation even under concurrent requests.

### Migrate existing expenses to paid invoices

```sql
-- Convert existing expense records to paid payable invoices.
-- These represent money already spent, so status='paid' and amount_paid=amount.
-- Uses next_invoice_number() to generate proper invoice numbers.
-- Preserves original created_at/updated_at timestamps for audit trails.
-- Note: provider_id exists on expenses (added in 20260315000007_contacts_tables.sql).
DO $$
DECLARE
  exp RECORD;
  inv_number TEXT;
BEGIN
  FOR exp IN SELECT * FROM public.expenses ORDER BY created_at ASC LOOP
    inv_number := public.next_invoice_number(exp.org_id);
    INSERT INTO public.invoices (
      org_id, invoice_number, direction, status, property_id, unit_id,
      provider_id, description, amount, amount_paid, due_date, issued_date,
      expense_type, recurring_expense_id, generated_for_period,
      created_at, updated_at
    ) VALUES (
      exp.org_id, inv_number, 'payable', 'paid', exp.property_id, exp.unit_id,
      exp.provider_id, exp.description, exp.amount, exp.amount, exp.transaction_date, exp.transaction_date,
      exp.expense_type, exp.recurring_expense_id, exp.generated_for_period,
      exp.created_at, exp.updated_at
    );
  END LOOP;
END $$;
```

Existing expense records remain in the `expenses` table (they're valid financial records for P&L). The new invoices represent the same obligations with payment tracking.

## Server Actions

### Modify `generate-expenses.ts`

The `generateExpenses` and `previewGenerateExpenses` functions change to create/check payable invoices instead of raw expenses.

#### `generateExpenses(orgId, month, year)`

- Same template filtering logic (active, within date range, frequency check)
- **Changed**: Inserts into `invoices` instead of `expenses`
- For each eligible template, creates an invoice with:
  - `org_id`: copied from template
  - `invoice_number`: auto-generated via `next_invoice_number(org_id)` RPC call
  - `direction`: `'payable'`
  - `status`: `'open'`
  - `property_id`, `unit_id`, `amount`, `description`: copied from template
  - `expense_type`: copied from template
  - `provider_id`: copied from template
  - `due_date`: 1st of target month
  - `issued_date`: 1st of target month
  - `recurring_expense_id`: link to template
  - `generated_for_period`: `'YYYY-MM'` string
- Handles unique constraint violation (code `23505`) as skipped
- Returns `ActionResult<{ generated: number; skipped: number }>`

#### `previewGenerateExpenses(orgId, month, year)`

- Same template filtering logic
- **Changed**: Checks `invoices` table instead of `expenses` for existing records
- Queries `invoices` where `recurring_expense_id IN (templateIds) AND generated_for_period = period`
- Returns `ActionResult<{ eligible: number }>`

#### `fetchExistingForPeriod` helper (internal)

- **Changed**: Queries `invoices` table instead of `expenses`
- Same signature: `(db, templateIds, period) => Promise<Set<string>>`

### Modify `record-payment.ts`

Line 78: Change hardcoded `expense_type: 'maintenance'` to use the invoice's `expense_type` field:

```typescript
expense_type: invoice.expense_type || 'other',
```

This ensures that when a payable invoice is paid, the auto-created expense record gets the correct expense type (e.g., 'mortgage' not 'maintenance').

> **Ordering dependency**: The `expense_type` column must exist on the `invoices` table (via the database migration) before this code change takes effect correctly. If deployed before the migration, `invoice.expense_type` will be `undefined` and the fallback `|| 'other'` will produce `'other'` instead of `'maintenance'`. Apply the migration first.

### Add `expense_type` to `InvoiceDialog` schema

The existing `invoiceSchema` in `modules/billing/src/schemas/invoice-schema.ts` needs:

```typescript
expense_type: z.string().optional(),
```

No validation constraint — it's optional and only relevant for payable invoices.

### Existing actions (no code changes needed, but depend on schema change)

- `createInvoice`: uses `...parsed.data` spread, so `expense_type` will pass through **only after** the `invoiceSchema` change above is applied. No code change to the action itself.
- `updateInvoice`: same — uses `...parsed.data` spread, so `expense_type` passes through after the schema change.
- `voidInvoice`: works on any invoice, no changes needed
- `deleteInvoice`: works on any invoice, no changes needed
- `recordPayment`: only needs the `expense_type` fix above

## TypeScript Types

### Update `Invoice` interface in `packages/types/src/models.ts`

Add three new fields:

```typescript
export interface Invoice {
  // ... existing fields ...
  expense_type: string | null;
  recurring_expense_id: string | null;
  generated_for_period: string | null;
}
```

## UI Changes

### Outgoing Page (`apps/web/app/(dashboard)/accounting/outgoing/page.tsx`)

Full rewrite to mirror the Incoming page structure but with `direction: 'payable'`:

- **Data source**: `useInvoices({ direction: 'payable', ... })` instead of `useExpenses()`
- **Tabs**: Open | Paid | All (new, matches Incoming page)
- **Table**: `InvoiceTable` component with `direction="payable"` (replaces custom expense table)
- **Filters**: Search (searches description + invoice_number), Property filter (keeps existing), Vendor filter (new — uses `vendorFilter` state variable wired to `useInvoices({ providerId: vendorFilter })`, loaded from `useProviders` hook, same pattern as tenant filter on the Incoming page)
- **Date range buttons**: Keep existing This Month / This Year / 3yr / 5yr / All Time
- **Action buttons**:
  - "Generate Bills" (replaces "Generate" — opens GenerateExpensesDialog)
  - "New Bill" (replaces "New Expense" — opens InvoiceDialog with `defaultDirection="payable"`)
- **Inline actions per row** (from InvoiceTable):
  - Pay (DollarSign icon) — opens PaymentDialog
  - Edit (Pencil icon) — opens InvoiceDialog
  - Void (Ban icon) — calls voidInvoice
  - Delete (Trash2 icon) — calls deleteInvoice
- **Empty state**: "No open bills" / "No paid bills" / "No bills yet" (tab-dependent)

### InvoiceDialog (`apps/web/components/billing/invoice-dialog.tsx`)

Add `expense_type` field, shown only when `direction === 'payable'`:

- Select dropdown with expense type options: Mortgage, Maintenance, Repairs, Utilities, Insurance, Taxes, Management, Advertising, Legal, HOA, Home Warranty, Other
- Positioned after the Vendor field in the form layout
- Optional field (bills can be created without categorization)
- **Important**: Also add `expense_type` to the form's `defaultValues` (both the initial values and the `invoice` edit-mode values) and to the `useEffect` `form.reset()` block, so that editing an existing invoice preserves its expense type. Example: `expense_type: invoice?.expense_type ?? undefined`

### GenerateExpensesDialog (`apps/web/components/accounting/generate-expenses-dialog.tsx`)

Minor updates:

- Title: "Generate Monthly Bills" (was "Generate Monthly Expenses" — actually the current title doesn't exist yet, this is a new distinction)
- Preview text: "X recurring expenses to generate bills for March 2026" → "This will create bills for **X active recurring expense(s)** that don't have March 2026 bills yet."
- Success toast: "Generated X bill(s) (Y already existed)"
- Cache invalidation: invalidate `['invoices']` instead of `['expenses']`, plus `['financial-stats']` and `['expense-generation-preview']`

### Components reused (no changes needed)

- `InvoiceTable` — already handles `direction: 'payable'` (shows "Vendor" column)
- `PaymentDialog` — works on any invoice
- `RecurringExpenseDialog` — stays on property detail page, unchanged
- Property detail "Recurring" tab — unchanged (manages templates)

## Edge Cases

- **Existing expense records**: Migrated to paid invoices via SQL. Original expense records remain for P&L continuity. No data loss.
- **P&L accuracy**: Unpaid payable invoices don't create expense records — only recorded payments do. This is correct cash-basis accounting. The `financial-stats` queries should continue to use the `expenses` table for actual expenditure totals.
- **Template amount changed after generation**: Previously generated invoices keep their original amount. Future generations use updated template.
- **Template deleted after generation**: Generated invoices remain (`ON DELETE SET NULL` on `recurring_expense_id`). They function as standalone invoices.
- **Void payable invoice**: Can only void if `amount_paid === 0`. Same rules as receivable side.
- **Partial payment on payable invoice**: Supported via existing `recordPayment` logic. Status moves to `partially_paid`. Each partial payment creates a separate expense record.
- **Invoice number generation**: Uses existing `next_invoice_number(org_id)` function. Payable and receivable invoices share the same sequence per org (e.g., INV-2026-0001 could be either direction).
- **Concurrent generation**: Protected by the partial unique index on `(recurring_expense_id, generated_for_period)`. Duplicate attempts hit the unique constraint and count as skipped.
- **Overdue detection**: The `useInvoices` hook already computes `displayStatus: 'overdue'` for invoices past their `due_date` that are still `open` or `partially_paid`. Works automatically for payable invoices.

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260320000001_payable_invoices.sql` | NEW — extend invoices table + migrate expenses |
| `packages/types/src/models.ts` | MODIFY — add `expense_type`, `recurring_expense_id`, `generated_for_period` to Invoice |
| `modules/accounting/src/actions/generate-expenses.ts` | MODIFY — insert into invoices instead of expenses |
| `modules/billing/src/actions/record-payment.ts` | MODIFY — use invoice's `expense_type` instead of hardcoded 'maintenance' |
| `modules/billing/src/schemas/invoice-schema.ts` | MODIFY — add optional `expense_type` field |
| `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` | REWRITE — mirror Incoming page with `direction: 'payable'` |
| `apps/web/components/billing/invoice-dialog.tsx` | MODIFY — add `expense_type` select for payable direction |
| `apps/web/components/accounting/generate-expenses-dialog.tsx` | MODIFY — update labels and cache invalidation |

## Acceptance Criteria

1. Recurring expense templates generate payable invoices (not raw expenses) with correct invoice numbers, status `'open'`, and proper `expense_type`
2. Re-running generation for the same month skips already-generated invoices (idempotent via `generated_for_period`)
3. Outgoing page displays payable invoices with status badges (Open/Paid/Overdue/Void)
4. "New Bill" creates a payable invoice with optional expense type categorization
5. "Record Payment" on a payable invoice creates an expense record with the correct `expense_type`
6. Existing expense records are migrated to paid invoices and appear on the Outgoing page
7. Tabs (Open/Paid/All) filter payable invoices correctly
8. Search filters by invoice number and description
9. Property and vendor filters work correctly
10. Void and delete actions work with same rules as receivable side

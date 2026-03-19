# Recurring Expenses

## Overview

Allow property managers to set up recurring expense templates per property (e.g., monthly mortgage, yearly insurance) and generate actual expense records for a given month with a single click. Mirrors the existing `lease_charges` + `generate-invoices` pattern used for rent.

## Database

### New table: `recurring_expenses`

```sql
CREATE TABLE public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other'
  )),
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
  description TEXT NOT NULL DEFAULT '',
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CHECK (end_date IS NULL OR end_date >= start_date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_expenses_org ON public.recurring_expenses(org_id);
CREATE INDEX idx_recurring_expenses_property ON public.recurring_expenses(property_id);

-- Auto-update updated_at
CREATE TRIGGER handle_recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recurring expenses in their orgs"
  ON public.recurring_expenses FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert recurring expenses"
  ON public.recurring_expenses FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update recurring expenses"
  ON public.recurring_expenses FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete recurring expenses"
  ON public.recurring_expenses FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));
```

### Extend `expenses` table

```sql
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurring_expense_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS generated_for_period TEXT;

-- Enforce idempotency at DB level: one generated expense per template per period
CREATE UNIQUE INDEX idx_expenses_recurring_period
  ON public.expenses(recurring_expense_id, generated_for_period)
  WHERE recurring_expense_id IS NOT NULL;
```

- `recurring_expense_id`: links generated expenses back to their template. Null for manually created expenses.
- `generated_for_period`: stores `"YYYY-MM"` string for the target month (e.g., `"2026-03"`). Used for idempotency checks instead of relying on `transaction_date` (which users can edit). Null for manually created expenses.
- The partial unique index on `(recurring_expense_id, generated_for_period)` prevents duplicate generation even under concurrent requests (e.g., double-click).

## Server Actions

All in `modules/accounting/src/actions/`.

### `create-recurring-expense.ts`

- Input: `orgId: string`, validated form values
- Schema: `recurring_expense_schema` (property_id, unit_id, expense_type, amount, frequency, description, provider_id, start_date, end_date)
- Inserts into `recurring_expenses` table with `org_id` set server-side
- Returns `ActionResult<{ id: string }>`

### `update-recurring-expense.ts`

- Input: `id: string`, validated form values
- Updates the recurring expense template
- Returns `ActionResult`

### `delete-recurring-expense.ts`

- Input: `id: string`
- Deletes from `recurring_expenses` table (does NOT delete already-generated expenses)
- Returns `ActionResult`

### `generate-expenses.ts`

- Input: `orgId: string`, `month: number` (1-12), `year: number` (validated inline: reject if month < 1 or month > 12)
- Logic:
  1. Fetch all `recurring_expenses` for the org where `is_active = true` AND `start_date <= last day of target month` AND (`end_date` is null or `end_date >= first day of target month`)
  2. For each template:
     - **Monthly:** always eligible
     - **Yearly:** only if target month matches the month of `start_date`
  3. Check idempotency: skip if an expense with matching `recurring_expense_id` AND `generated_for_period = 'YYYY-MM'` already exists (does not rely on `transaction_date`)
  4. Create expense records with:
     - `org_id`: copied from template
     - `property_id`: copied from template
     - `unit_id`: copied from template
     - `expense_type`: copied from template
     - `amount`: copied from template
     - `description`: copied from template
     - `provider_id`: copied from template
     - `transaction_date`: 1st of target month
     - `recurring_expense_id`: link to template
     - `receipt_url`: null (no receipt at generation time)
     - `generated_for_period`: `'YYYY-MM'` string for target month
  5. Handle unique constraint violation gracefully (concurrent request already generated) — count as skipped
  6. Return `ActionResult<{ generated: number; skipped: number }>`

### `preview-generate-expenses.ts`

Co-located in `generate-expenses.ts` as a separate exported function `previewGenerateExpenses` (follows the pattern in `generate-invoices.ts` where `getGenerationPreview` lives alongside `generateInvoices`).

- Input: `orgId: string`, `month: number`, `year: number`
- Same filtering and idempotency logic as `generate-expenses` but only returns the count (no inserts)
- Returns `ActionResult<{ eligible: number }>`

> **Note:** Server actions are NOT re-exported from the barrel `index.ts`. Import via deep path: `import { generateExpenses, previewGenerateExpenses } from '@onereal/accounting/actions/generate-expenses'`.

## Hooks

All in `modules/accounting/src/hooks/`.

### `use-recurring-expenses.ts`

- Query hook: fetches all recurring expenses for a given `propertyId`
- Joins `service_providers(name)` for vendor display
- Query key: `['recurring-expenses', propertyId]`
- Returns `{ data: RecurringExpense[], isLoading }`

## TypeScript Types

Add to `packages/types/src/models.ts`:

```typescript
export interface RecurringExpense {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  expense_type: string;
  amount: number;
  frequency: 'monthly' | 'yearly';
  description: string;
  provider_id: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined by hook, not stored in table:
  service_providers?: { name: string } | null;
}
```

Update `Expense` interface to add:
- `recurring_expense_id: string | null`
- `generated_for_period: string | null`

## UI Components

### 1. Recurring Expenses Tab on Property Detail Page

**File:** `apps/web/components/properties/property-detail-tabs.tsx`

Add a new **"Recurring"** tab alongside Overview, Units, Images, Leases. Add an inline `PropertyRecurringExpenses` component (same pattern as the existing `PropertyLeases` component in this file) that:

- Shows a table of recurring expense templates for the property
- Columns: Type, Amount, Frequency, Vendor, Status (active/inactive toggle switch), Actions (edit/delete)
- "Add Recurring Expense" button opens a dialog
- Edit/delete inline actions
- Active/inactive toggle: inline switch in the Status column that calls `updateRecurringExpense` to flip `is_active`

### 2. Recurring Expense Dialog

**File:** `apps/web/components/accounting/recurring-expense-dialog.tsx`

Dialog for creating/editing a recurring expense template:

- Fields: expense type (select), amount (number), frequency (monthly/yearly), vendor (select from service_providers), description (text), start date (date), end date (optional date)
- Property is pre-set from the property detail page context (not user-selectable)
- Unit select only shown if property has multiple units
- Zod validation via `recurring_expense_schema`

### 3. Generate Expenses Dialog

**File:** `apps/web/components/accounting/generate-expenses-dialog.tsx`

Dialog triggered from the Outgoing page header:

- Month/year picker (defaults to current month)
- Calls `previewGenerateExpenses` on mount and on month/year change to show preview count
- Shows preview count: "X recurring expenses to generate for March 2026"
- "Generate" button calls `generateExpenses` to create expense records
- Success toast: "Generated X expenses (Y already existed)"
- Invalidates `['expenses']`, `['financial-stats']`, and the preview count query caches on success

### 4. Outgoing Page Enhancement

**File:** `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`

- Add "Generate Expenses" button next to "New Expense" in the header
- Opens `GenerateExpensesDialog`

## Edge Cases

- **Template amount changed after generation:** Previously generated expenses keep their original amount. Only future generations use the updated template amount.
- **Template deleted after generation:** Generated expenses remain (foreign key uses `ON DELETE SET NULL`). Their `recurring_expense_id` becomes null, so they behave like manually created expenses.
- **End date in the middle of a month:** Template is eligible for that month. The `end_date >= first day of target month` check ensures partial-month coverage still generates.
- **Start date in the future:** Template is skipped for months before `start_date`. The `start_date <= last day of target month` check handles this.
- **Multiple generations in same month:** Idempotent via `generated_for_period` column and the partial unique index. Even if a user edits the `transaction_date` of a generated expense, the idempotency check still works because it uses `generated_for_period`, not `transaction_date`. Concurrent requests are also safe due to the DB-level unique constraint.
- **Service provider deleted:** `ON DELETE SET NULL` sets `provider_id` to null on the template. Future generations produce expenses without a vendor link. Already-generated expenses retain their original `provider_id` (also set null by cascade).
- **Property deleted:** `ON DELETE CASCADE` on `property_id` removes all recurring expense templates for that property. Already-generated expenses are also cascade-deleted via the same FK on the `expenses` table. This is intentional — a deleted property has no use for its expense history.

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260319000002_recurring_expenses.sql` | NEW - table + RLS + triggers + expenses columns |
| `packages/types/src/models.ts` | MODIFY - add RecurringExpense, update Expense |
| `modules/accounting/src/schemas/recurring-expense-schema.ts` | NEW - Zod schema |
| `modules/accounting/src/actions/create-recurring-expense.ts` | NEW |
| `modules/accounting/src/actions/update-recurring-expense.ts` | NEW |
| `modules/accounting/src/actions/delete-recurring-expense.ts` | NEW |
| `modules/accounting/src/actions/generate-expenses.ts` | NEW - contains both `generateExpenses` and `previewGenerateExpenses` |
| `modules/accounting/src/hooks/use-recurring-expenses.ts` | NEW |
| `modules/accounting/src/index.ts` | MODIFY - export hook + schema |
| `apps/web/components/accounting/recurring-expense-dialog.tsx` | NEW |
| `apps/web/components/accounting/generate-expenses-dialog.tsx` | NEW |
| `apps/web/components/properties/property-detail-tabs.tsx` | MODIFY - add Recurring tab + inline PropertyRecurringExpenses component |
| `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` | MODIFY - add Generate button |

## Acceptance Criteria

1. Create a recurring expense template (monthly mortgage) on a property -> record appears in recurring_expenses table
2. Edit/delete recurring expense templates
3. Generate expenses for a month -> expense records created with correct amounts, linked via `recurring_expense_id`, and tagged with `generated_for_period`
4. Re-running generation for the same month -> skips already-generated expenses (idempotent via `generated_for_period`)
5. Yearly expenses only generate in their start month
6. Inactive templates are skipped during generation
7. Templates with end_date before the target month are skipped
8. Preview shows correct count before generation
9. Generated expenses appear in the Outgoing page expense list

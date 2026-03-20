-- Extend invoices table for payable invoice support

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

-- Migrate existing expenses to paid payable invoices.
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

-- Recurring expense templates
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

-- Extend expenses table for generation tracking
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurring_expense_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS generated_for_period TEXT;

-- Enforce idempotency: one generated expense per template per period
CREATE UNIQUE INDEX idx_expenses_recurring_period
  ON public.expenses(recurring_expense_id, generated_for_period)
  WHERE recurring_expense_id IS NOT NULL;

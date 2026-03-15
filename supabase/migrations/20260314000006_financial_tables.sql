-- ============================================================
-- Migration 006: Financial Tables (income + expenses)
--
-- Phase 2: Financial Management
-- Depends on: organizations, properties, units tables (Phase 1)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)
-- ============================================================

-- -----------------------------------------------------------
-- income table
-- -----------------------------------------------------------
CREATE TABLE public.income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  income_type TEXT NOT NULL CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'other')),
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- expenses table
-- -----------------------------------------------------------
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  expense_type TEXT NOT NULL CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other'
  )),
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  receipt_url TEXT, -- upload UI deferred to future iteration
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------
CREATE INDEX idx_income_org_date ON public.income(org_id, transaction_date);
CREATE INDEX idx_income_property ON public.income(property_id);
CREATE INDEX idx_expenses_org_date ON public.expenses(org_id, transaction_date);
CREATE INDEX idx_expenses_property ON public.expenses(property_id);

-- -----------------------------------------------------------
-- RLS Policies — income
-- -----------------------------------------------------------
ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view income in their orgs"
  ON public.income FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert income in their orgs"
  ON public.income FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update income in their orgs"
  ON public.income FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete income in their orgs"
  ON public.income FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — expenses
-- -----------------------------------------------------------
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expenses in their orgs"
  ON public.expenses FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert expenses in their orgs"
  ON public.expenses FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update expenses in their orgs"
  ON public.expenses FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete expenses in their orgs"
  ON public.expenses FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- Updated-at triggers (moddatetime)
-- -----------------------------------------------------------
CREATE TRIGGER set_income_updated_at
  BEFORE UPDATE ON public.income
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Migration 008: Billing tables (invoices + payments)
-- Phase 4A: Invoice System & Accounting Restructure
-- ============================================================

-- Depends on: organizations, properties, units, leases, tenants, service_providers (Migrations 001-007)
-- Depends on: income, expenses tables (Migration 006)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)

-- ============================================================
-- Invoice number sequence function
-- Per-org, per-year, auto-incrementing: INV-2026-0001
-- Uses FOR UPDATE to prevent race conditions
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  max_seq INTEGER;
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(invoice_number FROM 'INV-' || current_year || '-(\d+)$')
        AS INTEGER
      )
    ),
    0
  )
  INTO max_seq
  FROM public.invoices
  WHERE org_id = p_org_id
    AND invoice_number LIKE 'INV-' || current_year || '-%'
  FOR UPDATE;

  next_seq := max_seq + 1;
  RETURN 'INV-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- Invoices table
-- ============================================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'partially_paid', 'paid', 'void')),
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique invoice number per org
CREATE UNIQUE INDEX idx_invoices_org_number ON public.invoices(org_id, invoice_number);

-- Filtered listing (direction + status)
CREATE INDEX idx_invoices_org_direction_status ON public.invoices(org_id, direction, status);

-- Idempotent generation check (lease + due_date month)
CREATE INDEX idx_invoices_lease_due ON public.invoices(lease_id, due_date);

-- moddatetime trigger for updated_at
CREATE TRIGGER handle_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Payments table
-- ============================================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'online', 'other')),
  reference_number TEXT,
  notes TEXT,
  income_id UUID REFERENCES public.income(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_org ON public.payments(org_id);

-- ============================================================
-- RLS Policies — Invoices
-- ============================================================
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices in their orgs"
  ON public.invoices FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update invoices"
  ON public.invoices FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete invoices"
  ON public.invoices FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RLS Policies — Payments
-- ============================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payments in their orgs"
  ON public.payments FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert payments"
  ON public.payments FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update payments"
  ON public.payments FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete payments"
  ON public.payments FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

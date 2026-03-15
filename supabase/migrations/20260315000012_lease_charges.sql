-- ============================================================
-- Migration 012: Lease charges, late fees, month-to-month support
-- ============================================================

-- 1. Create lease_charges table
CREATE TABLE public.lease_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'one_time')),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_lease_charges_lease ON public.lease_charges(lease_id);
CREATE INDEX idx_lease_charges_org_active ON public.lease_charges(org_id, is_active);

-- Updated_at trigger
CREATE TRIGGER set_lease_charges_updated_at
  BEFORE UPDATE ON public.lease_charges
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- RLS
ALTER TABLE public.lease_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease charges in their orgs"
  ON public.lease_charges FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert lease charges"
  ON public.lease_charges FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update lease charges"
  ON public.lease_charges FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete lease charges"
  ON public.lease_charges FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- 2. Add late fee + month-to-month columns to leases
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS late_fee_type TEXT DEFAULT NULL
    CHECK (late_fee_type IS NULL OR late_fee_type IN ('flat', 'percentage')),
  ADD COLUMN IF NOT EXISTS late_fee_amount DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS late_fee_grace_days INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_month_to_month BOOLEAN NOT NULL DEFAULT true;

-- Update status constraint to include 'month_to_month'
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_status_check;
ALTER TABLE public.leases ADD CONSTRAINT leases_status_check
  CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'month_to_month'));

-- 3. Add charge + late-fee linkage columns to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS lease_charge_id UUID REFERENCES public.lease_charges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_fee_for_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;

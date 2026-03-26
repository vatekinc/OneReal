-- ============================================================
-- Migration: Credits system (credits + credit_applications)
-- ============================================================

-- ============================================================
-- Update income_type constraint to allow 'advance_payment'
-- ============================================================
ALTER TABLE public.income DROP CONSTRAINT IF EXISTS income_income_type_check;
ALTER TABLE public.income ADD CONSTRAINT income_income_type_check
  CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'advance_payment', 'other'));

-- ============================================================
-- Add CHECK constraint on invoices.amount_paid
-- ============================================================
ALTER TABLE public.invoices ADD CONSTRAINT invoices_amount_paid_check
  CHECK (amount_paid <= amount);

-- ============================================================
-- Credits table
-- ============================================================
CREATE TABLE public.credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  amount_used DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (amount_used >= 0),
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'overpayment', 'advance_payment')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_applied', 'void')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credits_amount_used_lte_amount CHECK (amount_used <= amount)
);

CREATE INDEX idx_credits_org_tenant ON public.credits(org_id, tenant_id);
CREATE INDEX idx_credits_org_status ON public.credits(org_id, status);
CREATE INDEX idx_credits_org_property ON public.credits(org_id, property_id);

CREATE TRIGGER handle_credits_updated_at
  BEFORE UPDATE ON public.credits
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Credit Applications table
-- ============================================================
CREATE TABLE public.credit_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES public.credits(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  applied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_applications_credit ON public.credit_applications(credit_id);
CREATE INDEX idx_credit_applications_invoice ON public.credit_applications(invoice_id);
CREATE INDEX idx_credit_applications_org ON public.credit_applications(org_id);

-- ============================================================
-- RLS — Credits
-- ============================================================
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credits in their orgs"
  ON public.credits FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert credits"
  ON public.credits FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update credits"
  ON public.credits FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete credits"
  ON public.credits FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RLS — Credit Applications
-- ============================================================
ALTER TABLE public.credit_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credit applications in their orgs"
  ON public.credit_applications FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert credit applications"
  ON public.credit_applications FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update credit applications"
  ON public.credit_applications FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete credit applications"
  ON public.credit_applications FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RPC: get_tenant_credit_balance
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tenant_credit_balance(
  p_org_id UUID,
  p_tenant_id UUID,
  p_lease_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_credits NUMERIC,
  total_used NUMERIC,
  available_balance NUMERIC,
  active_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(c.amount), 0)::NUMERIC AS total_credits,
    COALESCE(SUM(c.amount_used), 0)::NUMERIC AS total_used,
    COALESCE(SUM(c.amount - c.amount_used), 0)::NUMERIC AS available_balance,
    COUNT(*)::INTEGER AS active_count
  FROM public.credits c
  WHERE c.org_id = p_org_id
    AND c.tenant_id = p_tenant_id
    AND c.status = 'active'
    AND (p_lease_id IS NULL OR c.lease_id IS NULL OR c.lease_id = p_lease_id);
END;
$$;

-- ============================================================
-- RPC: apply_credits_to_invoice
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_credits_to_invoice(
  p_org_id UUID,
  p_invoice_id UUID,
  p_applications JSONB,
  p_applied_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice RECORD;
  v_credit RECORD;
  v_app JSONB;
  v_apply_amount DECIMAL(10,2);
  v_total_applied DECIMAL(10,2) := 0;
  v_invoice_remaining DECIMAL(10,2);
  v_credit_remaining DECIMAL(10,2);
  v_new_amount_paid DECIMAL(10,2);
  v_new_status TEXT;
BEGIN
  -- Lock and fetch invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status IN ('void', 'draft') THEN
    RAISE EXCEPTION 'Cannot apply credits to a % invoice', v_invoice.status;
  END IF;

  v_invoice_remaining := v_invoice.amount - v_invoice.amount_paid;

  -- Process each credit application
  FOR v_app IN SELECT * FROM jsonb_array_elements(p_applications)
  LOOP
    v_apply_amount := (v_app->>'amount')::DECIMAL(10,2);

    IF v_apply_amount <= 0 THEN
      RAISE EXCEPTION 'Application amount must be positive';
    END IF;

    -- Lock and fetch credit
    SELECT * INTO v_credit
    FROM public.credits
    WHERE id = (v_app->>'credit_id')::UUID
      AND org_id = p_org_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credit % not found or not active', v_app->>'credit_id';
    END IF;

    -- Validate credit belongs to same tenant
    IF v_credit.tenant_id != v_invoice.tenant_id THEN
      RAISE EXCEPTION 'Credit tenant does not match invoice tenant';
    END IF;

    -- Validate lease scope
    IF v_credit.lease_id IS NOT NULL AND v_credit.lease_id != v_invoice.lease_id THEN
      RAISE EXCEPTION 'Lease-scoped credit does not match invoice lease';
    END IF;

    v_credit_remaining := v_credit.amount - v_credit.amount_used;

    IF v_apply_amount > v_credit_remaining THEN
      RAISE EXCEPTION 'Application amount % exceeds credit remaining %', v_apply_amount, v_credit_remaining;
    END IF;

    v_total_applied := v_total_applied + v_apply_amount;

    IF v_total_applied > v_invoice_remaining THEN
      RAISE EXCEPTION 'Total applied % exceeds invoice remaining %', v_total_applied, v_invoice_remaining;
    END IF;

    -- Insert credit application
    INSERT INTO public.credit_applications (org_id, credit_id, invoice_id, amount, applied_by)
    VALUES (p_org_id, v_credit.id, p_invoice_id, v_apply_amount, p_applied_by);

    -- Update credit
    UPDATE public.credits
    SET amount_used = amount_used + v_apply_amount,
        status = CASE WHEN amount_used + v_apply_amount >= amount THEN 'fully_applied' ELSE 'active' END
    WHERE id = v_credit.id;
  END LOOP;

  -- Update invoice
  v_new_amount_paid := v_invoice.amount_paid + v_total_applied;
  v_new_status := CASE WHEN v_new_amount_paid >= v_invoice.amount THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET amount_paid = v_new_amount_paid, status = v_new_status
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('total_applied', v_total_applied, 'new_status', v_new_status);
END;
$$;

-- ============================================================
-- RPC: record_payment_with_overpayment
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_payment_with_overpayment(
  p_org_id UUID,
  p_invoice_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_method TEXT,
  p_payment_date DATE,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice RECORD;
  v_remaining DECIMAL(10,2);
  v_invoice_payment DECIMAL(10,2);
  v_excess DECIMAL(10,2);
  v_income_type TEXT;
  v_income_id UUID;
  v_expense_id UUID;
  v_payment_id UUID;
  v_credit_id UUID := NULL;
BEGIN
  -- Lock and fetch invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status IN ('void', 'paid') THEN
    RAISE EXCEPTION 'Cannot pay a % invoice', v_invoice.status;
  END IF;

  v_remaining := v_invoice.amount - v_invoice.amount_paid;

  -- Reject overpayments on payable invoices (credits only apply to receivables)
  IF v_invoice.direction = 'payable' AND p_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment exceeds remaining balance of %', v_remaining;
  END IF;

  v_invoice_payment := LEAST(p_amount, v_remaining);
  v_excess := GREATEST(p_amount - v_remaining, 0);

  -- Create income or expense record
  IF v_invoice.direction = 'receivable' THEN
    v_income_type := CASE
      WHEN LOWER(COALESCE(v_invoice.description, '')) LIKE '%rent%' THEN 'rent'
      WHEN LOWER(COALESCE(v_invoice.description, '')) LIKE '%deposit%' THEN 'deposit'
      ELSE 'other'
    END;

    INSERT INTO public.income (org_id, property_id, unit_id, amount, income_type, description, transaction_date)
    VALUES (p_org_id, v_invoice.property_id, v_invoice.unit_id, p_amount, v_income_type,
            'Payment for ' || v_invoice.invoice_number, p_payment_date)
    RETURNING id INTO v_income_id;
  ELSE
    INSERT INTO public.expenses (org_id, property_id, unit_id, amount, expense_type, description, transaction_date, provider_id)
    VALUES (p_org_id, v_invoice.property_id, v_invoice.unit_id, p_amount,
            COALESCE(v_invoice.expense_type, 'other'),
            'Payment for ' || v_invoice.invoice_number, p_payment_date, v_invoice.provider_id)
    RETURNING id INTO v_expense_id;
  END IF;

  -- Create payment record
  INSERT INTO public.payments (org_id, invoice_id, amount, payment_date, payment_method, reference_number, notes, income_id, expense_id)
  VALUES (p_org_id, p_invoice_id, p_amount, p_payment_date, p_payment_method, p_reference_number, p_notes, v_income_id, v_expense_id)
  RETURNING id INTO v_payment_id;

  -- Update invoice
  UPDATE public.invoices
  SET amount_paid = amount_paid + v_invoice_payment,
      status = CASE WHEN amount_paid + v_invoice_payment >= amount THEN 'paid' ELSE 'partially_paid' END
  WHERE id = p_invoice_id;

  -- Create overpayment credit if excess
  IF v_excess > 0 AND v_invoice.direction = 'receivable' THEN
    INSERT INTO public.credits (org_id, tenant_id, lease_id, property_id, amount, reason, source, invoice_id, created_by)
    VALUES (
      p_org_id,
      v_invoice.tenant_id,
      v_invoice.lease_id,
      v_invoice.property_id,
      v_excess,
      'Overpayment on invoice ' || v_invoice.invoice_number,
      'overpayment',
      p_invoice_id,
      p_user_id
    )
    RETURNING id INTO v_credit_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'credit_id', v_credit_id,
    'overpayment_amount', v_excess
  );
END;
$$;

-- ============================================================
-- RPC: void_credit
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_credit(
  p_org_id UUID,
  p_credit_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit RECORD;
BEGIN
  SELECT * INTO v_credit
  FROM public.credits
  WHERE id = p_credit_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found';
  END IF;

  IF v_credit.status = 'void' THEN
    RAISE EXCEPTION 'Credit is already void';
  END IF;

  UPDATE public.credits
  SET status = 'void'
  WHERE id = p_credit_id;
END;
$$;

-- ============================================================
-- RPC: reverse_invoice_credit_applications
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_invoice_credit_applications(
  p_org_id UUID,
  p_invoice_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_app RECORD;
  v_count INTEGER := 0;
  v_total_reversed DECIMAL(10,2) := 0;
BEGIN
  FOR v_app IN
    SELECT * FROM public.credit_applications
    WHERE invoice_id = p_invoice_id AND org_id = p_org_id AND status = 'active'
    FOR UPDATE
  LOOP
    UPDATE public.credit_applications
    SET status = 'reversed', reversed_at = now()
    WHERE id = v_app.id;

    UPDATE public.credits
    SET amount_used = amount_used - v_app.amount,
        status = 'active'
    WHERE id = v_app.credit_id;

    v_total_reversed := v_total_reversed + v_app.amount;
    v_count := v_count + 1;
  END LOOP;

  IF v_total_reversed > 0 THEN
    UPDATE public.invoices
    SET amount_paid = amount_paid - v_total_reversed
    WHERE id = p_invoice_id;
  END IF;

  RETURN v_count;
END;
$$;

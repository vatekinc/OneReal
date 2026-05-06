-- ============================================================
-- Migration: Security Deposit Refunds
--   - Adds tenant_id + lease_id to expenses (nullable)
--   - Extends expenses.expense_type to include 'deposit_refund'
--   - Creates deposit_refunds + deposit_refund_deductions tables
--   - Creates RPCs: next_deposit_refund_number,
--     get_lease_deposit_summary, create_deposit_refund,
--     void_deposit_refund
-- ============================================================

-- ------------------------------------------------------------
-- 1. Modify expenses table
-- ------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN lease_id  UUID REFERENCES public.leases(id)  ON DELETE SET NULL;

CREATE INDEX idx_expenses_lease  ON public.expenses(lease_id);
CREATE INDEX idx_expenses_tenant ON public.expenses(tenant_id);

ALTER TABLE public.expenses DROP CONSTRAINT expenses_expense_type_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_type_check
  CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty',
    'deposit_refund', 'other'
  ));

-- ------------------------------------------------------------
-- 2. deposit_refunds table
-- ------------------------------------------------------------
CREATE TABLE public.deposit_refunds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id         UUID NOT NULL REFERENCES public.leases(id)        ON DELETE RESTRICT,
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id)       ON DELETE RESTRICT,
  refund_amount    DECIMAL(10,2) NOT NULL CHECK (refund_amount > 0),
  refund_date      DATE NOT NULL,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('check','ach','cash','other')),
  refund_number    TEXT NOT NULL,
  reference_number TEXT,
  notes            TEXT,
  expense_id       UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, refund_number)
);

CREATE INDEX idx_deposit_refunds_lease  ON public.deposit_refunds(org_id, lease_id);
CREATE INDEX idx_deposit_refunds_tenant ON public.deposit_refunds(org_id, tenant_id);
CREATE INDEX idx_deposit_refunds_status ON public.deposit_refunds(org_id, status);

CREATE TRIGGER handle_deposit_refunds_updated_at
  BEFORE UPDATE ON public.deposit_refunds
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ------------------------------------------------------------
-- 3. deposit_refund_deductions junction
-- ------------------------------------------------------------
CREATE TABLE public.deposit_refund_deductions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_refund_id   UUID NOT NULL REFERENCES public.deposit_refunds(id) ON DELETE CASCADE,
  expense_id          UUID NOT NULL REFERENCES public.expenses(id)        ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deposit_refund_id, expense_id)
);

CREATE INDEX idx_deposit_refund_deductions_expense
  ON public.deposit_refund_deductions(expense_id);

-- ------------------------------------------------------------
-- 4. RLS — deposit_refunds
-- ------------------------------------------------------------
ALTER TABLE public.deposit_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deposit refunds in their orgs"
  ON public.deposit_refunds FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert deposit refunds"
  ON public.deposit_refunds FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update deposit refunds"
  ON public.deposit_refunds FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete deposit refunds"
  ON public.deposit_refunds FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ------------------------------------------------------------
-- 5. RLS — deposit_refund_deductions
-- ------------------------------------------------------------
ALTER TABLE public.deposit_refund_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deposit refund deductions in their orgs"
  ON public.deposit_refund_deductions FOR SELECT
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_org_ids())
    )
  );

CREATE POLICY "Managers can insert deposit refund deductions"
  ON public.deposit_refund_deductions FOR INSERT
  WITH CHECK (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

CREATE POLICY "Managers can delete deposit refund deductions"
  ON public.deposit_refund_deductions FOR DELETE
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

-- ------------------------------------------------------------
-- 6. RPC: next_deposit_refund_number
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_deposit_refund_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  max_seq      INTEGER;
  next_seq     INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::TEXT || '_deposit_refund'));

  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(refund_number FROM 'DR-' || current_year || '-(\d+)$')
        AS INTEGER
      )
    ),
    0
  )
  INTO max_seq
  FROM public.deposit_refunds
  WHERE org_id = p_org_id
    AND refund_number LIKE 'DR-' || current_year || '-%';

  next_seq := max_seq + 1;
  RETURN 'DR-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

-- ------------------------------------------------------------
-- 7. RPC: get_lease_deposit_summary
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lease_deposit_summary(
  p_org_id   UUID,
  p_lease_id UUID
)
RETURNS TABLE (
  held         NUMERIC,
  refunded     NUMERIC,
  withheld     NUMERIC,
  balance      NUMERIC,
  refund_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_held     NUMERIC;
  v_refunded NUMERIC;
  v_withheld NUMERIC;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_user_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT COALESCE(deposit_amount, 0)
    INTO v_held
    FROM public.leases
    WHERE id = p_lease_id AND org_id = p_org_id;

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refunded
    FROM public.deposit_refunds
    WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active';

  SELECT COALESCE(SUM(e.amount), 0)
    INTO v_withheld
    FROM public.deposit_refund_deductions d
    JOIN public.deposit_refunds r ON r.id = d.deposit_refund_id
    JOIN public.expenses e        ON e.id = d.expense_id
    WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';

  RETURN QUERY
  SELECT
    v_held,
    v_refunded,
    v_withheld,
    v_held - v_refunded - v_withheld,
    (SELECT COUNT(*)::INT
       FROM public.deposit_refunds
       WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active');
END;
$$;

-- ------------------------------------------------------------
-- 8. RPC: create_deposit_refund
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_deposit_refund(
  p_org_id                UUID,
  p_lease_id              UUID,
  p_refund_amount         DECIMAL(10,2),
  p_refund_date           DATE,
  p_payment_method        TEXT,
  p_reference_number      TEXT,
  p_notes                 TEXT,
  p_deduction_expense_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lease            RECORD;
  v_tenant_id        UUID;
  v_existing_total   DECIMAL(10,2);
  v_deductions_total DECIMAL(10,2);
  v_balance          DECIMAL(10,2);
  v_expense_id       UUID;
  v_refund_id        UUID;
  v_refund_number    TEXT;
  v_eligible_count   INT;
  v_already_linked   INT;
BEGIN
  -- Step 1: authorize
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Step 2: lock lease and resolve fields
  SELECT l.id, l.deposit_amount, l.start_date, l.end_date,
         u.property_id, u.id AS unit_id
    INTO v_lease
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    WHERE l.id = p_lease_id AND l.org_id = p_org_id
    FOR UPDATE OF l;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease not found';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.lease_tenants
    WHERE lease_id = p_lease_id
    ORDER BY created_at ASC
    LIMIT 1;

  -- Step 3 & 4: validate deposit + tenants exist
  IF v_lease.deposit_amount IS NULL OR v_lease.deposit_amount = 0 THEN
    RAISE EXCEPTION 'Lease has no deposit on file';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Lease has no tenants linked';
  END IF;

  -- Step 5: existing refund total
  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_existing_total
    FROM public.deposit_refunds
    WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active';

  -- Step 6: validate every deduction expense
  -- De-duplicate input array first so count comparisons are accurate
  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    p_deduction_expense_ids := ARRAY(SELECT DISTINCT unnest(p_deduction_expense_ids));

    SELECT COUNT(*) INTO v_eligible_count
      FROM public.expenses e
      WHERE e.id = ANY(p_deduction_expense_ids)
        AND e.org_id = p_org_id
        AND (
          e.lease_id = p_lease_id
          OR (
            e.property_id = v_lease.property_id
            AND e.transaction_date >= v_lease.start_date
            AND e.transaction_date <= COALESCE(v_lease.end_date, CURRENT_DATE) + INTERVAL '60 days'
          )
        );

    IF v_eligible_count <> array_length(p_deduction_expense_ids, 1) THEN
      RAISE EXCEPTION 'One or more deduction expenses are not eligible for this lease';
    END IF;

    SELECT COUNT(*) INTO v_already_linked
      FROM public.deposit_refund_deductions d
      JOIN public.deposit_refunds r ON r.id = d.deposit_refund_id
      WHERE d.expense_id = ANY(p_deduction_expense_ids)
        AND r.status = 'active';

    IF v_already_linked > 0 THEN
      RAISE EXCEPTION 'One or more deduction expenses are already linked to an active refund';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_deductions_total
      FROM public.expenses
      WHERE id = ANY(p_deduction_expense_ids);
  ELSE
    v_deductions_total := 0;
  END IF;

  -- Step 8: over-refund check
  IF v_existing_total + v_deductions_total + p_refund_amount > v_lease.deposit_amount THEN
    RAISE EXCEPTION 'Refund of $% plus $% in deductions exceeds remaining deposit balance of $%',
      p_refund_amount, v_deductions_total,
      v_lease.deposit_amount - v_existing_total;
  END IF;

  -- Step 9: refund number
  v_refund_number := public.next_deposit_refund_number(p_org_id);

  -- Step 10: paired expense row
  INSERT INTO public.expenses (
    org_id, property_id, unit_id, amount, expense_type, description,
    transaction_date, lease_id, tenant_id
  )
  VALUES (
    p_org_id, v_lease.property_id, v_lease.unit_id, p_refund_amount,
    'deposit_refund', 'Deposit refund ' || v_refund_number,
    p_refund_date, p_lease_id, v_tenant_id
  )
  RETURNING id INTO v_expense_id;

  -- Step 11: deposit_refunds row
  INSERT INTO public.deposit_refunds (
    org_id, lease_id, tenant_id, refund_amount, refund_date,
    payment_method, refund_number, reference_number, notes,
    expense_id, created_by
  )
  VALUES (
    p_org_id, p_lease_id, v_tenant_id, p_refund_amount, p_refund_date,
    p_payment_method, v_refund_number, p_reference_number, p_notes,
    v_expense_id, auth.uid()
  )
  RETURNING id INTO v_refund_id;

  -- Step 12: junction rows
  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    INSERT INTO public.deposit_refund_deductions (deposit_refund_id, expense_id)
    SELECT v_refund_id, unnest(p_deduction_expense_ids);
  END IF;

  v_balance := v_lease.deposit_amount - v_existing_total - v_deductions_total - p_refund_amount;

  RETURN jsonb_build_object(
    'refund_id',         v_refund_id,
    'expense_id',        v_expense_id,
    'refund_number',     v_refund_number,
    'balance_remaining', v_balance
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. RPC: void_deposit_refund
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_deposit_refund(
  p_org_id    UUID,
  p_refund_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_refund RECORD;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT * INTO v_refund
    FROM public.deposit_refunds
    WHERE id = p_refund_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit refund not found';
  END IF;

  IF v_refund.status = 'void' THEN
    RAISE EXCEPTION 'Deposit refund is already void';
  END IF;

  UPDATE public.deposit_refunds
     SET status = 'void'
     WHERE id = p_refund_id;

  -- Delete junction rows BEFORE the paired expense so the
  -- ON DELETE RESTRICT FK from junction → expenses doesn't fire.
  DELETE FROM public.deposit_refund_deductions
    WHERE deposit_refund_id = p_refund_id;

  IF v_refund.expense_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = v_refund.expense_id;
  END IF;
END;
$$;

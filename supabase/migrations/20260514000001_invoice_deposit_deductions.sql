-- ============================================================
-- Migration: Invoice-Based Deposit Deductions
--   - Extends payments.payment_method to include 'deposit'
--   - Creates deposit_refund_invoice_settlements junction
--   - Drops old 8-arg create_deposit_refund, recreates with
--     9-arg signature (p_settle_invoice_ids) + over-refund
--     guard spanning ALL active refunds
--   - Replaces get_lease_deposit_summary (settlements folded
--     into withheld/balance)
--   - Replaces void_deposit_refund (symmetric settlement
--     reversal)
--   - Replaces void_payment (rejects voiding deposit-sourced
--     settlement payments)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend payments.payment_method
-- ------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash','check','bank_transfer','online','other','deposit'));

-- ------------------------------------------------------------
-- 2. deposit_refund_invoice_settlements junction
-- ------------------------------------------------------------
CREATE TABLE public.deposit_refund_invoice_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_refund_id UUID NOT NULL REFERENCES public.deposit_refunds(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES public.invoices(id)        ON DELETE RESTRICT,
  amount            DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  payment_id        UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  income_id         UUID REFERENCES public.income(id)   ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deposit_refund_id, invoice_id)
);

CREATE INDEX idx_drinv_settlements_refund  ON public.deposit_refund_invoice_settlements(deposit_refund_id);
CREATE INDEX idx_drinv_settlements_invoice ON public.deposit_refund_invoice_settlements(invoice_id);

-- ------------------------------------------------------------
-- 3. RLS — deposit_refund_invoice_settlements
-- ------------------------------------------------------------
ALTER TABLE public.deposit_refund_invoice_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deposit refund invoice settlements in their orgs"
  ON public.deposit_refund_invoice_settlements FOR SELECT
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_org_ids())
    )
  );

CREATE POLICY "Managers can insert deposit refund invoice settlements"
  ON public.deposit_refund_invoice_settlements FOR INSERT
  WITH CHECK (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

CREATE POLICY "Managers can delete deposit refund invoice settlements"
  ON public.deposit_refund_invoice_settlements FOR DELETE
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

-- ------------------------------------------------------------
-- 4. RPC: get_lease_deposit_summary (replace — add invoice settlements)
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
  v_held            NUMERIC;
  v_refunded        NUMERIC;
  v_withheld        NUMERIC;
  v_invoice_withheld NUMERIC;
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

  SELECT COALESCE(SUM(s.amount), 0)
    INTO v_invoice_withheld
    FROM public.deposit_refund_invoice_settlements s
    JOIN public.deposit_refunds r ON r.id = s.deposit_refund_id
    WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';

  RETURN QUERY
  SELECT
    v_held,
    v_refunded,
    v_withheld + v_invoice_withheld,
    v_held - v_refunded - v_withheld - v_invoice_withheld,
    (SELECT COUNT(*)::INT
       FROM public.deposit_refunds
       WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active');
END;
$$;

-- ------------------------------------------------------------
-- 5. RPC: create_deposit_refund (drop old 8-arg, recreate 9-arg)
--    Postgres CREATE OR REPLACE with a changed arg list creates
--    a SEPARATE overload; drop the old signature first so only
--    the 9-arg version remains (DECIMAL(10,2) -> numeric in the
--    DROP FUNCTION signature).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_deposit_refund(
  uuid, uuid, numeric, date, text, text, text, uuid[]
);

CREATE OR REPLACE FUNCTION public.create_deposit_refund(
  p_org_id                UUID,
  p_lease_id              UUID,
  p_refund_amount         DECIMAL(10,2),
  p_refund_date           DATE,
  p_payment_method        TEXT,
  p_reference_number      TEXT,
  p_notes                 TEXT,
  p_deduction_expense_ids UUID[],
  p_settle_invoice_ids    UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lease              RECORD;
  v_tenant_id          UUID;
  v_prior_refunds      DECIMAL(10,2);
  v_prior_expense_ded  DECIMAL(10,2);
  v_prior_invoice_set  DECIMAL(10,2);
  v_deductions_total   DECIMAL(10,2);
  v_new_invoice_total  DECIMAL(10,2);
  v_balance            DECIMAL(10,2);
  v_expense_id         UUID;
  v_refund_id          UUID;
  v_refund_number      TEXT;
  v_eligible_count     INT;
  v_already_linked     INT;
  v_inv                RECORD;
  v_outstanding        DECIMAL(10,2);
  v_income_id          UUID;
  v_payment_id         UUID;
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

  -- Step 5: prior active aggregates on the lease (spans ALL active refunds)
  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_prior_refunds
    FROM public.deposit_refunds
    WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active';

  SELECT COALESCE(SUM(e.amount), 0)
    INTO v_prior_expense_ded
    FROM public.deposit_refund_deductions d
    JOIN public.deposit_refunds r ON r.id = d.deposit_refund_id
    JOIN public.expenses e        ON e.id = d.expense_id
    WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';

  SELECT COALESCE(SUM(s.amount), 0)
    INTO v_prior_invoice_set
    FROM public.deposit_refund_invoice_settlements s
    JOIN public.deposit_refunds r ON r.id = s.deposit_refund_id
    WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';

  -- Step 6: validate every deduction expense (unchanged logic; de-dup first)
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

  -- Step 7: validate every invoice to settle (de-dup first)
  IF p_settle_invoice_ids IS NOT NULL AND array_length(p_settle_invoice_ids, 1) > 0 THEN
    p_settle_invoice_ids := ARRAY(SELECT DISTINCT unnest(p_settle_invoice_ids));

    SELECT COUNT(*) INTO v_eligible_count
      FROM public.invoices i
      WHERE i.id = ANY(p_settle_invoice_ids)
        AND i.org_id = p_org_id
        AND i.direction = 'receivable'
        AND i.status IN ('open','partially_paid')
        AND i.lease_id = p_lease_id;

    IF v_eligible_count <> array_length(p_settle_invoice_ids, 1) THEN
      RAISE EXCEPTION 'One or more invoices are not eligible to settle for this lease (must be open/partially_paid receivable invoices on this lease)';
    END IF;

    SELECT COUNT(*) INTO v_already_linked
      FROM public.deposit_refund_invoice_settlements s
      JOIN public.deposit_refunds r ON r.id = s.deposit_refund_id
      WHERE s.invoice_id = ANY(p_settle_invoice_ids)
        AND r.status = 'active';

    IF v_already_linked > 0 THEN
      RAISE EXCEPTION 'One or more invoices are already settled by an active refund';
    END IF;

    SELECT COALESCE(SUM(i.amount - i.amount_paid), 0)
      INTO v_new_invoice_total
      FROM public.invoices i
      WHERE i.id = ANY(p_settle_invoice_ids);

    IF v_new_invoice_total <= 0 THEN
      RAISE EXCEPTION 'Selected invoices have no outstanding balance to settle';
    END IF;
  ELSE
    v_new_invoice_total := 0;
  END IF;

  -- Step 8: over-refund check (spans ALL active refunds on the lease;
  --   guard provably equals get_lease_deposit_summary.balance < 0)
  IF v_prior_refunds + v_prior_expense_ded + v_prior_invoice_set
     + v_deductions_total + v_new_invoice_total + p_refund_amount
     > v_lease.deposit_amount THEN
    RAISE EXCEPTION
      'Refund of $% + $% expense deductions + $% invoice settlements exceeds remaining deposit balance of $%',
      p_refund_amount, v_deductions_total, v_new_invoice_total,
      v_lease.deposit_amount - v_prior_refunds - v_prior_expense_ded - v_prior_invoice_set;
  END IF;

  -- Step 9: refund number
  v_refund_number := public.next_deposit_refund_number(p_org_id);

  -- Step 10: paired expense row (cash refund — unchanged)
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

  -- Step 12: expense-deduction junction rows (unchanged)
  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    INSERT INTO public.deposit_refund_deductions (deposit_refund_id, expense_id)
    SELECT v_refund_id, unnest(p_deduction_expense_ids);
  END IF;

  -- Step 13: settle each invoice (income + payment + invoice update + junction)
  IF p_settle_invoice_ids IS NOT NULL AND array_length(p_settle_invoice_ids, 1) > 0 THEN
    FOR v_inv IN
      SELECT id, invoice_number, property_id, unit_id, amount, amount_paid
        FROM public.invoices
        WHERE id = ANY(p_settle_invoice_ids)
        FOR UPDATE
    LOOP
      v_outstanding := v_inv.amount - v_inv.amount_paid;

      IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'Invoice % has no outstanding balance', v_inv.invoice_number;
      END IF;

      INSERT INTO public.income (
        org_id, property_id, unit_id, amount, income_type,
        description, transaction_date
      )
      VALUES (
        p_org_id, v_inv.property_id, v_inv.unit_id, v_outstanding, 'other',
        'Deposit applied to ' || v_inv.invoice_number, p_refund_date
      )
      RETURNING id INTO v_income_id;

      INSERT INTO public.payments (
        org_id, invoice_id, amount, payment_date, payment_method,
        reference_number, notes, income_id
      )
      VALUES (
        p_org_id, v_inv.id, v_outstanding, p_refund_date, 'deposit',
        v_refund_number, 'Settled from security deposit', v_income_id
      )
      RETURNING id INTO v_payment_id;

      UPDATE public.invoices
        SET amount_paid = amount_paid + v_outstanding,
            status      = 'paid'
        WHERE id = v_inv.id;

      INSERT INTO public.deposit_refund_invoice_settlements (
        deposit_refund_id, invoice_id, amount, payment_id, income_id
      )
      VALUES (v_refund_id, v_inv.id, v_outstanding, v_payment_id, v_income_id);
    END LOOP;
  END IF;

  v_balance := v_lease.deposit_amount
             - v_prior_refunds - v_prior_expense_ded - v_prior_invoice_set
             - v_deductions_total - v_new_invoice_total - p_refund_amount;

  RETURN jsonb_build_object(
    'refund_id',               v_refund_id,
    'expense_id',              v_expense_id,
    'refund_number',           v_refund_number,
    'invoice_settlements_total', v_new_invoice_total,
    'balance_remaining',       v_balance
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. RPC: void_deposit_refund (replace — reverse settlements)
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
  v_s      RECORD;
  v_inv    RECORD;
  v_new_paid DECIMAL(10,2);
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

  -- Reverse each invoice settlement BEFORE the paired-expense deletion.
  FOR v_s IN
    SELECT * FROM public.deposit_refund_invoice_settlements
      WHERE deposit_refund_id = p_refund_id
  LOOP
    SELECT * INTO v_inv
      FROM public.invoices
      WHERE id = v_s.invoice_id
      FOR UPDATE;

    IF FOUND THEN
      v_new_paid := v_inv.amount_paid - v_s.amount;
      UPDATE public.invoices
        SET amount_paid = v_new_paid,
            status = CASE
              WHEN v_new_paid <= 0 THEN 'open'
              WHEN v_new_paid < v_inv.amount THEN 'partially_paid'
              ELSE 'paid'
            END
        WHERE id = v_s.invoice_id;
    END IF;

    IF v_s.payment_id IS NOT NULL THEN
      DELETE FROM public.payments WHERE id = v_s.payment_id;
    END IF;

    IF v_s.income_id IS NOT NULL THEN
      DELETE FROM public.income WHERE id = v_s.income_id;
    END IF;

    DELETE FROM public.deposit_refund_invoice_settlements WHERE id = v_s.id;
  END LOOP;

  -- Existing expense-deduction free + paired-expense delete (unchanged).
  DELETE FROM public.deposit_refund_deductions
    WHERE deposit_refund_id = p_refund_id;

  IF v_refund.expense_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = v_refund.expense_id;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 7. RPC: void_payment (replace — reject deposit-sourced settlement payments)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_payment(
  p_org_id    UUID,
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment      RECORD;
  v_invoice      RECORD;
  v_credit       RECORD;
  v_new_paid     DECIMAL(10,2);
  v_new_status   TEXT;
  v_settlement   RECORD;
BEGIN
  -- Step 1: authorize
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Step 2: lock payment
  SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status = 'void' THEN
    RAISE EXCEPTION 'Payment is already void';
  END IF;

  -- Step 2b: block voiding a deposit-sourced settlement payment
  SELECT s.id, r.refund_number
    INTO v_settlement
    FROM public.deposit_refund_invoice_settlements s
    JOIN public.deposit_refunds r ON r.id = s.deposit_refund_id
    WHERE s.payment_id = p_payment_id;

  IF FOUND THEN
    RAISE EXCEPTION
      'This payment was created by deposit refund %; void that refund to reverse it.',
      v_settlement.refund_number;
  END IF;

  -- Step 3: check overpayment credit (if any) — block if it has been used
  SELECT * INTO v_credit
    FROM public.credits
    WHERE payment_id = p_payment_id AND status = 'active'
    FOR UPDATE;

  IF FOUND AND v_credit.amount_used > 0 THEN
    RAISE EXCEPTION 'This payment created an overpayment credit that has been partially applied. Reverse the credit applications first, then try again.';
  END IF;

  -- Step 4: lock the invoice for the amount_paid update
  SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id = v_payment.invoice_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- Step 5: mark payment void
  UPDATE public.payments
    SET status = 'void'
    WHERE id = p_payment_id;

  -- Step 6: void the linked overpayment credit (if any)
  IF v_credit.id IS NOT NULL THEN
    UPDATE public.credits
      SET status = 'void'
      WHERE id = v_credit.id;
  END IF;

  -- Step 7: delete the income/expense row(s)
  IF v_payment.income_id IS NOT NULL THEN
    DELETE FROM public.income WHERE id = v_payment.income_id;
  END IF;
  IF v_payment.expense_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = v_payment.expense_id;
  END IF;

  -- Step 8: recompute invoice.amount_paid (sum of remaining active payments)
  SELECT COALESCE(SUM(amount), 0) INTO v_new_paid
    FROM public.payments
    WHERE invoice_id = v_invoice.id AND status = 'active';

  v_new_paid := LEAST(v_new_paid, v_invoice.amount);

  v_new_status := CASE
    WHEN v_new_paid >= v_invoice.amount THEN 'paid'
    WHEN v_new_paid > 0 THEN 'partially_paid'
    ELSE 'open'
  END;

  UPDATE public.invoices
    SET amount_paid = v_new_paid,
        status      = v_new_status
    WHERE id = v_invoice.id;

  RETURN jsonb_build_object(
    'payment_id',          p_payment_id,
    'voided_credit_id',    v_credit.id,
    'invoice_amount_paid', v_new_paid,
    'invoice_status',      v_new_status
  );
END;
$$;

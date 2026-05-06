-- ============================================================
-- Migration: Void Payment
--   - Adds status column to payments (active/void)
--   - Links overpayment credits back to their originating payment
--   - Updates record_payment_with_overpayment to set payment_id on credits
--   - Creates void_payment RPC
-- ============================================================

-- ------------------------------------------------------------
-- 1. payments.status
-- ------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'void'));

CREATE INDEX idx_payments_status ON public.payments(org_id, status);

-- ------------------------------------------------------------
-- 2. credits.payment_id
-- ------------------------------------------------------------
ALTER TABLE public.credits
  ADD COLUMN payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX idx_credits_payment ON public.credits(payment_id);

-- ------------------------------------------------------------
-- 3. Update record_payment_with_overpayment to set payment_id
--    on the overpayment credit so void_payment can find it.
-- ------------------------------------------------------------
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

  IF v_invoice.direction = 'payable' AND p_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment exceeds remaining balance of %', v_remaining;
  END IF;

  v_invoice_payment := LEAST(p_amount, v_remaining);
  v_excess := GREATEST(p_amount - v_remaining, 0);

  -- Income or expense ledger entry
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

  -- Payment row
  INSERT INTO public.payments (org_id, invoice_id, amount, payment_date, payment_method, reference_number, notes, income_id, expense_id)
  VALUES (p_org_id, p_invoice_id, p_amount, p_payment_date, p_payment_method, p_reference_number, p_notes, v_income_id, v_expense_id)
  RETURNING id INTO v_payment_id;

  -- Update invoice
  UPDATE public.invoices
  SET amount_paid = amount_paid + v_invoice_payment,
      status = CASE WHEN amount_paid + v_invoice_payment >= amount THEN 'paid' ELSE 'partially_paid' END
  WHERE id = p_invoice_id;

  -- Overpayment credit (now linked to the payment via payment_id)
  IF v_excess > 0 AND v_invoice.direction = 'receivable' THEN
    INSERT INTO public.credits (org_id, tenant_id, lease_id, property_id, amount, reason, source, invoice_id, payment_id, created_by)
    VALUES (
      p_org_id,
      v_invoice.tenant_id,
      v_invoice.lease_id,
      v_invoice.property_id,
      v_excess,
      'Overpayment on invoice ' || v_invoice.invoice_number,
      'overpayment',
      p_invoice_id,
      v_payment_id,
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

-- ------------------------------------------------------------
-- 4. RPC: void_payment
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
  --   We can't simply subtract v_payment.amount because the original payment
  --   may have been an overpayment — only the on-invoice portion sat in
  --   invoice.amount_paid (the rest became a credit). Recomputing from
  --   active payments is exact: amount_paid = LEAST(sum_payments, invoice.amount).
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
    'payment_id',         p_payment_id,
    'voided_credit_id',   v_credit.id,
    'invoice_amount_paid', v_new_paid,
    'invoice_status',      v_new_status
  );
END;
$$;

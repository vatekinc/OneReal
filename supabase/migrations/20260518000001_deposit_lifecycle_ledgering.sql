-- ============================================================
-- Migration: Deposit Lifecycle Ledgering
--   1. invoices.is_deposit + partial index
--   2. create_lease_deposit_invoice RPC (idempotent)
--   3. get_tenant_statement: deposit sub-ledger; exclude
--      deposits from the rent running_balance; 3 new columns
--   4. create_deposit_refund: exclude is_deposit invoices from
--      the settle-from-deposit eligibility (body-only replace)
--   5. Backfill active/month_to_month leases (invoice+payment
--      +income, marked paid)
-- ============================================================

-- ------------------------------------------------------------
-- 1. invoices.is_deposit
-- ------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN is_deposit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_invoices_deposit
  ON public.invoices (lease_id)
  WHERE is_deposit = true;

-- ------------------------------------------------------------
-- 2. RPC: create_lease_deposit_invoice (idempotent)
--    Auth guard is skipped when auth.uid() IS NULL (trusted
--    migration/backfill context); enforced for app callers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lease_deposit_invoice(
  p_org_id    UUID,
  p_lease_id  UUID,
  p_mark_paid BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lease      RECORD;
  v_tenant_id  UUID;
  v_invoice_id UUID;
  v_invoice_no TEXT;
  v_income_id  UUID;
BEGIN
  -- Step 1: authorize (app callers only; migration/backfill has no JWT)
  IF auth.uid() IS NOT NULL
     AND p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Step 2: idempotency — never a second non-void deposit invoice
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE lease_id = p_lease_id AND is_deposit = true AND status <> 'void'
  ) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- Step 3: resolve lease + primary tenant
  SELECT l.id, l.deposit_amount, l.start_date,
         u.property_id, u.id AS unit_id
    INTO v_lease
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    WHERE l.id = p_lease_id AND l.org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease not found';
  END IF;

  IF v_lease.deposit_amount IS NULL OR v_lease.deposit_amount = 0 THEN
    RAISE EXCEPTION 'Lease has no deposit on file';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.lease_tenants
    WHERE lease_id = p_lease_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Lease has no tenants linked';
  END IF;

  -- Step 4: create the deposit invoice (open)
  v_invoice_no := public.next_invoice_number(p_org_id);

  INSERT INTO public.invoices (
    org_id, invoice_number, direction, status, lease_id, tenant_id,
    property_id, unit_id, description, amount, amount_paid,
    due_date, issued_date, is_deposit
  )
  VALUES (
    p_org_id, v_invoice_no, 'receivable', 'open', p_lease_id, v_tenant_id,
    v_lease.property_id, v_lease.unit_id, 'Security deposit',
    v_lease.deposit_amount, 0,
    v_lease.start_date, CURRENT_DATE, true
  )
  RETURNING id INTO v_invoice_id;

  -- Step 5: backfill path — mark already collected
  --   Ordering is load-bearing: income FIRST, then payment carrying
  --   income_id, so the property statement's "manual income only"
  --   union (NOT EXISTS payments px WHERE px.income_id = inc.id)
  --   excludes this income and does not double-count it.
  IF p_mark_paid THEN
    INSERT INTO public.income (
      org_id, property_id, unit_id, amount, income_type,
      description, transaction_date
    )
    VALUES (
      p_org_id, v_lease.property_id, v_lease.unit_id, v_lease.deposit_amount,
      'deposit', 'Security deposit collected ' || v_invoice_no,
      v_lease.start_date
    )
    RETURNING id INTO v_income_id;

    INSERT INTO public.payments (
      org_id, invoice_id, amount, payment_date, payment_method,
      reference_number, notes, income_id
    )
    VALUES (
      p_org_id, v_invoice_id, v_lease.deposit_amount, v_lease.start_date,
      'other', v_invoice_no, 'Backfilled deposit collection', v_income_id
    );

    UPDATE public.invoices
      SET amount_paid = v_lease.deposit_amount, status = 'paid'
      WHERE id = v_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'status', CASE WHEN p_mark_paid THEN 'paid' ELSE 'open' END,
    'skipped', false
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. RPC: get_tenant_statement (replace)
--    - rent Charges/Late fees/Payments unions gain
--      `AND i.is_deposit = false` (deposits leave the rent ledger)
--    - 4 new deposit unions (deposit_charge informational 0/0;
--      deposit_payment in; deposit_refund/settlement out)
--    - 3 new columns; running_balance computed ONLY over
--      non-deposit rows; deposit_running ONLY over deposit rows
--    - the pre-existing rent Payments union's missing
--      p.status<>'void' filter is intentionally NOT changed
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_statement(
  p_org_id UUID,
  p_tenant_id UUID,
  p_property_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  txn_date DATE,
  sort_key BIGINT,
  txn_type TEXT,
  description TEXT,
  reference TEXT,
  charge_amount NUMERIC,
  payment_amount NUMERIC,
  running_balance NUMERIC,
  deposit_in NUMERIC,
  deposit_out NUMERIC,
  deposit_running NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    -- Charges (receivable invoices, excluding late fees AND deposits)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'charge'::TEXT AS txn_type,
      i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NULL
      AND i.is_deposit = false
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Late fees (exclude deposits)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'late_fee'::TEXT AS txn_type,
      'Late fee: ' || i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NOT NULL
      AND i.is_deposit = false
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Payments on non-deposit receivable invoices
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'payment'::TEXT AS txn_type,
      COALESCE(p.payment_method, '') || CASE WHEN p.reference_number IS NOT NULL AND p.reference_number <> '' THEN ' #' || p.reference_number ELSE '' END,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      p.amount AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.is_deposit = false
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Credits issued (informational — unchanged)
    SELECT
      cr.created_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM cr.created_at)::BIGINT AS sort_key,
      'credit'::TEXT AS txn_type,
      cr.reason AS description,
      LEFT(cr.id::TEXT, 8) AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM credits cr
    WHERE cr.org_id = p_org_id
      AND cr.tenant_id = p_tenant_id
      AND (cr.property_id = p_property_id OR cr.property_id IS NULL)
      AND (p_from IS NULL OR cr.created_at::DATE >= p_from)
      AND (p_to IS NULL OR cr.created_at::DATE <= p_to)

    UNION ALL

    -- Credit applications (reduces balance — unchanged)
    SELECT
      ca.applied_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM ca.applied_at)::BIGINT AS sort_key,
      'credit_applied'::TEXT AS txn_type,
      'Credit applied: ' || cr.reason AS description,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      ca.amount AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM credit_applications ca
    JOIN credits cr ON cr.id = ca.credit_id
    JOIN invoices i ON i.id = ca.invoice_id
    WHERE ca.org_id = p_org_id
      AND ca.status = 'active'
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND (p_from IS NULL OR ca.applied_at::DATE >= p_from)
      AND (p_to IS NULL OR ca.applied_at::DATE <= p_to)

    UNION ALL

    -- Deposit charge (informational 0/0, like the credit line)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'deposit_charge'::TEXT AS txn_type,
      i.description,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.is_deposit = true
      AND i.status NOT IN ('void', 'draft')
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Deposit payment (collection → deposit held +)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'deposit_payment'::TEXT AS txn_type,
      COALESCE(p.payment_method, '') || ' deposit payment' AS description,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount,
      p.amount AS deposit_in,
      0::NUMERIC AS deposit_out
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.is_deposit = true
      AND p.status <> 'void'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Deposit refund (cash returned → deposit held -)
    SELECT
      e.transaction_date AS txn_date,
      EXTRACT(EPOCH FROM e.created_at)::BIGINT AS sort_key,
      'deposit_refund'::TEXT AS txn_type,
      e.description,
      ''::TEXT AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      e.amount AS deposit_out
    FROM expenses e
    WHERE e.org_id = p_org_id
      AND e.tenant_id = p_tenant_id
      AND e.property_id = p_property_id
      AND e.expense_type = 'deposit_refund'
      AND (p_from IS NULL OR e.transaction_date >= p_from)
      AND (p_to IS NULL OR e.transaction_date <= p_to)

    UNION ALL

    -- Deposit settlement (withheld, applied to a charge → deposit held -)
    SELECT
      r.refund_date AS txn_date,
      EXTRACT(EPOCH FROM s.created_at)::BIGINT AS sort_key,
      'deposit_settlement'::TEXT AS txn_type,
      'Withheld from deposit, applied to ' || si.invoice_number AS description,
      si.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount,
      0::NUMERIC AS deposit_in,
      s.amount AS deposit_out
    FROM deposit_refund_invoice_settlements s
    JOIN deposit_refunds r ON r.id = s.deposit_refund_id
    JOIN leases l ON l.id = r.lease_id
    JOIN units u ON u.id = l.unit_id
    JOIN invoices si ON si.id = s.invoice_id
    WHERE r.org_id = p_org_id
      AND r.tenant_id = p_tenant_id
      AND r.status = 'active'
      AND u.property_id = p_property_id
      AND (p_from IS NULL OR r.refund_date >= p_from)
      AND (p_to IS NULL OR r.refund_date <= p_to)
  )
  SELECT
    l.txn_date,
    l.sort_key,
    l.txn_type,
    l.description,
    l.reference,
    l.charge_amount,
    l.payment_amount,
    SUM(CASE WHEN l.txn_type LIKE 'deposit\_%' THEN 0
             ELSE l.charge_amount - l.payment_amount END)
      OVER (ORDER BY l.txn_date, l.sort_key) AS running_balance,
    l.deposit_in,
    l.deposit_out,
    SUM(CASE WHEN l.txn_type LIKE 'deposit\_%' THEN l.deposit_in - l.deposit_out
             ELSE 0 END)
      OVER (ORDER BY l.txn_date, l.sort_key) AS deposit_running
  FROM ledger l
  ORDER BY l.txn_date, l.sort_key;
$$;

-- ------------------------------------------------------------
-- 4. RPC: create_deposit_refund (body-only replace — add
--    `AND i.is_deposit = false` to the Step-7 eligibility query
--    so a deposit invoice can never be a settle-from-deposit
--    candidate. Identical 9-arg signature → clean replace,
--    no DROP needed. Everything else byte-identical to the
--    20260514000001 definition.)
-- ------------------------------------------------------------
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
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

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

  IF v_lease.deposit_amount IS NULL OR v_lease.deposit_amount = 0 THEN
    RAISE EXCEPTION 'Lease has no deposit on file';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Lease has no tenants linked';
  END IF;

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

  IF p_settle_invoice_ids IS NOT NULL AND array_length(p_settle_invoice_ids, 1) > 0 THEN
    p_settle_invoice_ids := ARRAY(SELECT DISTINCT unnest(p_settle_invoice_ids));

    SELECT COUNT(*) INTO v_eligible_count
      FROM public.invoices i
      WHERE i.id = ANY(p_settle_invoice_ids)
        AND i.org_id = p_org_id
        AND i.direction = 'receivable'
        AND i.status IN ('open','partially_paid')
        AND i.lease_id = p_lease_id
        AND i.is_deposit = false;

    IF v_eligible_count <> array_length(p_settle_invoice_ids, 1) THEN
      RAISE EXCEPTION 'One or more invoices are not eligible to settle for this lease (must be open/partially_paid non-deposit receivable invoices on this lease)';
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

  IF v_prior_refunds + v_prior_expense_ded + v_prior_invoice_set
     + v_deductions_total + v_new_invoice_total + p_refund_amount
     > v_lease.deposit_amount THEN
    RAISE EXCEPTION
      'Refund of $% + $% expense deductions + $% invoice settlements exceeds remaining deposit balance of $%',
      p_refund_amount, v_deductions_total, v_new_invoice_total,
      v_lease.deposit_amount - v_prior_refunds - v_prior_expense_ded - v_prior_invoice_set;
  END IF;

  v_refund_number := public.next_deposit_refund_number(p_org_id);

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

  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    INSERT INTO public.deposit_refund_deductions (deposit_refund_id, expense_id)
    SELECT v_refund_id, unnest(p_deduction_expense_ids);
  END IF;

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
-- 5. Backfill: active/month_to_month leases with a deposit and
--    no existing non-void deposit invoice → invoice+payment
--    +income, marked paid. Per-lease error-isolated.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT l.id AS lease_id, l.org_id
    FROM public.leases l
    WHERE l.deposit_amount IS NOT NULL AND l.deposit_amount > 0
      AND l.status IN ('active','month_to_month')
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.lease_id = l.id AND i.is_deposit = true AND i.status <> 'void'
      )
  LOOP
    BEGIN
      PERFORM public.create_lease_deposit_invoice(r.org_id, r.lease_id, true);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Backfill skipped lease % (%): %', r.lease_id, r.org_id, SQLERRM;
    END;
  END LOOP;
END $$;

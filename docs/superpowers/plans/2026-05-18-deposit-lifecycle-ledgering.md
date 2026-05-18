# Deposit Lifecycle Ledgering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the security-deposit lifecycle visible — track each lease deposit as an `is_deposit` invoice, auto-create it on lease activate, backfill existing active leases as already-collected, surface deposit charge/payment/refund/settlement as a separate sub-ledger in the tenant statement (no rent-balance impact), and add an Accounting → Expenses page.

**Architecture:** One migration adds `invoices.is_deposit`, a `create_lease_deposit_invoice` RPC, a rewritten `get_tenant_statement` (deposit sub-ledger + rent-union exclusions + 3 new return columns), a body-only `create_deposit_refund` replace (exclude deposit invoices from the settle picker), and a backfill block. TS: extend the statement type/query/table, add the `is_deposit=false` filter to `useEligibleInvoiceSettlements`, wire the RPC into `createLease`/`updateLease`, and add the Expenses page. `lease.deposit_amount` stays the authoritative "Held" — the deposit-refund feature is otherwise untouched.

**Tech Stack:** PostgreSQL (Supabase), Next.js 15, TypeScript, React Query, react-hook-form + zod, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-18-deposit-lifecycle-ledgering-design.md](../specs/2026-05-18-deposit-lifecycle-ledgering-design.md)

**Note on testing:** no automated suite for these flows; `pnpm type-check` is the gate. Each chunk ends with manual SQL/UI smoke steps (consistent with the prior two deposit plans).

**Plan-introduced correction (not in spec):** the spec says the backfill bypasses the RPC auth guard "by design" but does not say how. A `SECURITY DEFINER` body still executes its `IF p_org_id NOT IN (SELECT get_user_managed_org_ids())` guard, and in migration context `auth.uid()` is NULL so `get_user_managed_org_ids()` is empty → the guard would `RAISE` and abort the backfill. This plan's RPC guards with `IF auth.uid() IS NOT NULL AND p_org_id NOT IN (...) THEN RAISE` — enforced for authenticated app callers, skipped for the trusted no-JWT migration/backfill context. This is the only deviation from the spec text and is required for correctness.

---

## Chunk 1: Database Migration

### Task 1.1: Write + apply the migration

**Files:**
- Create: `supabase/migrations/20260518000001_deposit_lifecycle_ledgering.sql`

- [ ] **Step 1: Create the migration file with this exact content**

```sql
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
```

- [ ] **Step 2: Confirm file exists**

Run: `ls -la supabase/migrations/20260518000001_deposit_lifecycle_ledgering.sql` — non-zero size.

- [ ] **Step 3: Dry-run (the worktree must have `supabase/.temp` copied in — it is gitignored and not shared into worktrees)**

From the main checkout, copy the link state into the worktree first (controller does this; documented for completeness):
```
cp -r supabase/.temp <worktree>/supabase/.temp
```
Then from the worktree root:
```
npx supabase db push --dry-run
```
Expected: lists ONLY `20260518000001_deposit_lifecycle_ledgering.sql`. If it lists other migrations or errors on auth, STOP and report.

- [ ] **Step 4: Apply**

```
echo "y" | npx supabase db push
```
Expected: `Applying migration 20260518000001_deposit_lifecycle_ledgering.sql...` then `Finished supabase db push.`

- [ ] **Step 5: Manual smoke — schema + objects**

In the Supabase SQL editor:
```sql
-- column exists
SELECT 1 FROM information_schema.columns
WHERE table_name='invoices' AND column_name='is_deposit';        -- 1 row

-- functions present, correct arg counts
SELECT proname, pronargs FROM pg_proc
WHERE proname IN ('create_lease_deposit_invoice','get_tenant_statement','create_deposit_refund');
-- create_lease_deposit_invoice=3, get_tenant_statement=5, create_deposit_refund=9

-- get_tenant_statement returns the 3 new columns
SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
FROM information_schema.columns
WHERE table_name = 'get_tenant_statement';   -- if not introspectable, skip; covered by Chunk 4 smoke

-- backfill ran: every active/m2m lease with a deposit has a paid deposit invoice
SELECT l.id
FROM leases l
WHERE l.deposit_amount > 0 AND l.status IN ('active','month_to_month')
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.lease_id=l.id AND i.is_deposit);
-- 0 rows (every qualifying lease now has one)

-- 33-DowSt active lease specifically
SELECT i.invoice_number, i.amount, i.amount_paid, i.status, i.is_deposit
FROM invoices i
JOIN leases l ON l.id = i.lease_id
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = u.property_id
WHERE p.name = '33-DowSt' AND l.status='active' AND i.is_deposit;
-- 1 row: amount=3600.00, amount_paid=3600.00, status='paid'
```

- [ ] **Step 6: Commit (worktree, feature branch)**

```
git add supabase/migrations/20260518000001_deposit_lifecycle_ledgering.sql
git commit -m "feat(deposits): migration for deposit lifecycle ledgering"
```

---

## Chunk 2: Backend TypeScript

### Task 2.1: Extend the statement type + query mapping

**Files:**
- Modify: `packages/types/src/models.ts` (the `TenantStatementRow` interface, ~line 472)
- Modify: `packages/database/src/queries/statements.ts` (the `getTenantStatement` mapper, lines 32-41)

- [ ] **Step 1: Read both files** to confirm exact current shape (`TenantStatementRow` and the `.map()` in `getTenantStatement`).

- [ ] **Step 2: Extend `TenantStatementRow`**

Replace the `txn_type` union and add three fields:
```ts
export interface TenantStatementRow {
  txn_date: string;
  sort_key: number;
  txn_type:
    | 'charge' | 'late_fee' | 'payment' | 'credit' | 'credit_applied'
    | 'deposit_charge' | 'deposit_payment' | 'deposit_refund' | 'deposit_settlement';
  description: string;
  reference: string;
  charge_amount: number;
  payment_amount: number;
  running_balance: number;
  deposit_in: number;
  deposit_out: number;
  deposit_running: number;
}
```

- [ ] **Step 3: Map the new columns** in `getTenantStatement`'s return `.map((row: any) => ({ ... }))`, add after `running_balance`:
```ts
    running_balance: Number(row.running_balance) || 0,
    deposit_in: Number(row.deposit_in) || 0,
    deposit_out: Number(row.deposit_out) || 0,
    deposit_running: Number(row.deposit_running) || 0,
```

- [ ] **Step 4: Type-check**

```
cd packages/types && npx tsc --noEmit
cd ../database && npx tsc --noEmit
```
Expected: clean. (If `packages/*` have no standalone tsconfig, defer to the repo-wide `pnpm type-check` in Chunk 4 and note it.)

- [ ] **Step 5: Commit**

```
git add packages/types/src/models.ts packages/database/src/queries/statements.ts
git commit -m "feat(deposits): tenant statement type + query mapping for deposit sub-ledger"
```

---

### Task 2.2: Exclude deposit invoices from the settle picker

**Files:**
- Modify: `modules/billing/src/hooks/use-deposit-refunds.ts` (the `useEligibleInvoiceSettlements` invoices query)

- [ ] **Step 1: Read** `modules/billing/src/hooks/use-deposit-refunds.ts`; find the `useEligibleInvoiceSettlements` query: `db.from('invoices').select(...).eq('org_id', orgId).eq('direction','receivable').eq('lease_id', leaseId).in('status', ['open','partially_paid'])`.

- [ ] **Step 2: Add the filter** — chain `.eq('is_deposit', false)` onto that query (anywhere in the chain before the `await`/execution). This mirrors the SQL guard added to `create_deposit_refund` (migration step 4); the SQL is authoritative, this keeps the picker UI from offering the deposit invoice.

- [ ] **Step 3: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add modules/billing/src/hooks/use-deposit-refunds.ts
git commit -m "feat(deposits): exclude is_deposit invoices from settle picker"
```

---

### Task 2.3: Wire deposit-invoice creation into lease create/activate

**Files:**
- Modify: `modules/contacts/src/actions/create-lease.ts`
- Modify: `modules/contacts/src/actions/update-lease.ts`

- [ ] **Step 1: Read both action files** to confirm structure (create-lease inserts lease then `lease_tenants`; update-lease has the `currentLease.status`/`oldStatus` transition logic and resyncs `lease_tenants`).

- [ ] **Step 2: `create-lease.ts`** — after the `lease_tenants` insert succeeds and the unit-occupancy block, before `return { success: true, ... }`, add a best-effort call (a failure must NOT fail lease creation):
```ts
    if (parsed.data.status === 'active' && Number(parsed.data.deposit_amount) > 0) {
      try {
        await db.rpc('create_lease_deposit_invoice', {
          p_org_id: orgId,
          p_lease_id: data.id,
          p_mark_paid: false,
        });
      } catch {
        // non-fatal: deposit invoice can be (re)generated later; lease creation must still succeed
      }
    }
```
(`db.rpc` returns `{ data, error }` and does not throw; the `try/catch` is defensive. Also accept a returned `error` silently — do not surface it as a lease-creation failure.)

- [ ] **Step 3: `update-lease.ts`.** `updateLease`'s signature is `(id, values)` — there is **no `orgId` param**. First, widen the existing `currentLease` fetch to also select `org_id`: change `.select('status')` to `.select('status, org_id')` (it's the `const { data: currentLease } = await db.from('leases').select('status').eq('id', id).single();` block near the top). Then, after the `lease_tenants` resync + unit-occupancy block and before `return { success: true, ... }`, add (bind `p_org_id` directly from `currentLease.org_id` — do NOT reference a non-existent `orgId`):
```ts
    if (
      parsed.data.status === 'active' &&
      currentLease?.status !== 'active' &&
      currentLease?.org_id &&
      Number(parsed.data.deposit_amount) > 0
    ) {
      try {
        await db.rpc('create_lease_deposit_invoice', {
          p_org_id: currentLease.org_id,
          p_lease_id: id,
          p_mark_paid: false,
        });
      } catch {
        // non-fatal; RPC is idempotent so a later activation is safe
      }
    }
```
The existing transition guard already restricts `active` to come only from `draft`/`active`, so `currentLease?.status !== 'active'` correctly fires only on the draft→active activation.

- [ ] **Step 4: Type-check**

```
cd modules/contacts && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add modules/contacts/src/actions/create-lease.ts modules/contacts/src/actions/update-lease.ts
git commit -m "feat(deposits): create deposit invoice on lease create/activate"
```

---

## Chunk 3: UI

### Task 3.1: Tenant statement — deposit sub-section

**Files:**
- Modify: `apps/web/components/reports/tenant-statement-table.tsx`
- Modify: `apps/web/app/(dashboard)/reports/statements/page.tsx` (CSV export)

- [ ] **Step 1: Read** `tenant-statement-table.tsx` in full (it renders one `<Table>` of all rows + a Totals row).

- [ ] **Step 2: Split rows + render a deposit sub-section.** Replace the component body so it partitions `data` into rent rows (`txn_type` NOT starting with `deposit_`) and deposit rows (the four `deposit_*` types). Render the existing rent table unchanged from the rent rows (its Totals/`running_balance` now naturally exclude deposits because the RPC zeroes them). Below it, if any deposit rows exist, render a second titled block "Security Deposit":

```tsx
const isDeposit = (t: string) => t.startsWith('deposit_');
const rentRows = data.filter((r) => !isDeposit(r.txn_type));
const depositRows = data.filter((r) => isDeposit(r.txn_type));
```
- Rent table: same markup as today but iterate `rentRows`; Totals computed from `rentRows`; ending balance = last `rentRows` row's `running_balance` (guard empty).
- Deposit block (only if `depositRows.length`): a heading `Security Deposit` then a `<Table>` with columns Date / Type / Description / In / Out / Held, iterating `depositRows`, showing `deposit_in>0 ? formatCurrency : '—'`, `deposit_out>0 ? ... : '—'`, and `deposit_running` as Held. Add badges:
```ts
deposit_charge:     { label: 'Deposit Charge',  className: 'bg-slate-100 text-slate-800' },
deposit_payment:    { label: 'Deposit In',      className: 'bg-green-100 text-green-800' },
deposit_refund:     { label: 'Deposit Refund',  className: 'bg-orange-100 text-orange-800' },
deposit_settlement: { label: 'Withheld',        className: 'bg-amber-100 text-amber-800' },
```
Keep both empty-states sane (if `rentRows` empty but `depositRows` present, still show the deposit block; if all empty, the existing "No transactions" message).

- [ ] **Step 3: CSV export** in `statements/page.tsx` `exportTenantStatement` — append the three columns so the export is lossless:
```ts
const headers = ['Date','Type','Description','Reference','Charges','Payments/Credits','Balance','Deposit In','Deposit Out','Deposit Held'];
const rows = tenantStatementData.map((r) => [
  r.txn_date, r.txn_type, r.description, r.reference,
  r.charge_amount.toFixed(2), r.payment_amount.toFixed(2), r.running_balance.toFixed(2),
  r.deposit_in.toFixed(2), r.deposit_out.toFixed(2), r.deposit_running.toFixed(2),
]);
```

- [ ] **Step 4: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add apps/web/components/reports/tenant-statement-table.tsx "apps/web/app/(dashboard)/reports/statements/page.tsx"
git commit -m "feat(deposits): deposit sub-ledger section in tenant statement"
```

---

### Task 3.2: Accounting → Expenses page + nav

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/expenses/page.tsx`
- Modify: the sidebar nav config (locate via grep — Step 1)

- [ ] **Step 1: Locate the nav.** Run `grep -rn "Outgoing" apps/web --include=*.tsx -l` and `grep -rn "accounting/outgoing" apps/web -l`. Identify the file defining the Accounting nav items (likely a sidebar/nav config or layout). Note its exact item shape.

- [ ] **Step 2: Create the Expenses page.** Mirror the structure of `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` (date-range buttons via `resolveDateRange`, property filter, search) but drive it with `useExpenses` from `@onereal/accounting` instead of `useInvoices`. Render an inline table (Date / Type / Property·Unit / Description / Vendor / Amount). Use the existing `ExpenseFilters` shape (`{ orgId, propertyId?, expenseType?, search?, from?, to? }`). Include an `expense_type` filter `<Select>` whose options include `deposit_refund`. **`deposit_refund` rows are read-only** — render no edit/delete affordance for them (there is no expense edit/delete UI on this page anyway; this page is list-only, so "read-only" is satisfied by not adding mutation controls). Page skeleton:

```tsx
'use client';
import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { resolveDateRange } from '@/lib/date-range';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn,
} from '@onereal/ui';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];
const EXPENSE_TYPES = ['mortgage','maintenance','repairs','utilities','insurance','taxes','management','advertising','legal','hoa','home_warranty','deposit_refund','other'];

export default function ExpensesPage() {
  const { activeOrg } = useUser();
  const [dateRange, setDateRange] = useState('current_year');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const resolved = useMemo(() => resolveDateRange(dateRange), [dateRange]);
  const { data: propsData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propsData?.data ?? []) as any[];
  const { data: expenses = [], isLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    expenseType: typeFilter || undefined,
    search: search || undefined,
    from: resolved?.from,
    to: resolved?.to,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <div className="flex gap-1.5">
          {DATE_RANGES.map((r) => (
            <Button key={r.value} variant={dateRange===r.value?'default':'secondary'} size="sm"
              onClick={() => setDateRange(r.value)}
              className={cn('text-xs', dateRange!==r.value && 'text-muted-foreground')}>{r.label}</Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search expenses..." value={search} onChange={(e)=>setSearch(e.target.value)} className="max-w-xs" />
        <Select value={propertyFilter || 'all'} onValueChange={(v)=>setPropertyFilter(v==='all'?'':v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p)=>(<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={typeFilter || 'all'} onValueChange={(v)=>setTypeFilter(v==='all'?'':v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EXPENSE_TYPES.map((t)=>(<SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (expenses as any[]).length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">No expenses for this period.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead>
              <TableHead>Property</TableHead><TableHead>Description</TableHead>
              <TableHead>Vendor</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(expenses as any[]).map((e:any)=>(
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{e.transaction_date}</TableCell>
                <TableCell className="capitalize">{String(e.expense_type).replace(/_/g,' ')}</TableCell>
                <TableCell>{e.properties?.name ?? '—'}{e.units?.unit_number ? ` · ${e.units.unit_number}` : ''}</TableCell>
                <TableCell className="max-w-[260px] truncate">{e.description}</TableCell>
                <TableCell>{e.service_providers?.name ?? (e.expense_type==='deposit_refund' ? 'Tenant refund' : '—')}</TableCell>
                <TableCell className="text-right">${Number(e.amount).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the nav entry** next to "Outgoing"/"Incoming", route `/accounting/expenses`, label `Expenses`. The nav file is `apps/web/components/dashboard/sidebar.tsx`; the Accounting **child** sub-items use the shape `{ label, href }` only (no `icon` — only top-level nav items take an icon). Add `{ label: 'Expenses', href: '/accounting/expenses' }` to the Accounting children array, matching the file's exact existing formatting. Do not add an icon or a new dependency.

- [ ] **Step 4: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean. Fix only errors introduced by these changes.

- [ ] **Step 5: Commit**

```
git add "apps/web/app/(dashboard)/accounting/expenses/page.tsx" <nav file from Step 1>
git commit -m "feat(deposits): Accounting Expenses page + nav entry"
```

---

## Chunk 4: Smoke Tests & Push

### Task 4.1: SQL functional smoke (Supabase SQL editor — migration already applied)

**Files:** none — verification.

- [ ] **Step 1: 33-DowSt collection visible.** Get the 33-DowSt active lease's tenant_id + property_id, then:
```sql
SELECT txn_type, description, deposit_in, deposit_out, deposit_running, running_balance
FROM get_tenant_statement(:org, :tenant_33dow, :prop_33dow, NULL, NULL)
WHERE txn_type LIKE 'deposit_%';
-- Expect a deposit_charge (0/0) and a deposit_payment (deposit_in=3600), deposit_running=3600.
-- running_balance for those rows is unchanged by them (deposit excluded from rent ledger).
```

- [ ] **Step 2: Destiny refund + settlement visible, rent unaffected.** Using Destiny's tenant/property (expired lease — not backfilled, intentional):
```sql
SELECT txn_type, description, deposit_in, deposit_out, deposit_running
FROM get_tenant_statement(:org, :tenant_destiny, :prop_destiny, NULL, NULL)
WHERE txn_type LIKE 'deposit_%';
-- Expect deposit_refund (deposit_out=1600) and deposit_settlement (deposit_out=250).
-- No deposit_charge/deposit_payment (expired lease not backfilled) — correct.
```
Then confirm her rent ledger is unchanged: compare `running_balance` of the last non-deposit row to its value before this migration (should be identical — deposits never contributed).

- [ ] **Step 3: Rent isolation.** Pick any active lease with both rent invoices and a backfilled deposit:
```sql
SELECT txn_type, charge_amount, payment_amount, running_balance, deposit_in, deposit_out, deposit_running
FROM get_tenant_statement(:org, :tenant, :prop, NULL, NULL)
ORDER BY txn_date, sort_key;
-- running_balance must move ONLY on charge/late_fee/payment/credit_applied rows;
-- deposit_running must move ONLY on deposit_* rows. The two never cross.
```

- [ ] **Step 4: Backfill idempotency.** Re-run the migration's RPC for an already-backfilled lease:
```sql
SELECT public.create_lease_deposit_invoice(:org, :lease_already_done, true);
-- { "skipped": true }; no new invoice/payment/income rows.
```

- [ ] **Step 5: Settle-picker exclusion.** For an active lease with an `open` deposit invoice, attempt to settle it directly:
```sql
SELECT create_deposit_refund(:org, :lease, 1, CURRENT_DATE, 'check', NULL, 'x',
  ARRAY[]::uuid[], ARRAY[:deposit_invoice_id]::uuid[]);
-- ERROR: 'One or more invoices are not eligible to settle ... non-deposit ...'
```

- [ ] **Step 6: Regression — deposit-refund feature unchanged.** Pick a safe active lease with deposit headroom; run a full create→void deposit refund (no settlements) and confirm `get_lease_deposit_summary` Held/Refunded/Withheld/Balance behave exactly as before this migration (Held still = `lease.deposit_amount`; the new deposit invoice does not appear in the summary).

- [ ] **Step 7: Financial aggregates shift (expected, document).** `SELECT * FROM get_financial_totals(...)` for a period covering a backfilled lease's `start_date` increased by exactly that deposit (a `deposit` income slice). Confirm the **property statement** for that property shows the deposit collection as a `rent_payment`/income-side line but NOT also a duplicate manual-`income` line (proves the payment carries `income_id`).

### Task 4.2: UI smoke (`pnpm dev`, browser)

- [ ] **Step 1:** `pnpm dev`; Reports → Statements → Tenant Statement → pick the 33-DowSt tenant + property. A "Security Deposit" section shows the $3,600 collection (Held = 3,600); the rent table/Totals are unaffected.
- [ ] **Step 2:** Same screen for Destiny: the deposit section shows the $1,600 refund and $250 withheld (Held nets down); her rent balance unchanged.
- [ ] **Step 3:** Accounting → Expenses: the page lists expenses incl. the `deposit_refund` rows; type filter `deposit_refund` works; no edit/delete controls.
- [ ] **Step 4:** Open a deposit refund dialog on an active lease that has an `open` deposit invoice — the deposit invoice does NOT appear in the invoice-settlement picker.
- [ ] **Step 5:** Stop dev server.

### Task 4.3: Push

- [ ] **Step 1:** `git status` clean (all chunk commits present).
- [ ] **Step 2:** `git push origin <feature-branch>` is NOT done here — the controller finishes the branch via superpowers:finishing-a-development-branch (merge/PR decision + push) after final review.

---

## Done Criteria

- Migration applied; Task 1.1 Step 5 + Task 4.1 SQL smokes pass (backfill correct incl. 33-DowSt; settle-picker exclusion; rent/deposit isolation; deposit-refund regression clean).
- `pnpm type-check` 14/14 green.
- UI smokes pass: deposit sub-section renders for 33-DowSt and Destiny; Expenses page lists deposit refunds; settle picker excludes deposit invoices.
- Independent final review: zero blocking.

# Invoice-Based Deposit Deductions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a receivable invoice be settled directly from a held security deposit during a deposit refund — mark the invoice paid, create deposit-sourced `payments` + `income` rows, fold the settled amount into the deposit math, and make it fully reversible on void.

**Architecture:** One migration extends `payments.payment_method` (`+'deposit'`), adds a `deposit_refund_invoice_settlements` junction (with explicit `amount` + `payment_id`/`income_id` pointers), and `CREATE OR REPLACE`s four `SECURITY DEFINER` RPCs: `create_deposit_refund` (new `p_settle_invoice_ids` arg + over-refund guard corrected to span all active refunds on the lease), `get_lease_deposit_summary` (settlements folded into `withheld`/`balance`), `void_deposit_refund` (symmetric settlement reversal), and `void_payment` (rejects voiding deposit-sourced payments). Server action + schema + hooks expose it; the refund dialog gets an invoice-settlement picker; the deposit card renders settlement history; the payment dialog hides void for deposit-sourced payments.

**Tech Stack:** PostgreSQL (Supabase), Next.js 15, TypeScript, React Query (TanStack), react-hook-form + zod, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-14-invoice-deposit-deductions-design.md](../specs/2026-05-14-invoice-deposit-deductions-design.md)

**Note on testing:** This codebase has no automated test suite for accounting flows (consistent with the prior deposit-refunds plan). Each chunk ends with **Manual Smoke Test** steps run via the dev server / Supabase SQL editor. Verification is by SQL assertions and UI exercise.

**Behavior change to flag during review:** the corrected over-refund guard now also counts prior active *expense* deductions from *other* refunds on the lease (Spec Requirement 6) — stricter than the original expense-only path. Intentional; Smoke Test 6 regresses it.

**v1 scope rule (decided):** every deposit refund cuts a **non-zero** cash `p_refund_amount`. Settling an invoice from the deposit is *in addition to* a cash refund, never instead of it. This is already enforced by pre-existing constraints (`deposit_refunds.refund_amount > 0`, paired `expenses.amount > 0`, the zod `.positive()` validator, and the dialog submit guards) — **this feature adds no code for it and changes none of it**. "Keep the entire deposit / return $0" is out of scope for v1. All smoke tests below use a non-zero cash refund accordingly.

---

## Chunk 1: Database Migration

### Task 1.1: Write the migration file

**Files:**
- Create: `supabase/migrations/20260514000001_invoice_deposit_deductions.sql`

- [ ] **Step 1: Create the migration file with full SQL**

Write this exact content:

```sql
-- ============================================================
-- Migration: Invoice-Based Deposit Deductions
--   - Extends payments.payment_method to include 'deposit'
--   - Creates deposit_refund_invoice_settlements junction
--   - Replaces create_deposit_refund (new p_settle_invoice_ids
--     arg + over-refund guard spanning ALL active refunds)
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
-- 5. RPC: create_deposit_refund (replace — add p_settle_invoice_ids)
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
    -- Lock the invoice (serializes vs. apply_credits / record_payment /
    -- reverse_invoice_credit_applications — each holds an exclusive row
    -- lock before mutating amount_paid/status).
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
```

- [ ] **Step 2: Confirm the file exists**

Run: `ls -la supabase/migrations/20260514000001_invoice_deposit_deductions.sql`
Expected: file listed with non-zero size.

- [ ] **Step 3: Push migration with dry-run first**

Run from project root:
```
npx supabase db push --dry-run
```
Expected output includes: `20260514000001_invoice_deposit_deductions.sql`

- [ ] **Step 4: Apply the migration**

```
echo "y" | npx supabase db push
```
Expected: `Applying migration 20260514000001_invoice_deposit_deductions.sql...` then `Finished supabase db push.`

- [ ] **Step 5: Manual smoke test — verify schema**

In the Supabase SQL editor, run:
```sql
-- payment_method now includes 'deposit'
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'payments_payment_method_check';
-- Output must include 'deposit'

-- junction table exists
SELECT table_name FROM information_schema.tables
WHERE table_name = 'deposit_refund_invoice_settlements';
-- 1 row

-- RPCs replaced (check arg count of create_deposit_refund = 9)
SELECT proname, pronargs FROM pg_proc
WHERE proname IN ('create_deposit_refund','get_lease_deposit_summary',
                  'void_deposit_refund','void_payment');
-- create_deposit_refund pronargs = 9

-- RLS enabled
SELECT relrowsecurity FROM pg_class
WHERE relname = 'deposit_refund_invoice_settlements';
-- t
```

- [ ] **Step 6: Commit**

```
git add supabase/migrations/20260514000001_invoice_deposit_deductions.sql
git commit -m "feat(deposits): migration for invoice-based deposit deductions"
```

---

### Task 1.2: SQL-level RPC behavior smoke test

**Files:** none — Supabase SQL editor verification. Use a real lease with a deposit and a known org you manage.

- [ ] **Step 1: Capture baseline**

```sql
-- Replace :org and :lease with real UUIDs you manage.
SELECT * FROM get_lease_deposit_summary(:org, :lease);
-- Note held / refunded / withheld / balance.
```

- [ ] **Step 2: Create a receivable invoice to settle**

Create (via the app UI: Accounting → Incoming → New Invoice) a `receivable` invoice on that lease for a small amount (e.g. $50), status `open`. Note its `id` and `invoice_number`:
```sql
SELECT id, invoice_number, amount, amount_paid, status
FROM invoices WHERE lease_id = :lease AND direction='receivable'
ORDER BY created_at DESC LIMIT 3;
```

- [ ] **Step 2b: Verify the invoice will not appear under the wrong lease**

```sql
-- Sanity: the invoice's lease_id must equal :lease
SELECT lease_id = :lease AS correctly_scoped
FROM invoices WHERE id = :invoice;
-- correctly_scoped = t
```

- [ ] **Step 3: Settle it from the deposit**

Precondition: pick a test lease whose `get_lease_deposit_summary.balance` is **≥ 60** (so the cash refund below is strictly > 0 — v1 requires a non-zero cash refund). The cash refund is `balance − 50`, which is ≥ 10 > 0 and leaves `balance_remaining = 0`.

```sql
SELECT create_deposit_refund(
  :org, :lease,
  (SELECT balance - 50 FROM get_lease_deposit_summary(:org,:lease)), -- cash refund = remaining after the $50 settle; > 0 by the precondition above
  CURRENT_DATE, 'check', NULL, 'sql smoke',
  ARRAY[]::uuid[],
  ARRAY[:invoice]::uuid[]
);
```
Expected: JSON with `invoice_settlements_total: 50`, `balance_remaining: 0`. (If the lease's `balance` was exactly 50, the cash refund would be 0 and the call would correctly raise on the `refund_amount > 0` constraint — that is the v1 rule, not a bug; choose a lease with balance ≥ 60.)

- [ ] **Step 4: Verify side-effects**

```sql
-- invoice now paid
SELECT status, amount_paid, amount FROM invoices WHERE id = :invoice;
-- status='paid', amount_paid = amount

-- one deposit-sourced payment
SELECT amount, payment_method, status FROM payments
WHERE invoice_id = :invoice AND payment_method='deposit';
-- 1 row, status='active'

-- one income row
SELECT amount, income_type, description FROM income
WHERE description LIKE 'Deposit applied to %';
-- 1 row, income_type='other'

-- one settlement junction row with pointers
SELECT amount, payment_id IS NOT NULL AS has_pay, income_id IS NOT NULL AS has_inc
FROM deposit_refund_invoice_settlements
ORDER BY created_at DESC LIMIT 1;
-- amount=50, has_pay=t, has_inc=t

-- summary ties out
SELECT * FROM get_lease_deposit_summary(:org,:lease);
-- withheld includes the 50, balance = 0
```

- [ ] **Step 5: Verify void_payment is blocked**

```sql
SELECT void_payment(:org,
  (SELECT id FROM payments WHERE invoice_id=:invoice AND payment_method='deposit'));
-- Expected: ERROR 'This payment was created by deposit refund DR-...; void that refund to reverse it.'
```

- [ ] **Step 6: Void the refund and verify full reversal**

```sql
-- Find the refund id
SELECT id, refund_number FROM deposit_refunds
WHERE lease_id=:lease ORDER BY created_at DESC LIMIT 1;

SELECT void_deposit_refund(:org, :refund_id);

-- invoice back to open
SELECT status, amount_paid FROM invoices WHERE id=:invoice;
-- status='open', amount_paid=0

-- payment + income gone
SELECT count(*) FROM payments WHERE invoice_id=:invoice AND payment_method='deposit';
-- 0
SELECT count(*) FROM income WHERE description LIKE 'Deposit applied to %';
-- 0 (for this invoice_number)

-- settlement junction gone, summary restored
SELECT * FROM get_lease_deposit_summary(:org,:lease);
-- matches Step 1 baseline
```

- [ ] **Step 7: Over-refund guard test**

```sql
-- Attempt a refund that exceeds the deposit
SELECT create_deposit_refund(
  :org, :lease,
  (SELECT held + 1 FROM get_lease_deposit_summary(:org,:lease)),
  CURRENT_DATE, 'check', NULL, 'over', ARRAY[]::uuid[], ARRAY[]::uuid[]
);
-- Expected: ERROR mentioning 'exceeds remaining deposit balance'
```

- [ ] **Step 8: No commit** (verification only — no file changes in this task).

---

## Chunk 2: Backend (schema, action, hooks)

### Task 2.1: Extend the deposit-refund zod schema

**Files:**
- Modify: `modules/billing/src/schemas/deposit-refund-schema.ts`

- [ ] **Step 1: Read the current schema**

Use the Read tool on `modules/billing/src/schemas/deposit-refund-schema.ts` to confirm the exact `depositRefundSchema` shape.

- [ ] **Step 2: Add `settle_invoice_ids`**

Add this field to the `depositRefundSchema` object, immediately after `deduction_expense_ids`:
```ts
  settle_invoice_ids: z.array(z.string().uuid()).default([]),
```

- [ ] **Step 3: Type-check**

Run:
```
cd modules/billing && npx tsc --noEmit
```
Expected: clean (no output).

- [ ] **Step 4: Commit**

```
git add modules/billing/src/schemas/deposit-refund-schema.ts
git commit -m "feat(deposits): add settle_invoice_ids to refund schema"
```

---

### Task 2.2: Pass `p_settle_invoice_ids` from the server action

**Files:**
- Modify: `modules/billing/src/actions/create-deposit-refund.ts`

- [ ] **Step 1: Read the current action**

Use the Read tool on `modules/billing/src/actions/create-deposit-refund.ts`.

- [ ] **Step 2: Add the RPC param**

In the `db.rpc('create_deposit_refund', { ... })` params object, add immediately after `p_deduction_expense_ids`:
```ts
      p_settle_invoice_ids: parsed.data.settle_invoice_ids,
```

- [ ] **Step 3: Widen the return type**

In the `Promise<ActionResult<{ ... }>>` generic, add the new field:
```ts
  refund_number: string;
  invoice_settlements_total: number;
  balance_remaining: number;
```
(keep `refund_id`, `expense_id`).

- [ ] **Step 4: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add modules/billing/src/actions/create-deposit-refund.ts
git commit -m "feat(deposits): action passes settle_invoice_ids to RPC"
```

---

### Task 2.3: `useEligibleInvoiceSettlements` hook + `settlements` join

**Files:**
- Modify: `modules/billing/src/hooks/use-deposit-refunds.ts`
- Modify: `modules/billing/src/index.ts`

- [ ] **Step 1: Read both files**

Read `modules/billing/src/hooks/use-deposit-refunds.ts` (note the exact `useDepositRefunds` select string) and `modules/billing/src/index.ts` (note the existing `use-deposit-refunds` export block).

- [ ] **Step 2: Add the `settlements` join to `useDepositRefunds`**

In `useDepositRefunds`, append to the `.select(...)` template string, right after the `deductions:deposit_refund_deductions(...)` block (keep the trailing structure valid — add a comma after the `deductions(...)` block then this):
```
          settlements:deposit_refund_invoice_settlements(
            amount,
            invoice:invoices(invoice_number, description)
          )
```

- [ ] **Step 3: Add the `useEligibleInvoiceSettlements` hook**

Append this hook to the end of `use-deposit-refunds.ts`:
```ts
export interface EligibleInvoiceSettlement {
  id: string;
  invoice_number: string;
  description: string;
  amount: number;
  amount_paid: number;
  outstanding: number;
  due_date: string;
}

/**
 * Lists receivable invoices eligible to be settled from the deposit:
 * - direction='receivable', status in ('open','partially_paid')
 * - lease_id = leaseId
 * - excludes invoices already settled by an active refund
 * The RPC re-validates under lock; this picker is best-effort.
 */
export function useEligibleInvoiceSettlements(
  orgId: string | null,
  leaseId: string | null,
) {
  return useQuery({
    queryKey: ['deposit-eligible-invoices', orgId, leaseId],
    queryFn: async () => {
      if (!orgId || !leaseId) return [] as EligibleInvoiceSettlement[];
      const supabase = createClient();
      const db = supabase as any;

      const { data: linkedRows } = await db
        .from('deposit_refund_invoice_settlements')
        .select('invoice_id, deposit_refunds!inner(status, org_id)')
        .eq('deposit_refunds.status', 'active')
        .eq('deposit_refunds.org_id', orgId);
      const linkedIds = new Set((linkedRows ?? []).map((r: any) => r.invoice_id));

      const { data, error } = await db
        .from('invoices')
        .select('id, invoice_number, description, amount, amount_paid, due_date, status, direction, lease_id')
        .eq('org_id', orgId)
        .eq('direction', 'receivable')
        .eq('lease_id', leaseId)
        .in('status', ['open', 'partially_paid'])
        .order('due_date', { ascending: true });

      if (error) throw error;
      return (data ?? [])
        .filter((i: any) => !linkedIds.has(i.id))
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          description: i.description,
          amount: Number(i.amount),
          amount_paid: Number(i.amount_paid),
          outstanding: Number(i.amount) - Number(i.amount_paid),
          due_date: i.due_date,
        }))
        .filter((i: EligibleInvoiceSettlement) => i.outstanding > 0) as EligibleInvoiceSettlement[];
    },
    enabled: !!orgId && !!leaseId,
  });
}
```

- [ ] **Step 4: Re-export from index**

In `modules/billing/src/index.ts`, add to the existing `use-deposit-refunds` export block:
```ts
  useEligibleInvoiceSettlements,
  type EligibleInvoiceSettlement,
```

- [ ] **Step 5: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```
git add modules/billing/src/hooks/use-deposit-refunds.ts modules/billing/src/index.ts
git commit -m "feat(deposits): eligible-invoice hook + settlements join"
```

---

## Chunk 3: UI

### Task 3.1: Invoice-settlement picker in the refund dialog

**Files:**
- Modify: `apps/web/components/billing/deposit-refund-dialog.tsx`

- [ ] **Step 1: Read the dialog**

Read `apps/web/components/billing/deposit-refund-dialog.tsx` in full. Note: `useEligibleDeductions` import/usage, `selectedIds`/`withheld` memo, `available`/`maxRefundable` math, the `deduction_expense_ids` form field, the existing deductions list block, and the submit button disabled condition.

- [ ] **Step 2: Import the new hook**

Add `useEligibleInvoiceSettlements` to the existing `@onereal/billing` import.

- [ ] **Step 3: Add form default + query**

After the `useEligibleDeductions` call, add:
```ts
const { data: eligibleInvoices = [] } = useEligibleInvoiceSettlements(
  activeOrg?.id ?? null,
  leaseId,
);
```
In BOTH the `useForm({ defaultValues })` object and the `form.reset({...})` call inside the `useEffect`, add:
```ts
      settle_invoice_ids: [],
```

- [ ] **Step 4: Track selection + fold into withheld math**

Add below `const refundAmount = form.watch('refund_amount');`:
```ts
const selectedInvoiceIds = form.watch('settle_invoice_ids');

const invoiceWithheld = useMemo(
  () =>
    (eligibleInvoices as any[])
      .filter((i: any) => selectedInvoiceIds.includes(i.id))
      .reduce((sum: number, i: any) => sum + Number(i.outstanding), 0),
  [eligibleInvoices, selectedInvoiceIds],
);

function toggleInvoice(invoiceId: string) {
  const cur = form.getValues('settle_invoice_ids');
  const next = cur.includes(invoiceId)
    ? cur.filter((id) => id !== invoiceId)
    : [...cur, invoiceId];
  form.setValue('settle_invoice_ids', next);
}
```
Change the `available` and `maxRefundable` computations to subtract `invoiceWithheld` as well:
```ts
const available = Math.max(0, held - refunded - previouslyWithheld - withheld - invoiceWithheld);
const maxRefundable = held - refunded - previouslyWithheld - withheld - invoiceWithheld;
```
Update the "Withheld (selected)" summary tile value to `(withheld + invoiceWithheld).toFixed(2)`.

- [ ] **Step 5: Render the invoice-settlement list section**

Directly below the closing `</div>` of the existing "Deductions (link existing expenses)" bordered block, add:
```tsx
<div className="rounded-md border p-3">
  <div className="mb-2">
    <span className="text-sm font-medium">
      Invoice settlements (apply deposit to unpaid tenant charges)
    </span>
  </div>
  {(eligibleInvoices as any[]).length === 0 ? (
    <p className="text-xs text-muted-foreground py-2">
      No unpaid receivable invoices for this lease.
    </p>
  ) : (
    <div className="max-h-40 overflow-y-auto space-y-1">
      {(eligibleInvoices as any[]).map((i: any) => {
        const checked = selectedInvoiceIds.includes(i.id);
        return (
          <label
            key={i.id}
            className="flex items-center gap-3 px-2 py-1 rounded hover:bg-muted/40 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleInvoice(i.id)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-28">{i.invoice_number}</span>
            <span className="text-sm flex-1 truncate">{i.description}</span>
            <span className="text-sm font-medium">${Number(i.outstanding).toFixed(2)}</span>
          </label>
        );
      })}
      <div className="text-xs text-muted-foreground pt-1">
        Settling: ${invoiceWithheld.toFixed(2)}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 6: Invalidate invoice/payment queries on success**

In `onSubmit`, after the existing `queryClient.invalidateQueries` calls, add:
```ts
queryClient.invalidateQueries({ queryKey: ['invoices'] });
queryClient.invalidateQueries({ queryKey: ['payments'] });
queryClient.invalidateQueries({ queryKey: ['deposit-eligible-invoices'] });
```

- [ ] **Step 7: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 8: Commit**

```
git add apps/web/components/billing/deposit-refund-dialog.tsx
git commit -m "feat(deposits): invoice-settlement picker in refund dialog"
```

---

### Task 3.2: Render settlement history on the deposit card

**Files:**
- Modify: `apps/web/components/billing/deposit-card.tsx`

- [ ] **Step 1: Read the card**

Read `apps/web/components/billing/deposit-card.tsx`. Locate the `{r.deductions?.length > 0 && (...)}` block (around lines 148-160).

- [ ] **Step 2: Add a settlements block**

Immediately after the closing `)}` of the `r.deductions` block, add:
```tsx
{r.settlements?.length > 0 && (
  <div className="text-xs text-muted-foreground mt-1">
    Settled invoices:{' '}
    {r.settlements
      .map(
        (s: any) =>
          `${s.invoice?.invoice_number ?? ''} ${s.invoice?.description ?? ''} $${Number(
            s.amount || 0,
          ).toFixed(2)}`,
      )
      .join(', ')}
  </div>
)}
```

- [ ] **Step 3: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add apps/web/components/billing/deposit-card.tsx
git commit -m "feat(deposits): show settled invoices in refund history"
```

---

### Task 3.3: Hide void for deposit-sourced payments in the payment dialog

**Files:**
- Modify: `apps/web/components/billing/payment-dialog.tsx`

- [ ] **Step 1: Read the dialog**

Read `apps/web/components/billing/payment-dialog.tsx` in full. Find where the payment history list renders each payment row and the Void button / `voidPayment` call. Note the field name the row uses for the payment object (e.g. `p` / `payment`) and confirm `payment_method` is selected by `usePayments` (it selects `*`, so it is available).

- [ ] **Step 2: Gate the void control**

For each rendered payment row, wrap the existing Void button so it does not render when the payment is deposit-sourced, and show a note instead. Using the row variable name observed in Step 1 (shown here as `p`):
```tsx
{p.payment_method === 'deposit' ? (
  <span className="text-xs text-muted-foreground">
    Settled from deposit refund — void the refund to reverse
  </span>
) : (
  /* existing Void button JSX, unchanged */
)}
```
Do not change any other logic. The RPC guard (Task 1.1) is the authority; this is convenience only.

- [ ] **Step 3: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add apps/web/components/billing/payment-dialog.tsx
git commit -m "feat(payments): hide void for deposit-sourced settlement payments"
```

---

## Chunk 4: End-to-End Smoke Tests & Push

### Task 4.1: UI smoke tests

**Files:** none — manual verification.

- [ ] **Step 1: Start dev server**

```
pnpm dev
```
Wait for `Ready in <Xs>`.

- [ ] **Step 2: Smoke 1 — the Destiny scenario (primary)**

1. Ensure a tenant (e.g. Destiny) has an expired lease with a deposit (e.g. $1,850) and a `receivable` invoice for move-out repairs (e.g. $250, status `open`). Create them via the UI if needed.
2. Open the lease's Deposit card → "Refund Deposit".
3. The new "Invoice settlements" section lists the $250 invoice. Check it. The "Withheld (selected)" tile shows $250.
4. Enter refund amount `1600`. Submit.
5. Expect success toast with the `DR-…` number.
6. Deposit card: Held 1850 / Refunded 1600 / Withheld 250 / Balance 0. Refund row shows `Settled invoices: <INV#> Move-out repairs $250.00`.
7. Accounting → Incoming → the $250 invoice is now `paid`.

- [ ] **Step 3: Smoke 2 — payment dialog void is hidden**

1. Open the now-paid $250 invoice's payment dialog (the Pay/▼ action / payment history).
2. The deposit-sourced payment row shows "Settled from deposit refund — void the refund to reverse" instead of a Void button.

- [ ] **Step 4: Smoke 3 — empty state**

1. Open Refund Deposit on a lease that has **no** open receivable invoices.
2. The Invoice settlements section shows "No unpaid receivable invoices for this lease."

- [ ] **Step 5: Smoke 4 — void reverses the settlement**

1. On the Destiny lease, Void the refund from Smoke 1.
2. Deposit card balance returns to 1850 (Refunded 0 / Withheld 0).
3. Incoming → the $250 invoice is back to `open`, amount_paid 0.
4. The deposit-sourced payment and the "Deposit applied to …" income row are gone (verify in SQL editor if no income UI).

- [ ] **Step 6: Smoke 5 — stale picker rejection**

1. Open Refund Deposit, do not submit.
2. In another tab, fully pay that same invoice via the normal Pay flow.
3. Return to the first dialog, select the (now paid) invoice, submit.
4. Expect an error toast: "One or more invoices are not eligible to settle…". Dialog stays open.

- [ ] **Step 7: Smoke 6 — over-refund guard spans refunds (behavior-change regression)**

1. On a lease with Held $1,000: create refund #1 with an expense deduction of $400 **and a non-zero cash refund of $100** (v1 requires cash > 0). After #1: refunded $100, withheld $400, balance $500.
2. Create refund #2: attempt cash refund $700 (no deductions).
3. Expect rejection — guard counts refund #1's $400 deduction **and** its $100 cash refund, so $100 + $400 + $700 > $1,000. Error mentions "exceeds remaining deposit balance of $500".
4. Retry refund #2 with $500 → succeeds; Deposit card Balance = $0. (This regresses the behavior change: pre-fix, refund #2's guard ignored refund #1's $400 deduction.)

- [ ] **Step 8: Stop dev server**

Ctrl+C in the dev terminal.

---

### Task 4.2: Push to remote

- [ ] **Step 1: Verify git status**

```
git status
```
Expected: clean working tree (all chunk commits present).

- [ ] **Step 2: Push to both remotes** (project convention — see CLAUDE.md)

```
git push origin master
git push azdo master:main
```

- [ ] **Step 3: Verify deploy + re-run Smoke 1 on production**

After the deploy completes, repeat Smoke 1 against the production URL to confirm the Destiny case works in prod.

---

## Done Criteria

- All checkboxes filled across the 4 chunks.
- Migration applied to remote without error; Task 1.2 SQL smoke passed (settle, block-void, void-reversal, over-refund guard).
- All 6 UI smoke scenarios pass on local dev.
- Smoke 1 verified on the production deploy.
- `get_lease_deposit_summary.balance` and the over-refund guard provably agree (verified in Task 1.2 Step 4 & Step 7).

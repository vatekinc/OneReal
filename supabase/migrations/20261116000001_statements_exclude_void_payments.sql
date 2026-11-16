-- ============================================================
-- Migration: statements exclude voided payments
--   void_payment() marks payments.status = 'void' and deletes the
--   income row, but get_property_statement and get_tenant_statement
--   still read every payment row, so a voided payment kept showing
--   as income/payment on the Statements page.
--   Adds p.status <> 'void' to every payments union, and hides
--   voided credits (e.g. a voided overpayment credit) on the
--   property statement. Signatures are unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_property_statement(
  p_org_id UUID,
  p_property_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  txn_date DATE,
  sort_key BIGINT,
  txn_type TEXT,
  tenant_or_vendor TEXT,
  description TEXT,
  income_amount NUMERIC,
  expense_amount NUMERIC,
  running_balance NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    -- Rent charges (informational — $0 income/expense, amount shown in description)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'rent_charge'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      i.description || ' — $' || TRIM(TO_CHAR(i.amount, '999,999,990.00')) AS description,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM invoices i
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Rent payments (cash in)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'rent_payment'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      COALESCE(p.payment_method, '') || ' payment for ' || i.invoice_number,
      p.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND p.status <> 'void'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Credits issued (informational)
    SELECT
      cr.created_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM cr.created_at)::BIGINT AS sort_key,
      'credit_issued'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      'Credit: ' || cr.reason,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM credits cr
    LEFT JOIN tenants t ON t.id = cr.tenant_id
    WHERE cr.org_id = p_org_id
      AND cr.property_id = p_property_id
      AND cr.status <> 'void'
      AND (p_from IS NULL OR cr.created_at::DATE >= p_from)
      AND (p_to IS NULL OR cr.created_at::DATE <= p_to)

    UNION ALL

    -- Credit applications (virtual income)
    SELECT
      ca.applied_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM ca.applied_at)::BIGINT AS sort_key,
      'credit_applied'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      'Credit applied: ' || cr.reason || ' to ' || i.invoice_number,
      ca.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM credit_applications ca
    JOIN credits cr ON cr.id = ca.credit_id
    JOIN invoices i ON i.id = ca.invoice_id
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE ca.org_id = p_org_id
      AND ca.status = 'active'
      AND i.property_id = p_property_id
      AND (p_from IS NULL OR ca.applied_at::DATE >= p_from)
      AND (p_to IS NULL OR ca.applied_at::DATE <= p_to)

    UNION ALL

    -- Expense bills (informational — amount shown in description)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'expense_bill'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      i.description || ' — $' || TRIM(TO_CHAR(i.amount, '999,999,990.00')) AS description,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM invoices i
    LEFT JOIN service_providers sp ON sp.id = i.provider_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'payable'
      AND i.status NOT IN ('void', 'draft')
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Expense payments (cash out)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'expense_payment'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      COALESCE(p.payment_method, '') || ' payment for ' || i.invoice_number,
      0::NUMERIC AS income_amount,
      p.amount AS expense_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN service_providers sp ON sp.id = i.provider_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'payable'
      AND p.status <> 'void'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Direct income (manual entries only — exclude payment-generated)
    SELECT
      inc.transaction_date AS txn_date,
      EXTRACT(EPOCH FROM inc.created_at)::BIGINT AS sort_key,
      'income'::TEXT AS txn_type,
      NULL::TEXT AS tenant_or_vendor,
      inc.description,
      inc.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM income inc
    WHERE inc.org_id = p_org_id
      AND inc.property_id = p_property_id
      AND (p_from IS NULL OR inc.transaction_date >= p_from)
      AND (p_to IS NULL OR inc.transaction_date <= p_to)
      AND NOT EXISTS (
        SELECT 1 FROM payments px WHERE px.income_id = inc.id
      )

    UNION ALL

    -- Direct expenses (manual entries only — exclude payment-generated)
    SELECT
      exp.transaction_date AS txn_date,
      EXTRACT(EPOCH FROM exp.created_at)::BIGINT AS sort_key,
      'expense'::TEXT AS txn_type,
      NULL::TEXT AS tenant_or_vendor,
      exp.description,
      0::NUMERIC AS income_amount,
      exp.amount AS expense_amount
    FROM expenses exp
    WHERE exp.org_id = p_org_id
      AND exp.property_id = p_property_id
      AND (p_from IS NULL OR exp.transaction_date >= p_from)
      AND (p_to IS NULL OR exp.transaction_date <= p_to)
      AND NOT EXISTS (
        SELECT 1 FROM payments px WHERE px.expense_id = exp.id
      )
  )
  SELECT
    l.txn_date,
    l.sort_key,
    l.txn_type,
    l.tenant_or_vendor,
    l.description,
    l.income_amount,
    l.expense_amount,
    SUM(l.income_amount - l.expense_amount) OVER (ORDER BY l.txn_date, l.sort_key) AS running_balance
  FROM ledger l
  ORDER BY l.txn_date, l.sort_key;
$$;

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
      AND p.status <> 'void'
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

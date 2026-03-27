-- ==========================================================
-- Statements & Rent Roll RPC Functions
-- ==========================================================

-- 1. Tenant Statement
-- Returns chronological ledger of all financial activity for a tenant at a specific property.
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
  running_balance NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    -- Charges (receivable invoices, excluding late fees)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'charge'::TEXT AS txn_type,
      i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NULL
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Late fees
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'late_fee'::TEXT AS txn_type,
      'Late fee: ' || i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NOT NULL
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Payments (join through invoices to scope by tenant + property)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'payment'::TEXT AS txn_type,
      COALESCE(p.payment_method, '') || CASE WHEN p.reference_number IS NOT NULL AND p.reference_number <> '' THEN ' #' || p.reference_number ELSE '' END,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      p.amount AS payment_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Credits issued (informational — $0 payment so no balance impact)
    SELECT
      cr.created_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM cr.created_at)::BIGINT AS sort_key,
      'credit'::TEXT AS txn_type,
      cr.reason AS description,
      LEFT(cr.id::TEXT, 8) AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM credits cr
    WHERE cr.org_id = p_org_id
      AND cr.tenant_id = p_tenant_id
      AND (cr.property_id = p_property_id OR cr.property_id IS NULL)
      AND (p_from IS NULL OR cr.created_at::DATE >= p_from)
      AND (p_to IS NULL OR cr.created_at::DATE <= p_to)

    UNION ALL

    -- Credit applications (reduces balance)
    SELECT
      ca.applied_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM ca.applied_at)::BIGINT AS sort_key,
      'credit_applied'::TEXT AS txn_type,
      'Credit applied: ' || cr.reason AS description,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      ca.amount AS payment_amount
    FROM credit_applications ca
    JOIN credits cr ON cr.id = ca.credit_id
    JOIN invoices i ON i.id = ca.invoice_id
    WHERE ca.org_id = p_org_id
      AND ca.status = 'active'
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND (p_from IS NULL OR ca.applied_at::DATE >= p_from)
      AND (p_to IS NULL OR ca.applied_at::DATE <= p_to)
  )
  SELECT
    l.txn_date,
    l.sort_key,
    l.txn_type,
    l.description,
    l.reference,
    l.charge_amount,
    l.payment_amount,
    SUM(l.charge_amount - l.payment_amount) OVER (ORDER BY l.txn_date, l.sort_key) AS running_balance
  FROM ledger l
  ORDER BY l.txn_date, l.sort_key;
$$;

-- 2. Property Statement
-- Returns chronological ledger of all financial activity for a property (cash basis).
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
    -- Rent charges (informational — $0 income/expense)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'rent_charge'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      i.description,
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

    -- Expense bills (informational)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'expense_bill'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      i.description,
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

-- 3. Rent Roll
-- Returns current rent roll snapshot grouped by tenant.
CREATE OR REPLACE FUNCTION public.get_rent_roll(
  p_org_id UUID,
  p_lease_status TEXT DEFAULT 'active',
  p_property_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tenant_id UUID,
  first_name TEXT,
  last_name TEXT,
  lease_count BIGINT,
  total_monthly_rent NUMERIC,
  balance_due NUMERIC,
  credit_balance NUMERIC,
  net_due NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    t.id AS tenant_id,
    t.first_name,
    t.last_name,
    COUNT(DISTINCT l.id) AS lease_count,
    COALESCE(SUM(l.rent_amount), 0) AS total_monthly_rent,
    COALESCE((
      SELECT SUM(inv.amount - inv.amount_paid)
      FROM invoices inv
      WHERE inv.tenant_id = t.id AND inv.org_id = p_org_id
        AND inv.direction = 'receivable'
        AND inv.status IN ('open', 'partially_paid')
    ), 0) AS balance_due,
    COALESCE((
      SELECT SUM(cr.amount - cr.amount_used)
      FROM credits cr
      WHERE cr.tenant_id = t.id AND cr.org_id = p_org_id
        AND cr.status = 'active'
    ), 0) AS credit_balance,
    COALESCE((
      SELECT SUM(inv.amount - inv.amount_paid)
      FROM invoices inv
      WHERE inv.tenant_id = t.id AND inv.org_id = p_org_id
        AND inv.direction = 'receivable'
        AND inv.status IN ('open', 'partially_paid')
    ), 0) - COALESCE((
      SELECT SUM(cr.amount - cr.amount_used)
      FROM credits cr
      WHERE cr.tenant_id = t.id AND cr.org_id = p_org_id
        AND cr.status = 'active'
    ), 0) AS net_due
  FROM tenants t
  JOIN lease_tenants lt ON lt.tenant_id = t.id
  JOIN leases l ON l.id = lt.lease_id AND l.org_id = p_org_id
  JOIN units u ON u.id = l.unit_id
  WHERE t.org_id = p_org_id
    AND (
      (p_lease_status = 'active' AND l.status IN ('active', 'month_to_month'))
      OR (p_lease_status = 'inactive' AND l.status IN ('expired', 'terminated'))
    )
    AND (p_property_id IS NULL OR u.property_id = p_property_id)
  GROUP BY t.id, t.first_name, t.last_name
  ORDER BY t.last_name, t.first_name;
$$;

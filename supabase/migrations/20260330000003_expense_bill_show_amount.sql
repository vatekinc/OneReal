-- Show bill amount in description for expense_bill rows on property statement.
-- Previously the description showed only the invoice description with no amount,
-- making it unclear how much the bill was for.

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
    -- Rent charges (informational)
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

    -- Expense bills (informational — amount appended to description)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'expense_bill'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      COALESCE(i.description, '') || ' — $' || TRIM(TO_CHAR(i.amount, 'FM999,999,990.00')),
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

    -- Direct income (manual entries only)
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

    -- Direct expenses (manual entries only)
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

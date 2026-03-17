-- ============================================================
-- Migration: Financial Aggregate Functions (RPC)
--
-- Replaces client-side JS aggregation with server-side SQL
-- GROUP BY / SUM. Reduces data transfer from all rows to
-- pre-aggregated results.
-- ============================================================

-- -----------------------------------------------------------
-- 1. get_financial_totals
--    Returns SUM(amount) for income and expenses
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_totals(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(total_income NUMERIC, total_expenses NUMERIC)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE((
      SELECT SUM(i.amount)
      FROM public.income i
      WHERE i.org_id = p_org_id
        AND (p_from IS NULL OR i.transaction_date >= p_from)
        AND (p_to IS NULL OR i.transaction_date <= p_to)
    ), 0) AS total_income,
    COALESCE((
      SELECT SUM(e.amount)
      FROM public.expenses e
      WHERE e.org_id = p_org_id
        AND (p_from IS NULL OR e.transaction_date >= p_from)
        AND (p_to IS NULL OR e.transaction_date <= p_to)
    ), 0) AS total_expenses;
$$;

-- -----------------------------------------------------------
-- 2. get_monthly_trend
--    Returns income/expenses grouped by YYYY-MM
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_monthly_trend(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(month TEXT, income NUMERIC, expenses NUMERIC)
LANGUAGE sql STABLE
AS $$
  WITH income_months AS (
    SELECT
      to_char(i.transaction_date, 'YYYY-MM') AS m,
      SUM(i.amount) AS amt
    FROM public.income i
    WHERE i.org_id = p_org_id
      AND (p_from IS NULL OR i.transaction_date >= p_from)
      AND (p_to IS NULL OR i.transaction_date <= p_to)
    GROUP BY m
  ),
  expense_months AS (
    SELECT
      to_char(e.transaction_date, 'YYYY-MM') AS m,
      SUM(e.amount) AS amt
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND (p_from IS NULL OR e.transaction_date >= p_from)
      AND (p_to IS NULL OR e.transaction_date <= p_to)
    GROUP BY m
  ),
  all_months AS (
    SELECT m FROM income_months
    UNION
    SELECT m FROM expense_months
  )
  SELECT
    am.m AS month,
    COALESCE(im.amt, 0) AS income,
    COALESCE(em.amt, 0) AS expenses
  FROM all_months am
  LEFT JOIN income_months im ON im.m = am.m
  LEFT JOIN expense_months em ON em.m = am.m
  ORDER BY am.m;
$$;

-- -----------------------------------------------------------
-- 3. get_category_breakdown
--    Returns category, amount, percentage for income or expense
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_category_breakdown(
  p_org_id UUID,
  p_type TEXT,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(category TEXT, amount NUMERIC, percentage NUMERIC)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  IF p_type = 'income' THEN
    SELECT COALESCE(SUM(i.amount), 0) INTO v_total
    FROM public.income i
    WHERE i.org_id = p_org_id
      AND (p_from IS NULL OR i.transaction_date >= p_from)
      AND (p_to IS NULL OR i.transaction_date <= p_to);

    RETURN QUERY
    SELECT
      COALESCE(i.income_type, 'Other')::TEXT AS category,
      SUM(i.amount) AS amount,
      CASE WHEN v_total > 0
        THEN ROUND(SUM(i.amount) / v_total * 100, 2)
        ELSE 0
      END AS percentage
    FROM public.income i
    WHERE i.org_id = p_org_id
      AND (p_from IS NULL OR i.transaction_date >= p_from)
      AND (p_to IS NULL OR i.transaction_date <= p_to)
    GROUP BY i.income_type
    ORDER BY amount DESC;
  ELSE
    SELECT COALESCE(SUM(e.amount), 0) INTO v_total
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND (p_from IS NULL OR e.transaction_date >= p_from)
      AND (p_to IS NULL OR e.transaction_date <= p_to);

    RETURN QUERY
    SELECT
      COALESCE(e.expense_type, 'Other')::TEXT AS category,
      SUM(e.amount) AS amount,
      CASE WHEN v_total > 0
        THEN ROUND(SUM(e.amount) / v_total * 100, 2)
        ELSE 0
      END AS percentage
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND (p_from IS NULL OR e.transaction_date >= p_from)
      AND (p_to IS NULL OR e.transaction_date <= p_to)
    GROUP BY e.expense_type
    ORDER BY amount DESC;
  END IF;
END;
$$;

-- -----------------------------------------------------------
-- 4. get_property_financials
--    Returns per-property income, expenses, net, roi
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_property_financials(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  property_id UUID,
  property_name TEXT,
  income NUMERIC,
  expenses NUMERIC,
  net NUMERIC,
  roi NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id AS property_id,
    p.name AS property_name,
    COALESCE(inc.total, 0) AS income,
    COALESCE(exp.total, 0) AS expenses,
    COALESCE(inc.total, 0) - COALESCE(exp.total, 0) AS net,
    CASE WHEN COALESCE(inc.total, 0) > 0
      THEN ROUND((COALESCE(inc.total, 0) - COALESCE(exp.total, 0)) / inc.total * 100, 2)
      ELSE 0
    END AS roi
  FROM public.properties p
  LEFT JOIN (
    SELECT i.property_id, SUM(i.amount) AS total
    FROM public.income i
    WHERE i.org_id = p_org_id
      AND (p_from IS NULL OR i.transaction_date >= p_from)
      AND (p_to IS NULL OR i.transaction_date <= p_to)
    GROUP BY i.property_id
  ) inc ON inc.property_id = p.id
  LEFT JOIN (
    SELECT e.property_id, SUM(e.amount) AS total
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND (p_from IS NULL OR e.transaction_date >= p_from)
      AND (p_to IS NULL OR e.transaction_date <= p_to)
    GROUP BY e.property_id
  ) exp ON exp.property_id = p.id
  WHERE p.org_id = p_org_id
  ORDER BY p.name;
$$;

-- -----------------------------------------------------------
-- 5. get_rent_collection_rate
--    Returns monthly invoiced vs collected amounts
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rent_collection_rate(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  month TEXT,
  invoiced_amount NUMERIC,
  collected_amount NUMERIC,
  collection_rate NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(inv.due_date, 'YYYY-MM') AS month,
    SUM(inv.amount) AS invoiced_amount,
    SUM(inv.amount_paid) AS collected_amount,
    CASE WHEN SUM(inv.amount) > 0
      THEN ROUND(SUM(inv.amount_paid) / SUM(inv.amount) * 100, 2)
      ELSE 0
    END AS collection_rate
  FROM public.invoices inv
  WHERE inv.org_id = p_org_id
    AND inv.direction = 'receivable'
    AND inv.status NOT IN ('void', 'draft')
    AND (p_from IS NULL OR inv.due_date >= p_from)
    AND (p_to IS NULL OR inv.due_date <= p_to)
  GROUP BY to_char(inv.due_date, 'YYYY-MM')
  ORDER BY month;
$$;

-- -----------------------------------------------------------
-- 6. get_invoice_aging
--    Returns aging buckets for open receivables
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_invoice_aging(
  p_org_id UUID
)
RETURNS TABLE(
  bucket TEXT,
  count BIGINT,
  total_amount NUMERIC,
  total_outstanding NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH aged AS (
    SELECT
      inv.amount,
      inv.amount - COALESCE(inv.amount_paid, 0) AS outstanding,
      CASE
        WHEN CURRENT_DATE - inv.due_date <= 0 THEN 'Current'
        WHEN CURRENT_DATE - inv.due_date <= 30 THEN '1-30 Days'
        WHEN CURRENT_DATE - inv.due_date <= 60 THEN '31-60 Days'
        WHEN CURRENT_DATE - inv.due_date <= 90 THEN '61-90 Days'
        ELSE '90+ Days'
      END AS bucket
    FROM public.invoices inv
    WHERE inv.org_id = p_org_id
      AND inv.direction = 'receivable'
      AND inv.status IN ('open', 'partially_paid')
  ),
  buckets(bucket, sort_order) AS (
    VALUES
      ('Current', 1),
      ('1-30 Days', 2),
      ('31-60 Days', 3),
      ('61-90 Days', 4),
      ('90+ Days', 5)
  )
  SELECT
    b.bucket,
    COALESCE(COUNT(a.amount), 0) AS count,
    COALESCE(SUM(a.amount), 0) AS total_amount,
    COALESCE(SUM(a.outstanding), 0) AS total_outstanding
  FROM buckets b
  LEFT JOIN aged a ON a.bucket = b.bucket
  GROUP BY b.bucket, b.sort_order
  ORDER BY b.sort_order;
$$;

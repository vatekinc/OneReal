-- ==========================================================
-- Rent Roll v2: Group by property, split balance into 3 buckets
-- ==========================================================
-- Changes from v1:
--   - Rows are now per-property (was per-tenant)
--   - Tenants aggregated into a comma-separated string
--   - balance_due replaced with past_due / current_due / future_due
--   - Date boundaries: current month = [1st of month, last of month]
--   - Lease status filter: 'active', 'inactive', or 'all'
-- ==========================================================

-- Must drop first because return type changes (PG doesn't allow CREATE OR REPLACE for that)
DROP FUNCTION IF EXISTS public.get_rent_roll(UUID, TEXT, UUID);

CREATE FUNCTION public.get_rent_roll(
  p_org_id UUID,
  p_lease_status TEXT DEFAULT 'active',
  p_property_id UUID DEFAULT NULL
)
RETURNS TABLE(
  property_id UUID,
  property_name TEXT,
  tenants TEXT,
  lease_count BIGINT,
  total_monthly_rent NUMERIC,
  past_due NUMERIC,
  current_due NUMERIC,
  future_due NUMERIC,
  credit_balance NUMERIC,
  net_due NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH month_bounds AS (
    SELECT
      DATE_TRUNC('month', CURRENT_DATE)::DATE AS month_start,
      (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS month_end
  ),
  property_leases AS (
    SELECT
      prop.id AS property_id,
      prop.name AS property_name,
      t.id AS tenant_id,
      t.first_name,
      t.last_name,
      l.id AS lease_id,
      l.rent_amount
    FROM properties prop
    JOIN units u ON u.property_id = prop.id
    JOIN leases l ON l.unit_id = u.id AND l.org_id = p_org_id
    JOIN lease_tenants lt ON lt.lease_id = l.id
    JOIN tenants t ON t.id = lt.tenant_id
    WHERE prop.org_id = p_org_id
      AND (
        p_lease_status = 'all'
        OR (p_lease_status = 'active' AND l.status IN ('active', 'month_to_month'))
        OR (p_lease_status = 'inactive' AND l.status IN ('expired', 'terminated'))
      )
      AND (p_property_id IS NULL OR prop.id = p_property_id)
  ),
  -- Aggregate outstanding invoices per property, split by date bucket
  property_invoices AS (
    SELECT
      pl.property_id,
      COALESCE(SUM(CASE WHEN inv.due_date < mb.month_start THEN inv.amount - inv.amount_paid ELSE 0 END), 0) AS past_due,
      COALESCE(SUM(CASE WHEN inv.due_date >= mb.month_start AND inv.due_date <= mb.month_end THEN inv.amount - inv.amount_paid ELSE 0 END), 0) AS current_due,
      COALESCE(SUM(CASE WHEN inv.due_date > mb.month_end THEN inv.amount - inv.amount_paid ELSE 0 END), 0) AS future_due
    FROM (SELECT DISTINCT property_id, tenant_id FROM property_leases) pl
    CROSS JOIN month_bounds mb
    LEFT JOIN invoices inv ON inv.tenant_id = pl.tenant_id
      AND inv.org_id = p_org_id
      AND inv.direction = 'receivable'
      AND inv.status IN ('open', 'partially_paid')
    GROUP BY pl.property_id
  ),
  -- Aggregate credits per property
  property_credits AS (
    SELECT
      pl.property_id,
      COALESCE(SUM(cr.amount - cr.amount_used), 0) AS credit_balance
    FROM (SELECT DISTINCT property_id, tenant_id FROM property_leases) pl
    LEFT JOIN credits cr ON cr.tenant_id = pl.tenant_id
      AND cr.org_id = p_org_id
      AND cr.status = 'active'
    GROUP BY pl.property_id
  )
  SELECT
    pl.property_id,
    pl.property_name,
    STRING_AGG(DISTINCT (pl.last_name || ', ' || pl.first_name), '; ' ORDER BY (pl.last_name || ', ' || pl.first_name)) AS tenants,
    COUNT(DISTINCT pl.lease_id) AS lease_count,
    COALESCE(SUM(DISTINCT pl.rent_amount), 0) AS total_monthly_rent,
    COALESCE(pi.past_due, 0) AS past_due,
    COALESCE(pi.current_due, 0) AS current_due,
    COALESCE(pi.future_due, 0) AS future_due,
    COALESCE(pc.credit_balance, 0) AS credit_balance,
    COALESCE(pi.past_due, 0) + COALESCE(pi.current_due, 0) + COALESCE(pi.future_due, 0) - COALESCE(pc.credit_balance, 0) AS net_due
  FROM property_leases pl
  LEFT JOIN property_invoices pi ON pi.property_id = pl.property_id
  LEFT JOIN property_credits pc ON pc.property_id = pl.property_id
  GROUP BY pl.property_id, pl.property_name, pi.past_due, pi.current_due, pi.future_due, pc.credit_balance
  ORDER BY pl.property_name;
$$;

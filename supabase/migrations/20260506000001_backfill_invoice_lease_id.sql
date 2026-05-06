-- ============================================================
-- Backfill invoices.lease_id for receivable invoices that were
-- created manually (lease_id IS NULL) but can be unambiguously
-- matched to an active lease via tenant + property.
--
-- Only updates rows where there is exactly ONE active lease for
-- the invoice's tenant on the invoice's property — never guesses.
-- ============================================================

WITH candidates AS (
  SELECT
    inv.id AS invoice_id,
    (
      SELECT l.id
      FROM public.lease_tenants lt
      JOIN public.leases l ON l.id = lt.lease_id
      JOIN public.units u ON u.id = l.unit_id
      WHERE lt.tenant_id = inv.tenant_id
        AND u.property_id = inv.property_id
        AND l.status = 'active'
      LIMIT 2
    ) AS first_lease_id,
    (
      SELECT COUNT(*)
      FROM public.lease_tenants lt
      JOIN public.leases l ON l.id = lt.lease_id
      JOIN public.units u ON u.id = l.unit_id
      WHERE lt.tenant_id = inv.tenant_id
        AND u.property_id = inv.property_id
        AND l.status = 'active'
    ) AS match_count
  FROM public.invoices inv
  WHERE inv.lease_id IS NULL
    AND inv.tenant_id IS NOT NULL
    AND inv.property_id IS NOT NULL
    AND inv.direction = 'receivable'
)
UPDATE public.invoices inv
SET lease_id = c.first_lease_id
FROM candidates c
WHERE inv.id = c.invoice_id
  AND c.match_count = 1
  AND c.first_lease_id IS NOT NULL;

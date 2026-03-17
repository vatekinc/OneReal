-- Maintenance RLS: Upgrade existing policies to helper functions + add tenant policies

-- 1. Drop old inline-subquery policies
DROP POLICY IF EXISTS "Members can view maintenance requests" ON public.maintenance_requests;
DROP POLICY IF EXISTS "Managers can manage maintenance requests" ON public.maintenance_requests;

-- 2. Recreate with helper functions
CREATE POLICY "Members can view maintenance requests"
  ON public.maintenance_requests FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert maintenance requests"
  ON public.maintenance_requests FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update maintenance requests"
  ON public.maintenance_requests FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete maintenance requests"
  ON public.maintenance_requests FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- 3. Tenant-specific policies
CREATE POLICY "Tenants can view own maintenance requests"
  ON public.maintenance_requests FOR SELECT
  USING (reported_by = auth.uid());

CREATE POLICY "Tenants can insert maintenance requests"
  ON public.maintenance_requests FOR INSERT
  WITH CHECK (
    reported_by = auth.uid()
    AND unit_id IN (SELECT public.get_tenant_unit_ids())
  );

-- 4. Index for tenant query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_reported_by
  ON public.maintenance_requests(reported_by);

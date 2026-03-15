-- Fix: Tenant RLS policies on units/properties cause infinite recursion
-- because inline subqueries trigger cross-table RLS evaluation.
-- Solution: SECURITY DEFINER functions that bypass RLS.

-- Helper: get unit IDs for tenant's leases (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_tenant_unit_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.unit_id FROM public.leases l
  WHERE l.id IN (SELECT public.get_tenant_lease_ids());
$$;

-- Helper: get property IDs for tenant's units (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_tenant_property_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.property_id FROM public.units u
  WHERE u.id IN (SELECT public.get_tenant_unit_ids());
$$;

-- Drop and recreate the problematic policies using the new helpers
DROP POLICY IF EXISTS "Tenants can view own units" ON public.units;
CREATE POLICY "Tenants can view own units"
  ON public.units FOR SELECT
  USING (id IN (SELECT public.get_tenant_unit_ids()));

DROP POLICY IF EXISTS "Tenants can view own properties" ON public.properties;
CREATE POLICY "Tenants can view own properties"
  ON public.properties FOR SELECT
  USING (id IN (SELECT public.get_tenant_property_ids()));

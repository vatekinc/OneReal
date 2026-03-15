-- Fix: Tenant invoice RLS should also match on tenant_id (not just lease_id)
-- Invoice creation sets tenant_id but not always lease_id.

-- Helper: get tenant record IDs for the current user (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.get_tenant_record_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id FROM public.tenants t WHERE t.user_id = auth.uid();
$$;

-- Drop and recreate invoice policy to include tenant_id match
DROP POLICY IF EXISTS "Tenants can view own invoices" ON public.invoices;
CREATE POLICY "Tenants can view own invoices"
  ON public.invoices FOR SELECT
  USING (
    lease_id IN (SELECT public.get_tenant_lease_ids())
    OR tenant_id IN (SELECT public.get_tenant_record_ids())
  );

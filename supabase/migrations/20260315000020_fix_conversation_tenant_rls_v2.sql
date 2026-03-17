-- Fix: get_user_org_ids() excludes tenants (role != 'tenant').
-- Create a tenant-specific helper and use it for the conversations INSERT policy.

-- Helper: returns org_ids where the current user is a tenant
CREATE OR REPLACE FUNCTION public.get_user_tenant_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND om.role = 'tenant';
$$;

-- Replace the broken tenant policy
DROP POLICY IF EXISTS "Tenants can create conversations" ON public.conversations;

CREATE POLICY "Tenants can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_tenant_org_ids()));

-- Fix: Allow tenants to look up their org manager for messaging
-- Tenants can't query org_members directly due to RLS, so we use a SECURITY DEFINER function

CREATE OR REPLACE FUNCTION public.get_org_manager_user_id(p_org_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.user_id
  FROM public.org_members om
  WHERE om.org_id = p_org_id
    AND om.role IN ('admin', 'landlord', 'property_manager')
    AND om.status = 'active'
  LIMIT 1;
$$;

-- Allow any authenticated user to call this function
GRANT EXECUTE ON FUNCTION public.get_org_manager_user_id(UUID) TO authenticated;

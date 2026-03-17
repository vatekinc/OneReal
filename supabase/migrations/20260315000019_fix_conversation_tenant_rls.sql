-- Fix: Tenant INSERT policy on conversations uses raw org_members subquery
-- which is blocked by org_members RLS. Use SECURITY DEFINER helper instead.

DROP POLICY "Tenants can create conversations" ON public.conversations;

CREATE POLICY "Tenants can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids()));

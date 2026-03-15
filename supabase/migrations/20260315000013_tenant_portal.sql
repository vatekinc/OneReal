-- Phase 5A: Tenant Portal
-- Adds user_id/invited_at to tenants, RLS helper functions, tenant-specific policies

-- 1. Add columns to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- Unique index: one user per tenant record
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_user_id
  ON public.tenants(user_id) WHERE user_id IS NOT NULL;

-- Unique partial index: prevent duplicate emails per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_org_email
  ON public.tenants(org_id, email) WHERE email IS NOT NULL;

-- Index on email for linking RPC performance
CREATE INDEX IF NOT EXISTS idx_tenants_email
  ON public.tenants(email) WHERE email IS NOT NULL;

-- 2. RLS helper: get lease IDs for the current tenant user
CREATE OR REPLACE FUNCTION public.get_tenant_lease_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.id FROM public.leases l
  INNER JOIN public.tenants t ON t.id = l.tenant_id
  WHERE t.user_id = auth.uid();
$$;

-- 3. Modify get_user_org_ids() to EXCLUDE tenant-role memberships
-- Tenants must NOT see all org data through existing org-wide SELECT policies.
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
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
    AND om.role != 'tenant';
$$;

-- 4. RLS: tenants can see their own org_members and organizations
-- (Required because get_user_org_ids() now excludes tenant memberships,
--  but tenants still need to see their org for useUser/OrgSwitcher)
CREATE POLICY "Users can view own memberships"
  ON public.org_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view orgs they belong to"
  ON public.organizations FOR SELECT
  USING (id IN (
    SELECT org_id FROM public.org_members
    WHERE user_id = auth.uid() AND status = 'active'
  ));

-- 5. Tenant invite detection (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.check_is_invited_tenant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND invited_at IS NOT NULL
      AND user_id IS NULL
  );
$$;

-- 6. Tenant-specific RLS policies (read-only)

CREATE POLICY "Tenants can view own record"
  ON public.tenants FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Tenants can view own leases"
  ON public.leases FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants can view own invoices"
  ON public.invoices FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

CREATE POLICY "Tenants can view own lease charges"
  ON public.lease_charges FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

CREATE POLICY "Tenants can view own units"
  ON public.units FOR SELECT
  USING (
    id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
  );

CREATE POLICY "Tenants can view own properties"
  ON public.properties FOR SELECT
  USING (
    id IN (
      SELECT property_id FROM public.units
      WHERE id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
    )
  );

-- 7. Tenant linking function (called after onboarding)
CREATE OR REPLACE FUNCTION public.link_tenant_on_invite()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_tenant RECORD;
BEGIN
  v_user_id := auth.uid();

  SELECT email INTO v_user_email
  FROM auth.users WHERE id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN;
  END IF;

  FOR v_tenant IN
    SELECT id, org_id FROM public.tenants
    WHERE email = v_user_email
      AND invited_at IS NOT NULL
      AND user_id IS NULL
  LOOP
    UPDATE public.tenants SET user_id = v_user_id WHERE id = v_tenant.id;

    INSERT INTO public.org_members (org_id, user_id, role, status, joined_at)
    VALUES (v_tenant.org_id, v_user_id, 'tenant', 'active', now())
    ON CONFLICT (org_id, user_id) DO NOTHING;

    UPDATE public.profiles
    SET default_org_id = v_tenant.org_id
    WHERE id = v_user_id
      AND (
        default_org_id IS NULL
        OR default_org_id IN (
          SELECT id FROM public.organizations WHERE type = 'personal'
        )
      );
  END LOOP;
END;
$$;

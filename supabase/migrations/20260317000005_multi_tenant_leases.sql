-- ============================================================
-- Migration 005: Multi-tenant leases + lease type
--
-- 1. Create lease_tenants junction table (many-to-many)
-- 2. Migrate existing tenant_id data
-- 3. Add lease_type column (fixed / month_to_month)
-- 4. Drop RLS policy + FK + index that depend on tenant_id
-- 5. Update get_tenant_lease_ids() to use junction table
-- 6. Recreate RLS policy for tenants using junction table
-- 7. Drop old tenant_id column from leases
-- ============================================================

-- 1. Create junction table
CREATE TABLE public.lease_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lease_id, tenant_id)
);

CREATE INDEX idx_lease_tenants_lease ON public.lease_tenants(lease_id);
CREATE INDEX idx_lease_tenants_tenant ON public.lease_tenants(tenant_id);

-- RLS (inherit from leases org)
ALTER TABLE public.lease_tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease_tenants"
  ON public.lease_tenants FOR SELECT
  USING (lease_id IN (SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_org_ids())));

CREATE POLICY "Managers can insert lease_tenants"
  ON public.lease_tenants FOR INSERT
  WITH CHECK (lease_id IN (SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())));

CREATE POLICY "Managers can delete lease_tenants"
  ON public.lease_tenants FOR DELETE
  USING (lease_id IN (SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())));

-- Tenants can view their own lease_tenants rows
CREATE POLICY "Tenants can view own lease_tenants"
  ON public.lease_tenants FOR SELECT
  USING (tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid()));

-- 2. Migrate existing tenant_id data into junction table
INSERT INTO public.lease_tenants (lease_id, tenant_id)
SELECT id, tenant_id FROM public.leases WHERE tenant_id IS NOT NULL;

-- 3. Add lease_type column
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS lease_type TEXT NOT NULL DEFAULT 'fixed'
  CHECK (lease_type IN ('fixed', 'month_to_month'));

-- 4. Drop the RLS policy that depends on leases.tenant_id
DROP POLICY IF EXISTS "Tenants can view own leases" ON public.leases;

-- 5. Update get_tenant_lease_ids() to use the junction table
CREATE OR REPLACE FUNCTION public.get_tenant_lease_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lt.lease_id FROM public.lease_tenants lt
  INNER JOIN public.tenants t ON t.id = lt.tenant_id
  WHERE t.user_id = auth.uid();
$$;

-- 6. Recreate RLS policy for tenants using junction table
CREATE POLICY "Tenants can view own leases"
  ON public.leases FOR SELECT
  USING (
    id IN (SELECT public.get_tenant_lease_ids())
  );

-- 7. Drop FK constraint, index, and column
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_tenant_id_fkey;
DROP INDEX IF EXISTS idx_leases_tenant;
ALTER TABLE public.leases DROP COLUMN IF EXISTS tenant_id;

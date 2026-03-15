-- ============================================================
-- Migration 007: Contacts Module (tenants, service_providers, lease_documents)
--
-- Phase 3: Contacts & Leases
-- Depends on: organizations, properties, units, leases (Phase 1)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)
-- ============================================================

-- -----------------------------------------------------------
-- tenants table
-- -----------------------------------------------------------
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- service_providers table
-- -----------------------------------------------------------
CREATE TABLE public.service_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner',
    'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith',
    'appliance_repair', 'other'
  )),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- lease_documents table
-- -----------------------------------------------------------
CREATE TABLE public.lease_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  document_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Modify leases table: change tenant_id FK, add renewal columns
-- -----------------------------------------------------------
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_tenant_id_fkey;
ALTER TABLE public.leases
  ADD CONSTRAINT leases_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewal_status TEXT DEFAULT NULL
  CHECK (renewal_status IS NULL OR renewal_status IN ('upcoming', 'renewed', 'not_renewing'));
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewal_notes TEXT;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewed_from_id UUID REFERENCES public.leases(id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- Modify expenses table: add provider_id FK
-- -----------------------------------------------------------
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS provider_id UUID
  REFERENCES public.service_providers(id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------
CREATE INDEX idx_tenants_org ON public.tenants(org_id);
CREATE INDEX idx_service_providers_org_category ON public.service_providers(org_id, category);
CREATE INDEX idx_lease_documents_lease ON public.lease_documents(lease_id);
CREATE INDEX idx_expenses_provider ON public.expenses(provider_id);
CREATE INDEX idx_leases_tenant ON public.leases(tenant_id);

-- -----------------------------------------------------------
-- RLS Policies — tenants
-- -----------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenants in their orgs"
  ON public.tenants FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert tenants"
  ON public.tenants FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update tenants"
  ON public.tenants FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete tenants"
  ON public.tenants FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — service_providers
-- -----------------------------------------------------------
ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view providers in their orgs"
  ON public.service_providers FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert providers"
  ON public.service_providers FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update providers"
  ON public.service_providers FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete providers"
  ON public.service_providers FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — lease_documents (join through leases)
-- -----------------------------------------------------------
ALTER TABLE public.lease_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease documents"
  ON public.lease_documents FOR SELECT
  USING (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_org_ids())
  ));

CREATE POLICY "Managers can insert lease documents"
  ON public.lease_documents FOR INSERT
  WITH CHECK (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())
  ));

CREATE POLICY "Managers can delete lease documents"
  ON public.lease_documents FOR DELETE
  USING (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())
  ));

-- -----------------------------------------------------------
-- Replace leases RLS policies with helper-function pattern
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "Members can view leases" ON public.leases;
DROP POLICY IF EXISTS "Managers can manage leases" ON public.leases;

CREATE POLICY "Users can view leases in their orgs"
  ON public.leases FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert leases"
  ON public.leases FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update leases"
  ON public.leases FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete leases"
  ON public.leases FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- Updated-at triggers
-- -----------------------------------------------------------
CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER set_service_providers_updated_at
  BEFORE UPDATE ON public.service_providers
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

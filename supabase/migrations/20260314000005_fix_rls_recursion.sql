-- ============================================================
-- Migration 005: Fix RLS infinite recursion on org_members
--
-- The org_members SELECT policy referenced org_members itself,
-- causing "infinite recursion detected in policy" (42P17).
-- Fix: SECURITY DEFINER helper functions that bypass RLS.
-- ============================================================

-- Helper: returns org_ids where the current user is an active member
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active';
$$;

-- Helper: returns org_ids where the current user is admin/landlord/property_manager
CREATE OR REPLACE FUNCTION public.get_user_managed_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND om.role IN ('admin', 'landlord', 'property_manager');
$$;

-- Helper: returns org_ids where the current user is admin
CREATE OR REPLACE FUNCTION public.get_user_admin_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND om.role = 'admin';
$$;

-- ============================================================
-- Drop and recreate org_members policies
-- ============================================================
DROP POLICY IF EXISTS "Members can view org members" ON public.org_members;
CREATE POLICY "Members can view org members"
  ON public.org_members FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

DROP POLICY IF EXISTS "Admins can manage org members" ON public.org_members;
CREATE POLICY "Admins can manage org members"
  ON public.org_members FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_admin_org_ids()));

DROP POLICY IF EXISTS "Admins can update org members" ON public.org_members;
CREATE POLICY "Admins can update org members"
  ON public.org_members FOR UPDATE
  USING (org_id IN (SELECT public.get_user_admin_org_ids()));

DROP POLICY IF EXISTS "Admins can delete org members" ON public.org_members;
CREATE POLICY "Admins can delete org members"
  ON public.org_members FOR DELETE
  USING (org_id IN (SELECT public.get_user_admin_org_ids()));

-- ============================================================
-- Drop and recreate organizations policies
-- ============================================================
DROP POLICY IF EXISTS "Members can view org" ON public.organizations;
CREATE POLICY "Members can view org"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT public.get_user_org_ids()));

DROP POLICY IF EXISTS "Admins can update org" ON public.organizations;
CREATE POLICY "Admins can update org"
  ON public.organizations FOR UPDATE
  USING (id IN (SELECT public.get_user_admin_org_ids()));

-- ============================================================
-- Drop and recreate properties policies
-- ============================================================
DROP POLICY IF EXISTS "Members can view properties" ON public.properties;
CREATE POLICY "Members can view properties"
  ON public.properties FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

DROP POLICY IF EXISTS "Managers can insert properties" ON public.properties;
CREATE POLICY "Managers can insert properties"
  ON public.properties FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

DROP POLICY IF EXISTS "Managers can update properties" ON public.properties;
CREATE POLICY "Managers can update properties"
  ON public.properties FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

DROP POLICY IF EXISTS "Managers can delete properties" ON public.properties;
CREATE POLICY "Managers can delete properties"
  ON public.properties FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- Drop and recreate units policies
-- ============================================================
DROP POLICY IF EXISTS "Members can view units" ON public.units;
CREATE POLICY "Members can view units"
  ON public.units FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can insert units" ON public.units;
CREATE POLICY "Managers can insert units"
  ON public.units FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can update units" ON public.units;
CREATE POLICY "Managers can update units"
  ON public.units FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can delete units" ON public.units;
CREATE POLICY "Managers can delete units"
  ON public.units FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

-- ============================================================
-- Drop and recreate property_images policies
-- ============================================================
DROP POLICY IF EXISTS "Members can view property images" ON public.property_images;
CREATE POLICY "Members can view property images"
  ON public.property_images FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can insert property images" ON public.property_images;
CREATE POLICY "Managers can insert property images"
  ON public.property_images FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can update property images" ON public.property_images;
CREATE POLICY "Managers can update property images"
  ON public.property_images FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

DROP POLICY IF EXISTS "Managers can delete property images" ON public.property_images;
CREATE POLICY "Managers can delete property images"
  ON public.property_images FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

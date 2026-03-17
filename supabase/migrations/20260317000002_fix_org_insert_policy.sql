-- Fix: ensure authenticated users can create organizations (for onboarding)
-- The original INSERT policy may not have been applied correctly.

DROP POLICY IF EXISTS "Authenticated users can create orgs" ON public.organizations;

CREATE POLICY "Authenticated users can create orgs"
  ON public.organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RPC to create a company org during onboarding
-- Uses SECURITY DEFINER to bypass RLS since the user isn't a member yet
CREATE OR REPLACE FUNCTION public.create_company_org(
  p_name TEXT,
  p_slug TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_plan_id UUID;
  v_org_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get default plan
  SELECT id INTO v_plan_id FROM plans WHERE is_default = true LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'No default plan configured';
  END IF;

  -- Create organization
  INSERT INTO organizations (name, slug, type, plan_id)
  VALUES (p_name, p_slug, 'company', v_plan_id)
  RETURNING id INTO v_org_id;

  -- Add user as admin
  INSERT INTO org_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'admin', 'active');

  -- Set as default org
  UPDATE profiles SET default_org_id = v_org_id WHERE id = v_user_id;

  RETURN v_org_id;
END;
$$;

-- Update handle_new_profile to assign default plan to personal orgs
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_org_id UUID;
  slug_base TEXT;
  final_slug TEXT;
  default_plan_id UUID;
BEGIN
  -- Get default plan
  SELECT id INTO default_plan_id FROM public.plans WHERE is_default = true LIMIT 1;

  -- Generate slug from email (part before @)
  slug_base := lower(split_part(COALESCE(NEW.email, NEW.id::text), '@', 1));
  slug_base := regexp_replace(slug_base, '[^a-z0-9]', '-', 'g');
  slug_base := regexp_replace(slug_base, '-+', '-', 'g');
  slug_base := trim(BOTH '-' FROM slug_base);

  -- Handle slug collision by appending random suffix
  final_slug := slug_base;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
    final_slug := slug_base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create personal org with default plan
  INSERT INTO public.organizations (name, slug, type, plan_id)
  VALUES ('Personal', final_slug, 'personal', default_plan_id)
  RETURNING id INTO new_org_id;

  -- Add user as admin of personal org
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'admin', 'active');

  -- Set as default org
  UPDATE public.profiles SET default_org_id = new_org_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

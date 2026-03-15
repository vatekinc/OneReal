-- ============================================================
-- Migration 004: Fix trigger functions for Supabase Cloud
-- The SECURITY DEFINER functions need SET search_path = '' and
-- fully qualified table names to properly bypass RLS on Cloud.
-- ============================================================

-- Recreate handle_new_user with proper settings
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Recreate handle_new_profile with proper settings
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
BEGIN
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

  -- Create personal org
  INSERT INTO public.organizations (name, slug, type)
  VALUES ('Personal', final_slug, 'personal')
  RETURNING id INTO new_org_id;

  -- Add user as admin of personal org
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'admin', 'active');

  -- Set as default org
  UPDATE public.profiles SET default_org_id = new_org_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

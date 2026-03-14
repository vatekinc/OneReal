-- ============================================================
-- Migration 001: Core Tables
-- organizations, profiles, org_members
-- Triggers: auto-create profile, auto-create personal org
-- RLS policies for all tables
-- ============================================================

-- organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'company')),
  logo_url TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- profiles (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  default_org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- org_members (join table)
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'landlord', 'property_manager', 'tenant', 'contractor')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'inactive')),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Indexes
CREATE INDEX idx_org_members_org_id ON org_members(org_id);
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_profiles_default_org ON profiles(default_org_id);

-- moddatetime triggers for updated_at
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Trigger: on_auth_user_created
-- When a new user registers, create a profile row
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Trigger: on_profile_created
-- When a profile is created, auto-create personal org + membership
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER AS $$
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
  WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = final_slug) LOOP
    final_slug := slug_base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create personal org
  INSERT INTO organizations (name, slug, type)
  VALUES ('Personal', final_slug, 'personal')
  RETURNING id INTO new_org_id;

  -- Add user as admin of personal org
  INSERT INTO org_members (org_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'admin', 'active');

  -- Set as default org
  UPDATE profiles SET default_org_id = new_org_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- ============================================================
-- RLS: Enable and create policies
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update own row
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- organizations: members can view their orgs
CREATE POLICY "Members can view org"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- organizations: admins can update their orgs
CREATE POLICY "Admins can update org"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin')
    )
  );

-- org_members: members can view members in their orgs
CREATE POLICY "Members can view org members"
  ON org_members FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- org_members: admins can insert/update/delete members
CREATE POLICY "Admins can manage org members"
  ON org_members FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update org members"
  ON org_members FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete org members"
  ON org_members FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

-- organizations: authenticated users can create orgs (for onboarding company org creation)
CREATE POLICY "Authenticated users can create orgs"
  ON organizations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- org_members: users can add themselves as first member of a new org (for onboarding)
CREATE POLICY "Users can add themselves to their own new org"
  ON org_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM org_members existing WHERE existing.org_id = org_members.org_id
    )
  );

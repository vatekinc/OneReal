-- Add platform admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;

-- Partial index: only index rows where is_platform_admin is true (sparse)
CREATE INDEX IF NOT EXISTS idx_profiles_is_platform_admin
  ON profiles(is_platform_admin) WHERE is_platform_admin = true;

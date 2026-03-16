-- Plans table
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  max_properties INT NOT NULL DEFAULT 10,
  features JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one plan can be the default
CREATE UNIQUE INDEX plans_single_default ON plans (is_default) WHERE is_default = true;

-- Auto-update updated_at
CREATE TRIGGER handle_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Seed Free and Paid plans
INSERT INTO plans (name, slug, max_properties, features, is_default) VALUES
  ('Free', 'free', 10, '{"online_payments": false, "messaging": false}', true),
  ('Paid', 'paid', 0, '{"online_payments": true, "messaging": true}', false);

-- Add plan_id to organizations (nullable first for backfill)
ALTER TABLE organizations ADD COLUMN plan_id UUID REFERENCES plans(id);

-- Backfill existing organizations to Free plan
UPDATE organizations SET plan_id = (SELECT id FROM plans WHERE slug = 'free');

-- Now make it NOT NULL
ALTER TABLE organizations ALTER COLUMN plan_id SET NOT NULL;

-- RLS for plans table
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plans"
  ON plans FOR SELECT
  TO authenticated
  USING (true);

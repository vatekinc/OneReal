-- Add Plaid columns to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plaid_access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS plaid_account_id text,
  ADD COLUMN IF NOT EXISTS plaid_item_id text,
  ADD COLUMN IF NOT EXISTS plaid_institution_name text,
  ADD COLUMN IF NOT EXISTS plaid_account_mask text,
  ADD COLUMN IF NOT EXISTS plaid_status text NOT NULL DEFAULT 'not_connected';

-- Add Plaid columns to invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS plaid_transfer_id text,
  ADD COLUMN IF NOT EXISTS payment_processor text;

-- Add plaid_event_id to payment_events
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS plaid_event_id text;

-- Add income_id to payments for reversal linkage
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS income_id uuid REFERENCES income(id) ON DELETE SET NULL;

-- Create tenant_bank_accounts table
CREATE TABLE IF NOT EXISTS tenant_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plaid_access_token_encrypted text NOT NULL,
  plaid_account_id text NOT NULL,
  plaid_item_id text NOT NULL,
  institution_name text NOT NULL,
  account_mask text NOT NULL,
  account_name text NOT NULL,
  auto_pay_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, org_id)
);

-- updated_at trigger for tenant_bank_accounts
CREATE OR REPLACE FUNCTION update_tenant_bank_accounts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenant_bank_accounts_updated_at
  BEFORE UPDATE ON tenant_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_bank_accounts_updated_at();

-- Platform config table (for Plaid sync cursor etc.)
CREATE TABLE IF NOT EXISTS platform_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed sync cursor
INSERT INTO platform_config (key, value) VALUES ('plaid_transfer_sync_cursor', '0')
ON CONFLICT (key) DO NOTHING;

-- RLS for tenant_bank_accounts
ALTER TABLE tenant_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Tenants can manage their own bank accounts
CREATE POLICY tenant_bank_accounts_tenant_select ON tenant_bank_accounts
  FOR SELECT USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_update ON tenant_bank_accounts
  FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_delete ON tenant_bank_accounts
  FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_insert ON tenant_bank_accounts
  FOR INSERT WITH CHECK (tenant_id = auth.uid());

-- Org admins can view tenant bank accounts for their org
CREATE POLICY tenant_bank_accounts_org_admin_select ON tenant_bank_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = tenant_bank_accounts.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('admin', 'landlord', 'property_manager')
        AND org_members.status = 'active'
    )
  );

-- RLS for platform_config (service role only, no user access needed)
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- NOTE: pg_cron setup depends on hosting environment.
-- For Supabase hosted: pg_cron is pre-installed. Run this via SQL editor:
--
-- SELECT cron.schedule(
--   'auto-pay-plaid',
--   '0 6 * * *',
--   $$SELECT net.http_post(
--     url := 'YOUR_APP_URL/api/plaid/auto-pay',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body := '{}'::jsonb
--   )$$
-- );
--
-- For local dev: trigger manually via curl:
-- curl -X POST http://localhost:3000/api/plaid/auto-pay -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"

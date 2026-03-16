-- Online Payments: plan pricing, org Stripe fields, invoice updates, payment_events

-- 1. Plans table: add pricing and Stripe IDs
ALTER TABLE plans ADD COLUMN monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN stripe_product_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_monthly_price_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_yearly_price_id TEXT;

-- 2. Organizations table: add Stripe Connect + subscription fields
ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_status TEXT DEFAULT 'not_connected';
ALTER TABLE organizations ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT DEFAULT 'none';
ALTER TABLE organizations ADD COLUMN subscription_period TEXT;
ALTER TABLE organizations ADD COLUMN subscription_current_period_end TIMESTAMPTZ;

-- Add CHECK constraints
ALTER TABLE organizations ADD CONSTRAINT organizations_stripe_account_status_check
  CHECK (stripe_account_status IN ('not_connected', 'onboarding', 'active', 'restricted'));
ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing'));
ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_period_check
  CHECK (subscription_period IN ('monthly', 'yearly'));

-- 3. Invoices table: add Stripe tracking + update status constraint
ALTER TABLE invoices ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE invoices ADD COLUMN convenience_fee DECIMAL(10,2) DEFAULT 0;

-- Drop and recreate status check to include 'processing'
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'processing', 'partially_paid', 'paid', 'void'));

-- 4. Payment events table (webhook audit log)
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS on payment_events — accessed only via service role in webhook handler

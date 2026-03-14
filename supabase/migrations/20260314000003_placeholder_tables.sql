-- ============================================================
-- Migration 003: Placeholder Tables
-- leases, transactions, maintenance_requests
-- Full schema for valid foreign keys. No UI until later phases.
-- ============================================================

-- leases
CREATE TABLE leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES profiles(id),
  start_date DATE,
  end_date DATE,
  rent_amount DECIMAL(10,2),
  deposit_amount DECIMAL(10,2),
  payment_due_day INTEGER CHECK (payment_due_day BETWEEN 1 AND 28),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  terms JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id UUID REFERENCES leases(id) ON DELETE SET NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  tenant_id UUID REFERENCES profiles(id),
  type TEXT CHECK (type IN ('rent', 'deposit', 'fee', 'invoice', 'refund', 'expense', 'other')),
  amount DECIMAL(10,2),
  payment_method TEXT CHECK (payment_method IN ('stripe', 'cash', 'check', 'zelle', 'bank_transfer', 'other')),
  payment_status TEXT CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  stripe_payment_id TEXT,
  due_date DATE,
  paid_date DATE,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- maintenance_requests
CREATE TABLE maintenance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id),
  reported_by UUID NOT NULL REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_parts', 'completed', 'closed')),
  category TEXT CHECK (category IN ('plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest', 'other')),
  images JSONB DEFAULT '[]',
  estimated_cost DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  scheduled_date DATE,
  completed_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_leases_org_id ON leases(org_id);
CREATE INDEX idx_leases_unit_id ON leases(unit_id);
CREATE INDEX idx_transactions_org_id ON transactions(org_id);
CREATE INDEX idx_transactions_unit_id ON transactions(unit_id);
CREATE INDEX idx_maintenance_org_id ON maintenance_requests(org_id);
CREATE INDEX idx_maintenance_unit_id ON maintenance_requests(unit_id);

-- moddatetime triggers
CREATE TRIGGER leases_updated_at
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER maintenance_requests_updated_at
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- RLS: All placeholder tables use direct org_id
-- ============================================================
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

-- leases
CREATE POLICY "Members can view leases"
  ON leases FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage leases"
  ON leases FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));

-- transactions
CREATE POLICY "Members can view transactions"
  ON transactions FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage transactions"
  ON transactions FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));

-- maintenance_requests
CREATE POLICY "Members can view maintenance requests"
  ON maintenance_requests FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage maintenance requests"
  ON maintenance_requests FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));

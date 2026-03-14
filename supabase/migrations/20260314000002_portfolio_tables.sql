-- ============================================================
-- Migration 002: Portfolio Tables
-- properties, units, property_images
-- RLS policies (units + images use nested subquery through properties)
-- ============================================================

-- properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single_family', 'townhouse', 'apartment_complex', 'condo', 'commercial', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  year_built INTEGER,
  purchase_price DECIMAL(12,2),
  purchase_date DATE,
  market_value DECIMAL(12,2),
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- units
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  type TEXT CHECK (type IN ('studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other')),
  bedrooms INTEGER,
  bathrooms DECIMAL(3,1),
  square_feet INTEGER,
  rent_amount DECIMAL(10,2),
  deposit_amount DECIMAL(10,2),
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'maintenance', 'not_available')),
  floor INTEGER,
  features JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(property_id, unit_number)
);

-- property_images
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  caption TEXT,
  is_primary BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_properties_org_id ON properties(org_id);
CREATE INDEX idx_units_property_id ON units(property_id);
CREATE INDEX idx_property_images_property_id ON property_images(property_id);

-- moddatetime triggers
CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- RLS: properties (has direct org_id)
-- ============================================================
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view properties"
  ON properties FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Managers can insert properties"
  ON properties FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

CREATE POLICY "Managers can update properties"
  ON properties FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

CREATE POLICY "Managers can delete properties"
  ON properties FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

-- ============================================================
-- RLS: units (no org_id — join through properties)
-- ============================================================
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view units"
  ON units FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

CREATE POLICY "Managers can insert units"
  ON units FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can update units"
  ON units FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can delete units"
  ON units FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

-- ============================================================
-- RLS: property_images (no org_id — join through properties)
-- ============================================================
ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view property images"
  ON property_images FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

CREATE POLICY "Managers can insert property images"
  ON property_images FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can update property images"
  ON property_images FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can delete property images"
  ON property_images FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

-- ============================================================
-- Supabase Storage: property-images bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public read for property images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

CREATE POLICY "Authenticated users can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Authenticated users can delete own property images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
  );

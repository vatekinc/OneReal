export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  logo_url: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  default_org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  status: string;
  invited_at: string | null;
  joined_at: string | null;
}

export interface Property {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  year_built: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  market_value: number | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Unit {
  id: string;
  property_id: string;
  unit_number: string;
  type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  rent_amount: number | null;
  deposit_amount: number | null;
  status: string;
  floor: number | null;
  features: string[];
  created_at: string;
  updated_at: string;
}

export interface PropertyImage {
  id: string;
  property_id: string;
  unit_id: string | null;
  url: string;
  caption: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PropertyWithUnits extends Property {
  units: Unit[];
}

export interface PropertyWithDetails extends Property {
  units: Unit[];
  images: PropertyImage[];
}

export interface PortfolioStats {
  total_properties: number;
  total_units: number;
  occupied_units: number;
  occupancy_rate: number;
  total_rent_potential: number;
}

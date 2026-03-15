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

export interface Income {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  amount: number;
  income_type: string;
  description: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  amount: number;
  expense_type: string;
  description: string;
  transaction_date: string;
  receipt_url: string | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialStats {
  total_income: number;
  total_expenses: number;
  net_income: number;
  roi: number;
  income_change: number;
  expense_change: number;
}

export interface MonthlyTrendPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
}

export interface PropertyFinancial {
  property_id: string;
  property_name: string;
  income: number;
  expenses: number;
  net: number;
  roi: number;
}

export interface RecentTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  property_name: string;
  transaction_date: string;
}

export interface Tenant {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ServiceProvider {
  id: string;
  org_id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  category: string;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Lease {
  id: string;
  org_id: string;
  unit_id: string;
  tenant_id: string;
  start_date: string | null;
  end_date: string | null;
  rent_amount: number | null;
  deposit_amount: number | null;
  payment_due_day: number | null;
  status: string;
  terms: Record<string, unknown>;
  renewal_status: string | null;
  renewal_notes: string | null;
  renewed_from_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaseDocument {
  id: string;
  lease_id: string;
  filename: string;
  document_url: string;
  uploaded_at: string;
}

export interface Invoice {
  id: string;
  org_id: string;
  invoice_number: string;
  direction: 'receivable' | 'payable';
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'void';
  lease_id: string | null;
  tenant_id: string | null;
  provider_id: string | null;
  property_id: string;
  unit_id: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  issued_date: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  org_id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'online' | 'other';
  reference_number: string | null;
  notes: string | null;
  income_id: string | null;
  expense_id: string | null;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  logo_url: string | null;
  settings: Record<string, unknown>;
  plan_id: string;
  stripe_customer_id: string | null;
  stripe_account_id: string | null;
  stripe_account_status: 'not_connected' | 'onboarding' | 'active' | 'restricted';
  stripe_subscription_id: string | null;
  subscription_status: 'none' | 'active' | 'past_due' | 'canceled' | 'trialing';
  subscription_period: 'monthly' | 'yearly' | null;
  subscription_current_period_end: string | null;
  plaid_access_token_encrypted: string | null;
  plaid_account_id: string | null;
  plaid_item_id: string | null;
  plaid_institution_name: string | null;
  plaid_account_mask: string | null;
  plaid_status: 'not_connected' | 'active';
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
  recurring_expense_id: string | null;
  generated_for_period: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpense {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  expense_type: string;
  amount: number;
  frequency: 'monthly' | 'yearly';
  description: string;
  provider_id: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined by hook, not stored in table:
  service_providers?: { name: string } | null;
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
  user_id: string | null;
  invited_at: string | null;
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
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'month_to_month';
  terms: Record<string, unknown>;
  renewal_status: string | null;
  renewal_notes: string | null;
  renewed_from_id: string | null;
  late_fee_type: 'flat' | 'percentage' | null;
  late_fee_amount: number | null;
  late_fee_grace_days: number | null;
  auto_month_to_month: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeaseDocument {
  id: string;
  lease_id: string;
  filename: string;
  document_url: string; // stores storage path, not signed URL
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string;
}

export interface LeaseCharge {
  id: string;
  org_id: string;
  lease_id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'one_time';
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  org_id: string;
  invoice_number: string;
  direction: 'receivable' | 'payable';
  status: 'draft' | 'open' | 'processing' | 'partially_paid' | 'paid' | 'void';
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
  lease_charge_id: string | null;
  late_fee_for_invoice_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  convenience_fee: number;
  plaid_transfer_id: string | null;
  payment_processor: 'stripe' | 'plaid' | null;
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

export interface PaymentEvent {
  id: string;
  stripe_event_id: string;
  plaid_event_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface TenantBankAccount {
  id: string;
  tenant_id: string;
  org_id: string;
  plaid_access_token_encrypted: string;
  plaid_account_id: string;
  plaid_item_id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceRequest {
  id: string;
  org_id: string;
  unit_id: string;
  reported_by: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'emergency';
  status: 'open' | 'in_progress' | 'waiting_parts' | 'completed' | 'closed';
  category: 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'structural' | 'pest' | 'other';
  images: unknown[];
  estimated_cost: number | null;
  actual_cost: number | null;
  scheduled_date: string | null;
  completed_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  org_id: string;
  property_id: string | null;
  unit_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface ProfitAndLossReport {
  income_categories: Array<{ category: string; amount: number }>;
  total_income: number;
  expense_categories: Array<{ category: string; amount: number }>;
  total_expenses: number;
  net_income: number;
}

export interface CashFlowPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
  cumulative: number;
}

export interface AgingBucket {
  bucket: string;
  count: number;
  total_amount: number;
  total_outstanding: number;
}

export interface CollectionRatePoint {
  month: string;
  invoiced_amount: number;
  collected_amount: number;
  collection_rate: number;
}

// --- Plan types ---

export interface PlanFeatures {
  online_payments: boolean;
  messaging: boolean;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  max_properties: number; // 0 = unlimited
  features: PlanFeatures;
  is_default: boolean;
  monthly_price: number;
  yearly_price: number;
  stripe_product_id: string | null;
  stripe_monthly_price_id: string | null;
  stripe_yearly_price_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanListItem {
  id: string;
  name: string;
  slug: string;
  max_properties: number;
  features: PlanFeatures;
  is_default: boolean;
  monthly_price: number;
  yearly_price: number;
  org_count: number;
}

// --- Admin types ---

export interface PlatformStats {
  total_organizations: number;
  total_users: number;
  total_properties: number;
  total_units: number;
  recent_signups: Array<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
  }>;
  recent_organizations: Array<{
    id: string;
    name: string;
    type: string;
    created_at: string;
    member_count: number;
  }>;
}

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  created_at: string;
  member_count: number;
  property_count: number;
  plan_name: string;
}

export interface UserListItem {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  banned: boolean;
  created_at: string;
  org_count: number;
  primary_role: string | null;
}

export interface OrgMemberListItem {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  status: string;
  joined_at: string | null;
}

export interface OrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    created_at: string;
    settings: Record<string, unknown>;
    plan: {
      id: string;
      name: string;
      slug: string;
      max_properties: number;
      features: PlanFeatures;
    };
  };
  properties: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    city: string | null;
    state: string | null;
    unit_count: number;
  }>;
  stats: {
    member_count: number;
    property_count: number;
    unit_count: number;
    occupied_units: number;
  };
}

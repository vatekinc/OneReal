export const PropertyType = {
  SINGLE_FAMILY: 'single_family',
  TOWNHOUSE: 'townhouse',
  APARTMENT_COMPLEX: 'apartment_complex',
  CONDO: 'condo',
  COMMERCIAL: 'commercial',
  OTHER: 'other',
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

export const PropertyStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SOLD: 'sold',
} as const;
export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];

export const UnitType = {
  STUDIO: 'studio',
  ONE_BED: '1bed',
  TWO_BED: '2bed',
  THREE_BED: '3bed',
  FOUR_BED: '4bed',
  COMMERCIAL_UNIT: 'commercial_unit',
  RESIDENTIAL: 'residential',
  OTHER: 'other',
} as const;
export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export const UnitStatus = {
  VACANT: 'vacant',
  OCCUPIED: 'occupied',
  MAINTENANCE: 'maintenance',
  NOT_AVAILABLE: 'not_available',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];

export const UserRole = {
  ADMIN: 'admin',
  LANDLORD: 'landlord',
  PROPERTY_MANAGER: 'property_manager',
  TENANT: 'tenant',
  CONTRACTOR: 'contractor',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrgType = {
  PERSONAL: 'personal',
  COMPANY: 'company',
} as const;
export type OrgType = (typeof OrgType)[keyof typeof OrgType];

export const MemberStatus = {
  INVITED: 'invited',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

export const LeaseStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  TERMINATED: 'terminated',
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];

export const TransactionType = {
  RENT: 'rent',
  DEPOSIT: 'deposit',
  FEE: 'fee',
  INVOICE: 'invoice',
  REFUND: 'refund',
  EXPENSE: 'expense',
  OTHER: 'other',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const PaymentMethod = {
  STRIPE: 'stripe',
  CASH: 'cash',
  CHECK: 'check',
  ZELLE: 'zelle',
  BANK_TRANSFER: 'bank_transfer',
  PLAID: 'plaid',
  OTHER: 'other',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const MaintenancePriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  EMERGENCY: 'emergency',
} as const;
export type MaintenancePriority = (typeof MaintenancePriority)[keyof typeof MaintenancePriority];

export const MaintenanceStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_PARTS: 'waiting_parts',
  COMPLETED: 'completed',
  CLOSED: 'closed',
} as const;
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

export const MaintenanceCategory = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  HVAC: 'hvac',
  APPLIANCE: 'appliance',
  STRUCTURAL: 'structural',
  PEST: 'pest',
  OTHER: 'other',
} as const;
export type MaintenanceCategory = (typeof MaintenanceCategory)[keyof typeof MaintenanceCategory];

export const IncomeType = {
  RENT: 'rent',
  DEPOSIT: 'deposit',
  LATE_FEE: 'late_fee',
  OTHER: 'other',
} as const;
export type IncomeType = (typeof IncomeType)[keyof typeof IncomeType];

export const ExpenseType = {
  MORTGAGE: 'mortgage',
  MAINTENANCE: 'maintenance',
  REPAIRS: 'repairs',
  UTILITIES: 'utilities',
  INSURANCE: 'insurance',
  TAXES: 'taxes',
  MANAGEMENT: 'management',
  ADVERTISING: 'advertising',
  LEGAL: 'legal',
  HOA: 'hoa',
  HOME_WARRANTY: 'home_warranty',
  OTHER: 'other',
} as const;
export type ExpenseType = (typeof ExpenseType)[keyof typeof ExpenseType];

export const TenantStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const ProviderCategory = {
  PLUMBER: 'plumber',
  ELECTRICIAN: 'electrician',
  HVAC: 'hvac',
  GENERAL_CONTRACTOR: 'general_contractor',
  CLEANER: 'cleaner',
  LANDSCAPER: 'landscaper',
  PAINTER: 'painter',
  ROOFER: 'roofer',
  PEST_CONTROL: 'pest_control',
  LOCKSMITH: 'locksmith',
  APPLIANCE_REPAIR: 'appliance_repair',
  OTHER: 'other',
} as const;
export type ProviderCategory = (typeof ProviderCategory)[keyof typeof ProviderCategory];

export const RenewalStatus = {
  UPCOMING: 'upcoming',
  RENEWED: 'renewed',
  NOT_RENEWING: 'not_renewing',
} as const;
export type RenewalStatus = (typeof RenewalStatus)[keyof typeof RenewalStatus];

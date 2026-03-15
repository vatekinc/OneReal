# Contacts Module Design Spec

## Overview

The Contacts module introduces two entity types — **Tenants** and **Service Providers** — as standalone contact records managed by the landlord (no auth accounts required). Tenants connect to properties through **Leases**. Service providers connect through **Expenses** via an optional `provider_id` foreign key.

This replaces the placeholder "Tenants (Soon)" sidebar item with a collapsible "Contacts" parent menu containing Tenants and Service Providers as sub-items.

**Future extension:** Contacts can optionally be linked to auth accounts later for tenant portal features (self-service maintenance requests, rent payments, lease viewing).

---

## Architecture

**Module:** `modules/contacts/` (replaces scaffolded `modules/tenants/`)

**Pattern:** Follows established module pattern:
```
modules/contacts/
├── src/
│   ├── actions/       # Server actions (create/update/delete for tenants, providers, leases)
│   ├── hooks/         # React Query hooks (useTenants, useProviders, useLeases)
│   ├── schemas/       # Zod validation schemas
│   └── index.ts       # Barrel exports (schemas + hooks only)
├── package.json
└── tsconfig.json
```

---

## Database Schema

### New Tables

#### `tenants`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| org_id | UUID | FK → organizations, NOT NULL |
| first_name | TEXT | NOT NULL |
| last_name | TEXT | NOT NULL |
| email | TEXT | nullable |
| phone | TEXT | nullable |
| emergency_contact_name | TEXT | nullable |
| emergency_contact_phone | TEXT | nullable |
| notes | TEXT | nullable |
| status | TEXT | NOT NULL, default 'active'. Values: 'active', 'inactive' |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

RLS: Uses `get_user_org_ids()` / `get_user_managed_org_ids()` helper functions (migration 005 pattern). SELECT for members, ALL for managers.

#### `service_providers`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| org_id | UUID | FK → organizations, NOT NULL |
| name | TEXT | NOT NULL |
| company_name | TEXT | nullable |
| email | TEXT | nullable |
| phone | TEXT | nullable |
| category | TEXT | NOT NULL. Values: 'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner', 'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith', 'appliance_repair', 'other' |
| notes | TEXT | nullable |
| status | TEXT | NOT NULL, default 'active'. Values: 'active', 'inactive' |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

RLS: Uses `get_user_org_ids()` / `get_user_managed_org_ids()` helper functions (migration 005 pattern).

#### `lease_documents`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| lease_id | UUID | FK → leases, NOT NULL, ON DELETE CASCADE |
| filename | TEXT | NOT NULL |
| document_url | TEXT | NOT NULL |
| uploaded_at | TIMESTAMPTZ | default now() |

RLS: Join-based through `lease_documents` → `leases` → `org_id`, same pattern as `units` → `properties` → `org_id`. Uses `get_user_org_ids()` / `get_user_managed_org_ids()` helper functions.

### Modified Tables

#### `leases` (existing placeholder — migration changes)
- Drop existing `tenant_id` FK constraint (currently references `profiles(id)`), add new FK: `tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT`. The leases table is a placeholder with no real data, so no data migration is needed — just drop and recreate the constraint.
- Add column: `renewal_status TEXT default null` — Values: null (no action), 'upcoming', 'renewed', 'not_renewing'
- Add column: `renewal_notes TEXT` — nullable
- Add column: `renewed_from_id UUID` — FK → leases(id) ON DELETE SET NULL, nullable. Links to the previous lease this was renewed from.
- Replace existing RLS policies (migration 003 created older-style inline subquery policies) with the helper-function-based pattern from migration 005 (`get_user_org_ids()` / `get_user_managed_org_ids()`).

#### `transactions` (existing placeholder — FK decision)
- `transactions.tenant_id` currently references `profiles(id)`. **Deferred** — the transactions table is a Phase 6 (Stripe) placeholder with no UI or data. When Phase 6 is implemented, this FK will be re-evaluated to reference `tenants(id)`. No changes in this migration.

#### `expenses` (existing — add provider link)
- Add column: `provider_id UUID` — FK → service_providers(id), nullable, ON DELETE SET NULL

### Indexes

- `tenants(org_id)` — filter by org
- `service_providers(org_id, category)` — filter by org and category
- `lease_documents(lease_id)` — lookup documents per lease
- `expenses(provider_id)` — lookup expenses per provider (new FK)
- `leases(tenant_id)` — lookup leases per tenant (changed FK)

### Key Relationships
```
tenants 1──M leases M──1 units M──1 properties
service_providers 1──M expenses M──1 properties
leases 1──M lease_documents
leases ──(self-ref)── leases (renewal chain via renewed_from_id)
```

---

## UI Pages & Routes

### Sidebar Navigation

Replace the disabled "Tenants (Soon)" item with a collapsible "Contacts" parent:

```
👥 Contacts ▾
   ↳ Tenants        → /contacts/tenants
   ↳ Service Providers → /contacts/providers
```

The sidebar component needs to support collapsible sub-menus (new pattern — currently all items are flat). Implement as a reusable pattern in the `navItems` data structure (supporting optional `children` array) since Maintenance may also get sub-items in future phases.

### Pages

#### `/contacts/tenants` — Tenant List
- **Type:** Client component ('use client')
- **Table columns:** Name, Email, Phone, Properties (badges from active leases), Active Leases count, Actions (edit, delete)
- **Filters:** Search (name/email), Property dropdown
- **Actions:** "Add Tenant" button → TenantDialog
- **Empty state:** "No tenants yet" with "Add your first tenant" button

#### `/contacts/tenants/[id]` — Tenant Detail
- **Type:** Client component
- **Layout:**
  - Top: Contact info card (first name, last name, email, phone, emergency contact, notes) with Edit button
  - Below: Leases section — table of all leases (current & past)
    - Columns: Property, Unit, Start Date, End Date, Rent, Status (badge), Renewal Status, Actions
    - "Add Lease" button → LeaseDialog (pre-filled with tenant)
  - Lease documents shown per-lease as expandable row or nested section

#### `/contacts/providers` — Service Provider List
- **Type:** Client component
- **Table columns:** Name, Company, Category (badge), Email, Phone, Jobs (count from expenses), Total Spent (sum from expenses), Actions
- **Filters:** Search (name/company), Category dropdown
- **Actions:** "Add Provider" button → ProviderDialog
- **Empty state:** "No service providers yet" with "Add your first provider" button

#### `/contacts/providers/[id]` — Provider Detail
- **Type:** Client component
- **Layout:**
  - Top: Contact info card (name, company, email, phone, category, notes) with Edit button
  - Below: Work History section — auto-populated from expenses where provider_id matches
    - Columns: Date, Property, Expense Type (badge), Description, Amount
    - Read-only view (edits happen through Expenses pages)
    - Date range filter (reuse DateRangeFilterClient)

### Modified Existing Pages

#### `/properties/[id]` — Property Detail Enhancement
- Add "Tenants & Leases" section showing:
  - Active leases for this property (tenant name linked to tenant detail, unit, lease dates, rent)
  - Quick "Add Lease" button

#### Expense Dialog Enhancement
- Add optional "Service Provider" select dropdown to expense create/edit dialog
- Shows providers from the org, filtered to show relevant categories

### Dialogs

#### TenantDialog
- Fields: first_name*, last_name*, email, phone, emergency_contact_name, emergency_contact_phone, notes
- Mode: Create / Edit

#### ProviderDialog
- Fields: name*, company_name, email, phone, category*, notes
- Mode: Create / Edit

#### LeaseDialog
- Fields: property_id* (select), unit_id* (select, filtered by property), tenant_id* (select or pre-filled), start_date*, end_date*, rent_amount*, deposit_amount, payment_due_day (1-28), status (default 'draft')
- Mode: Create / Edit
- When editing: can update status (draft → active → terminated/expired)

---

## Module Code Structure

### Schemas (Zod)

#### `tenant-schema.ts`
```typescript
z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().default(''),
  emergency_contact_name: z.string().optional().default(''),
  emergency_contact_phone: z.string().optional().default(''),
  notes: z.string().optional().default(''),
})
```

#### `provider-schema.ts`
```typescript
z.object({
  name: z.string().min(1, 'Name is required'),
  company_name: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().default(''),
  category: z.enum(['plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner', 'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith', 'appliance_repair', 'other']),
  notes: z.string().optional().default(''),
})
```

#### `lease-schema.ts`
```typescript
z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid('Select a unit'),
  tenant_id: z.string().uuid('Select a tenant'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  rent_amount: z.coerce.number().positive('Rent must be positive'),
  deposit_amount: z.coerce.number().min(0).optional().default(0),
  payment_due_day: z.coerce.number().min(1).max(28).optional().default(1),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
}).refine((data) => data.end_date > data.start_date, {
  message: 'End date must be after start date',
  path: ['end_date'],
})
```

### Hooks

- `useTenants(filters: { orgId, search?, propertyId? })` — list tenants with optional filters
- `useTenant(id)` — single tenant with leases
- `useProviders(filters: { orgId, search?, category? })` — list providers
- `useProvider(id)` — single provider with work history (expenses)
- `useLeases(filters: { orgId, tenantId?, propertyId?, unitId?, status? })` — list leases

### Server Actions

- `createTenant(formData)` / `updateTenant(id, formData)` / `deleteTenant(id)`
- `createProvider(formData)` / `updateProvider(id, formData)` / `deleteProvider(id)`
- `createLease(formData)` / `updateLease(id, formData)` / `deleteLease(id)`

---

## Types

Add to `packages/types/src/models.ts`:

```typescript
interface Tenant {
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

interface ServiceProvider {
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

interface Lease {
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

interface LeaseDocument {
  id: string;
  lease_id: string;
  filename: string;
  document_url: string;
  uploaded_at: string;
}
```

Add to `packages/types/src/enums.ts` (using the established `as const` + type extraction pattern):

```typescript
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
```

---

## Edge Cases & Error Handling

- **Deleting a tenant with active leases:** Block deletion. Show error: "Tenant has active leases. Terminate or expire leases first."
- **Deleting a provider linked to expenses:** Allow deletion. `ON DELETE SET NULL` keeps expense records intact. Provider shows as "Deleted Provider" in expense history.
- **Duplicate tenants:** No hard uniqueness constraint. Search helps avoid accidental duplicates.
- **Lease overlap:** Warn (not block) if creating a lease for a unit that already has an active lease in the same date range.
- **Unit occupancy sync:** Implemented as a side-effect in the `updateLease` and `createLease` server actions (not a database trigger). When lease status changes to 'active', the server action also updates the unit's status to 'occupied'. When a lease is terminated/expired, the action checks if any other active leases exist on that unit — if none, sets unit status to 'vacant'.

---

## Out of Scope (Future)

- Tenant portal / auth-linked accounts
- File upload integration (S3/Supabase Storage) — schema stores URLs, upload mechanism TBD
- Lease renewal automation / reminders
- Tenant communication (email/SMS)
- Payment tracking through leases (Phase 6 — Stripe)

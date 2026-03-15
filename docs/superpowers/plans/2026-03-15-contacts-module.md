# Contacts Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Contacts module with Tenants, Service Providers, and Leases — including collapsible sidebar navigation, CRUD for all entities, and integration with existing Expenses and Properties.

**Architecture:** New `modules/contacts/` module following established patterns (actions/hooks/schemas). New Supabase migration for `tenants`, `service_providers`, `lease_documents` tables plus modifications to `leases` and `expenses`. Collapsible sidebar sub-menu as a reusable pattern.

**Tech Stack:** Next.js 15, Supabase PostgreSQL (RLS), TanStack Query, Zod, shadcn/ui, React Hook Form

**Spec:** `docs/superpowers/specs/2026-03-15-contacts-module-design.md`

---

## Chunk 1: Foundation — Database, Types, Module Setup

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260315000007_contacts_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ============================================================
-- Migration 007: Contacts Module (tenants, service_providers, lease_documents)
--
-- Phase 3: Contacts & Leases
-- Depends on: organizations, properties, units, leases (Phase 1)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)
-- ============================================================

-- -----------------------------------------------------------
-- tenants table
-- -----------------------------------------------------------
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- service_providers table
-- -----------------------------------------------------------
CREATE TABLE public.service_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner',
    'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith',
    'appliance_repair', 'other'
  )),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- lease_documents table
-- -----------------------------------------------------------
CREATE TABLE public.lease_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  document_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Modify leases table: change tenant_id FK, add renewal columns
-- -----------------------------------------------------------
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_tenant_id_fkey;
ALTER TABLE public.leases
  ADD CONSTRAINT leases_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewal_status TEXT DEFAULT NULL
  CHECK (renewal_status IS NULL OR renewal_status IN ('upcoming', 'renewed', 'not_renewing'));
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewal_notes TEXT;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS renewed_from_id UUID REFERENCES public.leases(id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- Modify expenses table: add provider_id FK
-- -----------------------------------------------------------
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS provider_id UUID
  REFERENCES public.service_providers(id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------
CREATE INDEX idx_tenants_org ON public.tenants(org_id);
CREATE INDEX idx_service_providers_org_category ON public.service_providers(org_id, category);
CREATE INDEX idx_lease_documents_lease ON public.lease_documents(lease_id);
CREATE INDEX idx_expenses_provider ON public.expenses(provider_id);
CREATE INDEX idx_leases_tenant ON public.leases(tenant_id);

-- -----------------------------------------------------------
-- RLS Policies — tenants
-- -----------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenants in their orgs"
  ON public.tenants FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert tenants"
  ON public.tenants FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update tenants"
  ON public.tenants FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete tenants"
  ON public.tenants FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — service_providers
-- -----------------------------------------------------------
ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view providers in their orgs"
  ON public.service_providers FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert providers"
  ON public.service_providers FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update providers"
  ON public.service_providers FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete providers"
  ON public.service_providers FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — lease_documents (join through leases)
-- -----------------------------------------------------------
ALTER TABLE public.lease_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease documents"
  ON public.lease_documents FOR SELECT
  USING (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_org_ids())
  ));

CREATE POLICY "Managers can insert lease documents"
  ON public.lease_documents FOR INSERT
  WITH CHECK (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())
  ));

CREATE POLICY "Managers can delete lease documents"
  ON public.lease_documents FOR DELETE
  USING (lease_id IN (
    SELECT id FROM public.leases WHERE org_id IN (SELECT public.get_user_managed_org_ids())
  ));

-- -----------------------------------------------------------
-- Replace leases RLS policies with helper-function pattern
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "Members can view leases" ON public.leases;
DROP POLICY IF EXISTS "Managers can manage leases" ON public.leases;

CREATE POLICY "Users can view leases in their orgs"
  ON public.leases FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert leases"
  ON public.leases FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update leases"
  ON public.leases FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete leases"
  ON public.leases FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- Updated-at triggers
-- -----------------------------------------------------------
CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER set_service_providers_updated_at
  BEFORE UPDATE ON public.service_providers
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260315000007_contacts_tables.sql
git commit -m "feat(db): add contacts migration (tenants, service_providers, lease_documents)"
```

### Task 2: TypeScript Types

**Files:**
- Modify: `packages/types/src/models.ts`
- Modify: `packages/types/src/enums.ts`

- [ ] **Step 1: Add type interfaces to models.ts**

Append after the existing `RecentTransaction` interface:

```typescript
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
```

- [ ] **Step 2: Add enums to enums.ts**

Append after the existing `ExpenseType`:

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

- [ ] **Step 3: Update Expense interface** to add `provider_id`

In `models.ts`, add to the `Expense` interface after `receipt_url`:

```typescript
  provider_id: string | null;
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/models.ts packages/types/src/enums.ts
git commit -m "feat(types): add Tenant, ServiceProvider, Lease, LeaseDocument types and enums"
```

### Task 3: Module Scaffolding

**Files:**
- Create: `modules/contacts/package.json`
- Create: `modules/contacts/tsconfig.json`
- Create: `modules/contacts/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@onereal/contacts",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./actions/*": "./src/actions/*.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@onereal/database": "workspace:*",
    "@onereal/types": "workspace:*",
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "next": "^15.0.0",
    "@tanstack/react-query": "^5.60.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "next": "^15.0.0",
    "@tanstack/react-query": "^5.60.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create empty barrel index.ts** (will be populated as schemas/hooks are added)

```typescript
// Schemas
export { tenantSchema, type TenantFormValues } from './schemas/tenant-schema';
export { providerSchema, type ProviderFormValues } from './schemas/provider-schema';
export { leaseSchema, type LeaseFormValues } from './schemas/lease-schema';

// Hooks
export { useTenants } from './hooks/use-tenants';
export { useTenant } from './hooks/use-tenant';
export { useProviders } from './hooks/use-providers';
export { useProvider } from './hooks/use-provider';
export { useLeases } from './hooks/use-leases';
```

- [ ] **Step 4: Add workspace dependency** to `apps/web/package.json`

Add `"@onereal/contacts": "workspace:*"` to the dependencies section.

- [ ] **Step 5: Run `pnpm install`** to link the new workspace

```bash
pnpm install
```

- [ ] **Step 6: Commit**

```bash
git add modules/contacts/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(contacts): scaffold contacts module with package.json, tsconfig, index"
```

---

## Chunk 2: Tenant CRUD

### Task 4: Tenant Schema

**Files:**
- Create: `modules/contacts/src/schemas/tenant-schema.ts`

- [ ] **Step 1: Create the schema**

```typescript
import { z } from 'zod';

export const tenantSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional().default(''),
  emergency_contact_name: z.string().optional().default(''),
  emergency_contact_phone: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});

export type TenantFormValues = z.infer<typeof tenantSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/schemas/tenant-schema.ts
git commit -m "feat(contacts): add tenant Zod schema"
```

### Task 5: Tenant Server Actions

**Files:**
- Create: `modules/contacts/src/actions/create-tenant.ts`
- Create: `modules/contacts/src/actions/update-tenant.ts`
- Create: `modules/contacts/src/actions/delete-tenant.ts`

- [ ] **Step 1: Create create-tenant.ts**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { tenantSchema, type TenantFormValues } from '../schemas/tenant-schema';

export async function createTenant(
  orgId: string,
  values: TenantFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = tenantSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const { data, error } = await db
      .from('tenants')
      .insert({ ...parsed.data, org_id: orgId })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create tenant' };
  }
}
```

- [ ] **Step 2: Create update-tenant.ts**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { tenantSchema, type TenantFormValues } from '../schemas/tenant-schema';

export async function updateTenant(
  id: string,
  values: TenantFormValues
): Promise<ActionResult> {
  try {
    const parsed = tenantSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const { error } = await db
      .from('tenants')
      .update(parsed.data)
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update tenant' };
  }
}
```

- [ ] **Step 3: Create delete-tenant.ts**

Check for active leases before deleting:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteTenant(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check for active leases
    const { data: activeLeases } = await db
      .from('leases')
      .select('id')
      .eq('tenant_id', id)
      .eq('status', 'active')
      .limit(1);

    if (activeLeases && activeLeases.length > 0) {
      return { success: false, error: 'Tenant has active leases. Terminate or expire leases first.' };
    }

    const { error } = await db.from('tenants').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete tenant' };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add modules/contacts/src/actions/create-tenant.ts modules/contacts/src/actions/update-tenant.ts modules/contacts/src/actions/delete-tenant.ts
git commit -m "feat(contacts): add tenant server actions (create, update, delete)"
```

### Task 6: Tenant Hooks

**Files:**
- Create: `modules/contacts/src/hooks/use-tenants.ts`
- Create: `modules/contacts/src/hooks/use-tenant.ts`

- [ ] **Step 1: Create use-tenants.ts** (list hook with filters)

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface TenantFilters {
  orgId: string | null;
  search?: string;
  propertyId?: string;
}

export function useTenants(filters: TenantFilters) {
  return useQuery({
    queryKey: ['tenants', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('tenants')
        .select('*, leases(id, status, units(unit_number, property_id), properties:units(property_id, properties(id, name)))')
        .eq('org_id', filters.orgId)
        .order('last_name', { ascending: true });

      if (filters.search) {
        query = query.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}
```

- [ ] **Step 2: Create use-tenant.ts** (single tenant with leases)

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenant(id: string | null) {
  return useQuery({
    queryKey: ['tenant', id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/contacts/src/hooks/use-tenants.ts modules/contacts/src/hooks/use-tenant.ts
git commit -m "feat(contacts): add useTenants and useTenant hooks"
```

### Task 7: TenantDialog Component

**Files:**
- Create: `apps/web/components/contacts/tenant-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Follow the IncomeDialog pattern exactly. Fields: first_name*, last_name*, email, phone, emergency_contact_name, emergency_contact_phone, notes. Use `tenantSchema` from `@onereal/contacts`, `createTenant`/`updateTenant` from deep imports. Invalidate `queryKey: ['tenants']` and `queryKey: ['tenant']` on success.

Form layout: 2-column grid for first_name/last_name, then email/phone, then emergency_contact_name/emergency_contact_phone, then full-width notes textarea.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/contacts/tenant-dialog.tsx
git commit -m "feat(contacts): add TenantDialog component"
```

### Task 8: Tenants List Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/tenants/page.tsx`

- [ ] **Step 1: Create the tenants list page**

Follow the Income list page pattern. Client component with:
- `useTenants` hook with search and property filters
- Table: Name (first + last), Email, Phone, Active Leases (count), Actions (edit, delete)
- TenantDialog for add/edit
- Delete with confirmation (calls `deleteTenant`)
- Empty state: "No tenants yet" with "Add your first tenant" button

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/contacts/tenants/page.tsx
git commit -m "feat(contacts): add tenants list page"
```

### Task 9: Tenant Detail Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx`

- [ ] **Step 1: Create the tenant detail page**

Client component with:
- `useTenant(id)` for contact info
- `useLeases({ orgId, tenantId: id })` for lease list
- Top section: Card with contact info (name, email, phone, emergency contact, notes) + Edit button
- Below: Leases table with Property, Unit, Start Date, End Date, Rent, Status badge, Actions
- "Add Lease" button → LeaseDialog (pre-filled with tenant_id)

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx
git commit -m "feat(contacts): add tenant detail page with lease list"
```

---

## Chunk 3: Service Provider CRUD

### Task 10: Provider Schema

**Files:**
- Create: `modules/contacts/src/schemas/provider-schema.ts`

- [ ] **Step 1: Create the schema**

```typescript
import { z } from 'zod';

export const providerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company_name: z.string().optional().default(''),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional().default(''),
  category: z.enum([
    'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner',
    'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith',
    'appliance_repair', 'other',
  ]),
  notes: z.string().optional().default(''),
});

export type ProviderFormValues = z.infer<typeof providerSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/schemas/provider-schema.ts
git commit -m "feat(contacts): add provider Zod schema"
```

### Task 11: Provider Server Actions

**Files:**
- Create: `modules/contacts/src/actions/create-provider.ts`
- Create: `modules/contacts/src/actions/update-provider.ts`
- Create: `modules/contacts/src/actions/delete-provider.ts`

- [ ] **Step 1: Create all three actions**

Same pattern as tenant actions. `deleteProvider` does NOT check for linked expenses (ON DELETE SET NULL handles it).

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/actions/create-provider.ts modules/contacts/src/actions/update-provider.ts modules/contacts/src/actions/delete-provider.ts
git commit -m "feat(contacts): add provider server actions (create, update, delete)"
```

### Task 12: Provider Hooks

**Files:**
- Create: `modules/contacts/src/hooks/use-providers.ts`
- Create: `modules/contacts/src/hooks/use-provider.ts`

- [ ] **Step 1: Create use-providers.ts**

List hook with filters: `orgId`, `search?` (name/company_name), `category?`. Select `*` from `service_providers`. Order by `name` ascending.

- [ ] **Step 2: Create use-provider.ts**

Single provider lookup by id. Select `*` from `service_providers`.

- [ ] **Step 3: Commit**

```bash
git add modules/contacts/src/hooks/use-providers.ts modules/contacts/src/hooks/use-provider.ts
git commit -m "feat(contacts): add useProviders and useProvider hooks"
```

### Task 13: ProviderDialog Component

**Files:**
- Create: `apps/web/components/contacts/provider-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Same pattern as TenantDialog. Fields: name*, company_name, email, phone, category* (select with labels from `providerCategoryLabels` map), notes textarea.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/contacts/provider-dialog.tsx
git commit -m "feat(contacts): add ProviderDialog component"
```

### Task 14: Providers List Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/providers/page.tsx`

- [ ] **Step 1: Create the providers list page**

Client component. Table: Name, Company, Category (badge), Email, Phone, Actions. Filters: search, category dropdown. ProviderDialog for add/edit. Delete with confirmation.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/contacts/providers/page.tsx
git commit -m "feat(contacts): add providers list page"
```

### Task 15: Provider Detail Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/providers/[id]/page.tsx`

- [ ] **Step 1: Create the provider detail page**

Client component:
- `useProvider(id)` for contact info card
- `useExpenses({ orgId, providerId: id })` for work history (NOTE: need to add `providerId` filter to `useExpenses` hook — see Task 20)
- Top: Contact info card with Edit button
- Below: Work History table (Date, Property, Expense Type badge, Description, Amount) — read-only
- DateRangeFilterClient for date filtering

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/contacts/providers/[id]/page.tsx
git commit -m "feat(contacts): add provider detail page with work history"
```

---

## Chunk 4: Lease CRUD

### Task 16: Lease Schema

**Files:**
- Create: `modules/contacts/src/schemas/lease-schema.ts`

- [ ] **Step 1: Create the schema**

```typescript
import { z } from 'zod';

export const leaseSchema = z.object({
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
});

export type LeaseFormValues = z.infer<typeof leaseSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/schemas/lease-schema.ts
git commit -m "feat(contacts): add lease Zod schema with date validation"
```

### Task 17: Lease Server Actions

**Files:**
- Create: `modules/contacts/src/actions/create-lease.ts`
- Create: `modules/contacts/src/actions/update-lease.ts`
- Create: `modules/contacts/src/actions/delete-lease.ts`

- [ ] **Step 1: Create create-lease.ts**

Same pattern as createTenant. Insert into `leases` table. After insert, if `status === 'active'`, update the unit's status to `'occupied'`.

- [ ] **Step 2: Create update-lease.ts**

Same pattern. After update, implement occupancy sync:
- If new status is `'active'` → set unit status to `'occupied'`
- If new status is `'terminated'` or `'expired'` → check if any other active leases exist on the same unit. If none, set unit status to `'vacant'`.

- [ ] **Step 3: Create delete-lease.ts**

Delete the lease. After delete, check if any other active leases exist on the same unit. If none, set unit status to `'vacant'`.

- [ ] **Step 4: Commit**

```bash
git add modules/contacts/src/actions/create-lease.ts modules/contacts/src/actions/update-lease.ts modules/contacts/src/actions/delete-lease.ts
git commit -m "feat(contacts): add lease server actions with unit occupancy sync"
```

### Task 18: Lease Hook

**Files:**
- Create: `modules/contacts/src/hooks/use-leases.ts`

- [ ] **Step 1: Create use-leases.ts**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface LeaseFilters {
  orgId: string | null;
  tenantId?: string;
  propertyId?: string;
  unitId?: string;
  status?: string;
}

export function useLeases(filters: LeaseFilters) {
  return useQuery({
    queryKey: ['leases', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('leases')
        .select('*, tenants(first_name, last_name), units(unit_number, property_id, properties(name))')
        .eq('org_id', filters.orgId)
        .order('start_date', { ascending: false });

      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.propertyId) query = query.eq('units.property_id', filters.propertyId);
      if (filters.unitId) query = query.eq('unit_id', filters.unitId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/hooks/use-leases.ts
git commit -m "feat(contacts): add useLeases hook"
```

### Task 19: LeaseDialog Component

**Files:**
- Create: `apps/web/components/contacts/lease-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Fields:
- property_id* (Select from `useProperties`)
- unit_id* (Select filtered by selected property's units)
- tenant_id* (Select from `useTenants`, OR pre-filled if opened from tenant detail page)
- start_date* (date input)
- end_date* (date input)
- rent_amount* (number input)
- deposit_amount (number input)
- payment_due_day (number input, 1-28)
- status (Select: draft/active/expired/terminated, default 'draft')

Uses `leaseSchema`, `createLease`/`updateLease` from deep imports. Invalidates `['leases']`, `['tenant']`, and `['tenants']` query keys.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/contacts/lease-dialog.tsx
git commit -m "feat(contacts): add LeaseDialog component"
```

---

## Chunk 5: Integration & Navigation

### Task 20: Sidebar Collapsible Sub-menu

**Files:**
- Modify: `apps/web/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Update navItems data structure**

Change `navItems` to support optional `children` array:

```typescript
interface NavItem {
  label: string;
  href: string;
  icon: any;
  disabled?: boolean;
  badge?: string;
  children?: { label: string; href: string }[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Properties', href: '/properties', icon: Building2 },
  { label: 'Accounting', href: '/accounting', icon: Calculator },
  {
    label: 'Contacts', href: '/contacts', icon: Users,
    children: [
      { label: 'Tenants', href: '/contacts/tenants' },
      { label: 'Service Providers', href: '/contacts/providers' },
    ],
  },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, disabled: true, badge: 'Soon' },
];
```

- [ ] **Step 2: Update NavLink component**

Add collapsible behavior: if item has children, clicking toggles an `expanded` state. Show children as indented sub-links when expanded. Auto-expand when pathname starts with the parent href.

- [ ] **Step 3: Handle collapsed sidebar**

When sidebar is collapsed, show parent icon only. On hover tooltip shows "Contacts". Children are not shown in collapsed mode — clicking the parent navigates to `/contacts/tenants` (first child).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/dashboard/sidebar.tsx
git commit -m "feat(sidebar): add collapsible sub-menu support for Contacts"
```

### Task 21: Expense Integration (Provider Select + Hook Update)

**Files:**
- Modify: `modules/accounting/src/schemas/expense-schema.ts`
- Modify: `modules/accounting/src/hooks/use-expenses.ts`
- Modify: `apps/web/components/accounting/expense-dialog.tsx`

- [ ] **Step 1: Add provider_id to expense schema**

In `expense-schema.ts`, add to the z.object:

```typescript
provider_id: z.string().uuid().optional().nullable(),
```

- [ ] **Step 2: Add providerId filter to useExpenses hook**

In `use-expenses.ts`, add `providerId?: string` to `ExpenseFilters`. Add filter:

```typescript
if (filters.providerId) {
  query = query.eq('provider_id', filters.providerId);
}
```

Also update the select to include provider info:

```typescript
.select('*, properties(name), units(unit_number), service_providers(name, company_name)')
```

- [ ] **Step 3: Add provider select to expense dialog**

In `expense-dialog.tsx`:
- Import `useProviders` from `@onereal/contacts`
- Add a "Service Provider" optional Select field after the Type field
- Shows providers from org, with "None" option
- Default value is `provider_id` from existing expense if editing

- [ ] **Step 4: Commit**

```bash
git add modules/accounting/src/schemas/expense-schema.ts modules/accounting/src/hooks/use-expenses.ts apps/web/components/accounting/expense-dialog.tsx
git commit -m "feat(expenses): add optional service provider selection to expense dialog"
```

### Task 22: Property Detail Enhancement

**Files:**
- Modify: `apps/web/components/properties/property-detail-tabs.tsx`

- [ ] **Step 1: Add "Leases" tab**

Replace the placeholder "Activity" tab content with a real "Leases" tab:
- Import `useLeases` from `@onereal/contacts`
- Show active leases for this property: Tenant Name (linked to `/contacts/tenants/[id]`), Unit, Start Date, End Date, Rent, Status badge
- "Add Lease" button → LeaseDialog (pre-filled with property_id)
- Import `LeaseDialog` from `@/components/contacts/lease-dialog`

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/properties/property-detail-tabs.tsx
git commit -m "feat(properties): add leases tab to property detail page"
```

---

## Chunk 6: Final Verification

### Task 23: Build Verification

- [ ] **Step 1: Run build**

```bash
pnpm --filter @onereal/web build
```

- [ ] **Step 2: Fix any TypeScript errors**

- [ ] **Step 3: Commit fixes if any**

### Task 24: Contacts Redirect Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/page.tsx`

- [ ] **Step 1: Create redirect page**

When user navigates to `/contacts`, redirect to `/contacts/tenants`:

```typescript
import { redirect } from 'next/navigation';

export default function ContactsPage() {
  redirect('/contacts/tenants');
}
```

- [ ] **Step 2: Remove old tenants placeholder**

Delete or replace `apps/web/app/(dashboard)/tenants/page.tsx` with a redirect to `/contacts/tenants`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/contacts/page.tsx
git commit -m "feat(contacts): add contacts redirect and remove old tenants placeholder"
```

### Task 25: Playwright E2E Tests

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`

- [ ] **Step 1: Add contacts navigation tests**

```typescript
test.describe('22. Contacts Sidebar Navigation', () => {
  test('contacts menu expands to show tenants and providers', ...);
  test('tenants page loads', ...);
  test('providers page loads', ...);
});
```

- [ ] **Step 2: Add tenant CRUD tests**

```typescript
test.describe('23. Tenant CRUD', () => {
  test('add tenant button opens dialog', ...);
  test('tenant list shows columns', ...);
});
```

- [ ] **Step 3: Add provider CRUD tests**

```typescript
test.describe('24. Provider CRUD', () => {
  test('add provider button opens dialog', ...);
  test('provider list shows columns', ...);
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts
git commit -m "test: add Playwright E2E tests for contacts module"
```

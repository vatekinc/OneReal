# Plans & Subscription Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed plans with property limits and feature gating (messaging, online payments) to the OneReal platform.

**Architecture:** New `plans` table with `plan_id` FK on `organizations`. Admin CRUD via service-role server actions. Property limit enforcement in `createProperty`. Feature gating at page/action level (not middleware). Landlord sees read-only plan info on settings page.

**Tech Stack:** Supabase (PostgreSQL + PostgREST), Next.js 15 App Router, TypeScript, `@onereal/ui` components, `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-03-15-plans-subscription-design.md`

---

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260315000024_plans_table.sql` | Plans table, plan_id on orgs, seed data, RLS, trigger |
| `packages/database/src/queries/plans.ts` | `getOrgPlan()`, `checkFeature()` query helpers |
| `modules/admin/src/actions/list-plans.ts` | List all plans with org counts |
| `modules/admin/src/actions/create-plan.ts` | Create new plan |
| `modules/admin/src/actions/update-plan.ts` | Update existing plan |
| `modules/admin/src/actions/delete-plan.ts` | Delete plan (guarded) |
| `modules/admin/src/actions/update-org-plan.ts` | Change org's plan (with downgrade validation) |
| `apps/web/app/(admin)/admin/plans/page.tsx` | Plans management page |

### Modified Files

| File | Change |
|------|--------|
| `packages/database/src/types.ts` | Add `plans` table type, add `plan_id` to organizations, add FK relationships |
| `packages/database/src/index.ts` | Export `plans` queries |
| `packages/types/src/models.ts` | Add `Plan`, `PlanFeatures`, `PlanListItem`; update `Organization`, `OrganizationListItem`, `OrgDetail` |
| `packages/database/src/queries/organizations.ts` | Update `createCompanyOrg` to assign default plan |
| `modules/admin/src/actions/list-organizations.ts` | Include plan name in org list |
| `modules/admin/src/actions/get-org-details.ts` | Include plan info in org details |
| `modules/portfolio/src/actions/create-property.ts` | Add property limit check before insert |
| `apps/web/components/admin/admin-sidebar.tsx` | Add Plans nav item |
| `apps/web/app/(admin)/admin/organizations/page.tsx` | Add Plan column |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Add plan card with change dropdown |
| `apps/web/app/(dashboard)/messages/page.tsx` | Add upgrade banner when messaging is gated |
| `apps/web/app/(dashboard)/tenant/messages/page.tsx` | Add upgrade banner for tenant messaging |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add "Current Plan" card |

---

## Chunk 1: Foundation (Database + Types)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260315000024_plans_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Plans table
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  max_properties INT NOT NULL DEFAULT 10,
  features JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one plan can be the default
CREATE UNIQUE INDEX plans_single_default ON plans (is_default) WHERE is_default = true;

-- Auto-update updated_at
CREATE TRIGGER handle_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Seed Free and Paid plans
INSERT INTO plans (name, slug, max_properties, features, is_default) VALUES
  ('Free', 'free', 10, '{"online_payments": false, "messaging": false}', true),
  ('Paid', 'paid', 0, '{"online_payments": true, "messaging": true}', false);

-- Add plan_id to organizations (nullable first for backfill)
ALTER TABLE organizations ADD COLUMN plan_id UUID REFERENCES plans(id);

-- Backfill existing organizations to Free plan
UPDATE organizations SET plan_id = (SELECT id FROM plans WHERE slug = 'free');

-- Now make it NOT NULL
ALTER TABLE organizations ALTER COLUMN plan_id SET NOT NULL;

-- RLS for plans table
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plans"
  ON plans FOR SELECT
  TO authenticated
  USING (true);
```

- [ ] **Step 2: Apply the migration to Supabase**

Run: `npx supabase db push` (or apply via Supabase dashboard SQL editor)

Expected: Migration succeeds, `plans` table created, all existing orgs have `plan_id` set to the Free plan.

- [ ] **Step 3: Verify migration**

Run in Supabase SQL editor:
```sql
SELECT o.name, p.name as plan_name FROM organizations o JOIN plans p ON o.plan_id = p.id;
```
Expected: All organizations show "Free" as their plan.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260315000024_plans_table.sql
git commit -m "feat: add plans table with seed data and plan_id on organizations"
```

---

### Task 2: Database Types

**Files:**
- Modify: `packages/database/src/types.ts`

- [ ] **Step 1: Add `plans` table type and update `organizations`**

Add the `plans` table definition after the `maintenance_requests` table (before the closing `};` of `Tables`):

```typescript
      plans: {
        Row: {
          id: string;
          name: string;
          slug: string;
          max_properties: number;
          features: Json;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          max_properties?: number;
          features?: Json;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          max_properties?: number;
          features?: Json;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 2: Add `plan_id` to the `organizations` Row, Insert, and Update types**

In the `organizations` table type:
- **Row**: add `plan_id: string;`
- **Insert**: add `plan_id: string;`
- **Update**: add `plan_id?: string;`

- [ ] **Step 3: Add FK relationship to organizations**

Replace `Relationships: [];` on the organizations table with:

```typescript
        Relationships: [
          {
            foreignKeyName: 'organizations_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/types.ts
git commit -m "feat: add plans table type and plan_id to organizations type"
```

---

### Task 3: TypeScript Model Types

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add Plan types**

Add after the `CollectionRatePoint` interface (before the `// --- Admin types ---` comment):

```typescript
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
  org_count: number;
}
```

- [ ] **Step 2: Update `Organization` interface**

Add `plan_id: string;` after the `type: string;` line in the `Organization` interface.

- [ ] **Step 3: Update `OrganizationListItem` interface**

Add `plan_name: string;` after the `type: string;` line.

- [ ] **Step 4: Update `OrgDetail` interface**

Add a `plan` field to the `organization` object inside `OrgDetail`:

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat: add Plan, PlanFeatures, PlanListItem types; update Organization types with plan_id"
```

---

### Task 4: Plan Query Helpers

**Files:**
- Create: `packages/database/src/queries/plans.ts`
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: Create the plans query module**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getOrgPlan(client: Client, orgId: string) {
  const { data, error } = await (client as any)
    .from('organizations')
    .select('plan_id, plans(id, name, slug, max_properties, features, is_default, created_at, updated_at)')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return (data as any)?.plans ?? null;
}

export async function checkFeature(
  client: Client,
  orgId: string,
  feature: string
): Promise<{ allowed: boolean; plan_name: string }> {
  const plan = await getOrgPlan(client, orgId);
  if (!plan) return { allowed: false, plan_name: 'Unknown' };
  const features = (plan.features ?? {}) as Record<string, boolean>;
  return {
    allowed: features[feature] ?? false,
    plan_name: plan.name,
  };
}
```

- [ ] **Step 2: Export from barrel file**

In `packages/database/src/index.ts`, add after the existing exports:

```typescript
export * from './queries/plans';
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/queries/plans.ts packages/database/src/index.ts
git commit -m "feat: add getOrgPlan and checkFeature query helpers"
```

---

### Task 5: Update `createCompanyOrg` to Assign Default Plan

**Files:**
- Modify: `packages/database/src/queries/organizations.ts`

- [ ] **Step 1: Add default plan lookup to `createCompanyOrg`**

In the `createCompanyOrg` function, before the org insert, add a query to fetch the default plan:

```typescript
  // Fetch default plan
  const { data: defaultPlan } = await (client as any)
    .from('plans')
    .select('id')
    .eq('is_default', true)
    .single();

  if (!defaultPlan) throw new Error('No default plan configured');
```

Then update the org insert to include `plan_id`:

Change:
```typescript
  .insert({ name, slug, type: 'company' })
```
To:
```typescript
  .insert({ name, slug, type: 'company', plan_id: defaultPlan.id })
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/queries/organizations.ts
git commit -m "feat: assign default plan when creating company org"
```

---

### Task 6: Update SQL Trigger for Personal Org Creation

**Files:**
- Create: `supabase/migrations/20260315000025_update_handle_new_profile_plan.sql`

- [ ] **Step 1: Create migration to update the trigger function**

```sql
-- Update handle_new_profile to assign default plan to personal orgs
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_org_id UUID;
  slug_base TEXT;
  final_slug TEXT;
  default_plan_id UUID;
BEGIN
  -- Get default plan
  SELECT id INTO default_plan_id FROM public.plans WHERE is_default = true LIMIT 1;

  -- Generate slug from email (part before @)
  slug_base := lower(split_part(COALESCE(NEW.email, NEW.id::text), '@', 1));
  slug_base := regexp_replace(slug_base, '[^a-z0-9]', '-', 'g');
  slug_base := regexp_replace(slug_base, '-+', '-', 'g');
  slug_base := trim(BOTH '-' FROM slug_base);

  -- Handle slug collision by appending random suffix
  final_slug := slug_base;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
    final_slug := slug_base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create personal org with default plan
  INSERT INTO public.organizations (name, slug, type, plan_id)
  VALUES ('Personal', final_slug, 'personal', default_plan_id)
  RETURNING id INTO new_org_id;

  -- Add user as admin of personal org
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'admin', 'active');

  -- Set as default org
  UPDATE public.profiles SET default_org_id = new_org_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260315000025_update_handle_new_profile_plan.sql
git commit -m "feat: update handle_new_profile trigger to assign default plan"
```

---

## Chunk 2: Admin Server Actions

### Task 7: `listPlans` Action

**Files:**
- Create: `modules/admin/src/actions/list-plans.ts`

- [ ] **Step 1: Create the action**

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, PlanListItem } from '@onereal/types';

export async function listPlans(): Promise<ActionResult<PlanListItem[]>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    const { data, error } = await db
      .from('plans')
      .select('id, name, slug, max_properties, features, is_default, organizations(count)')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const items: PlanListItem[] = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      max_properties: p.max_properties,
      features: p.features ?? { online_payments: false, messaging: false },
      is_default: p.is_default,
      org_count: p.organizations?.[0]?.count ?? 0,
    }));

    return { success: true, data: items };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list plans' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/list-plans.ts
git commit -m "feat: add listPlans admin action"
```

---

### Task 8: `createPlan` Action

**Files:**
- Create: `modules/admin/src/actions/create-plan.ts`

- [ ] **Step 1: Create the action**

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, Plan, PlanFeatures } from '@onereal/types';

interface CreatePlanData {
  name: string;
  slug: string;
  max_properties: number;
  features: PlanFeatures;
  is_default: boolean;
}

export async function createPlan(
  data: CreatePlanData
): Promise<ActionResult<Plan>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // If setting as default, atomically flip all plans
    if (data.is_default) {
      // Insert first, then flip defaults atomically
      const { data: plan, error } = await db
        .from('plans')
        .insert({
          name: data.name,
          slug: data.slug,
          max_properties: data.max_properties,
          features: data.features as any,
          is_default: false, // insert as non-default first
        })
        .select()
        .single();

      if (error) {
        if (error.message?.includes('plans_slug_key')) {
          return { success: false, error: 'A plan with this slug already exists' };
        }
        throw error;
      }

      // Atomically set this as the only default
      await db
        .from('plans')
        .update({ is_default: false } as any)
        .neq('id', (plan as any).id);
      await db
        .from('plans')
        .update({ is_default: true } as any)
        .eq('id', (plan as any).id);

      // Re-fetch to get updated state
      const { data: updated } = await db
        .from('plans')
        .select()
        .eq('id', (plan as any).id)
        .single();

      return { success: true, data: updated as any };
    }

    const { data: plan, error } = await db
      .from('plans')
      .insert({
        name: data.name,
        slug: data.slug,
        max_properties: data.max_properties,
        features: data.features as any,
        is_default: data.is_default,
      })
      .select()
      .single();

    if (error) {
      if (error.message?.includes('plans_slug_key')) {
        return { success: false, error: 'A plan with this slug already exists' };
      }
      throw error;
    }

    return { success: true, data: plan as any };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to create plan' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/create-plan.ts
git commit -m "feat: add createPlan admin action"
```

---

### Task 9: `updatePlan` Action

**Files:**
- Create: `modules/admin/src/actions/update-plan.ts`

- [ ] **Step 1: Create the action**

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, Plan, PlanFeatures } from '@onereal/types';

interface UpdatePlanData {
  name?: string;
  slug?: string;
  max_properties?: number;
  features?: PlanFeatures;
  is_default?: boolean;
}

export async function updatePlan(
  planId: string,
  data: UpdatePlanData
): Promise<ActionResult<Plan>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // If setting as default, atomically flip
    if (data.is_default) {
      await db
        .from('plans')
        .update({ is_default: false } as any)
        .neq('id', planId);
    }

    const updates: any = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.slug !== undefined) updates.slug = data.slug;
    if (data.max_properties !== undefined) updates.max_properties = data.max_properties;
    if (data.features !== undefined) updates.features = data.features;
    if (data.is_default !== undefined) updates.is_default = data.is_default;

    const { data: plan, error } = await db
      .from('plans')
      .update(updates)
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      if (error.message?.includes('plans_slug_key')) {
        return { success: false, error: 'A plan with this slug already exists' };
      }
      throw error;
    }

    return { success: true, data: plan as any };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update plan' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/update-plan.ts
git commit -m "feat: add updatePlan admin action"
```

---

### Task 10: `deletePlan` Action

**Files:**
- Create: `modules/admin/src/actions/delete-plan.ts`

- [ ] **Step 1: Create the action**

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deletePlan(
  planId: string
): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Check if plan is default
    const { data: plan } = await db
      .from('plans')
      .select('is_default')
      .eq('id', planId)
      .single();

    if ((plan as any)?.is_default) {
      return { success: false, error: 'Cannot delete the default plan' };
    }

    // Check if any orgs are assigned to this plan
    const { count } = await db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', planId);

    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: `Cannot delete plan with ${count} organizations assigned. Reassign them first.`,
      };
    }

    const { error } = await db
      .from('plans')
      .delete()
      .eq('id', planId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete plan' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/delete-plan.ts
git commit -m "feat: add deletePlan admin action"
```

---

### Task 11: `updateOrgPlan` Action

**Files:**
- Create: `modules/admin/src/actions/update-org-plan.ts`

- [ ] **Step 1: Create the action**

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function updateOrgPlan(
  orgId: string,
  planId: string
): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Fetch target plan limits
    const { data: plan, error: planError } = await db
      .from('plans')
      .select('max_properties, name')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return { success: false, error: 'Plan not found' };
    }

    const maxProps = (plan as any).max_properties as number;

    // If plan has a property limit, check if org exceeds it
    if (maxProps > 0) {
      const { count } = await db
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      const propCount = count ?? 0;
      if (propCount > maxProps) {
        return {
          success: false,
          error: `Organization has ${propCount} properties but "${(plan as any).name}" plan allows ${maxProps}. Remove properties first.`,
        };
      }
    }

    // Update org's plan
    const { error } = await db
      .from('organizations')
      .update({ plan_id: planId } as any)
      .eq('id', orgId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update organization plan' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/update-org-plan.ts
git commit -m "feat: add updateOrgPlan admin action with downgrade validation"
```

---

### Task 12: Update `listOrganizations` to Include Plan Name

**Files:**
- Modify: `modules/admin/src/actions/list-organizations.ts`

- [ ] **Step 1: Add plan join to the data query**

Change the select string on the data query from:
```typescript
.select('id, name, slug, type, created_at, org_members(count), properties(count)')
```
To:
```typescript
.select('id, name, slug, type, created_at, org_members(count), properties(count), plans(name)')
```

- [ ] **Step 2: Add plan_name to the mapping**

In the `.map()` callback, add:
```typescript
plan_name: o.plans?.name ?? 'Unknown',
```

- [ ] **Step 3: Commit**

```bash
git add modules/admin/src/actions/list-organizations.ts
git commit -m "feat: include plan name in org list"
```

---

### Task 13: Update `getOrgDetails` to Include Plan Info

**Files:**
- Modify: `modules/admin/src/actions/get-org-details.ts`

- [ ] **Step 1: Add plan join to the org query**

Change the org select from:
```typescript
.select('id, name, slug, type, created_at, settings')
```
To:
```typescript
.select('id, name, slug, type, created_at, settings, plans(id, name, slug, max_properties, features)')
```

- [ ] **Step 2: Add plan to the result object**

In the `organization` object of the result, add the plan field:

```typescript
plan: {
  id: (org as any).plans?.id ?? '',
  name: (org as any).plans?.name ?? 'Unknown',
  slug: (org as any).plans?.slug ?? '',
  max_properties: (org as any).plans?.max_properties ?? 0,
  features: (org as any).plans?.features ?? { online_payments: false, messaging: false },
},
```

- [ ] **Step 3: Commit**

```bash
git add modules/admin/src/actions/get-org-details.ts
git commit -m "feat: include plan info in org details"
```

---

## Chunk 3: Admin UI

### Task 14: Admin Sidebar — Add Plans Nav Item

**Files:**
- Modify: `apps/web/components/admin/admin-sidebar.tsx`

- [ ] **Step 1: Add CreditCard import and Plans nav item**

Add `CreditCard` to the lucide-react import:
```typescript
import { LayoutDashboard, Building2, Users, ArrowLeft, CreditCard } from 'lucide-react';
```

Add the Plans item to `adminNavItems` between Organizations and Users:
```typescript
const adminNavItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Organizations', href: '/admin/organizations', icon: Building2 },
  { label: 'Plans', href: '/admin/plans', icon: CreditCard },
  { label: 'Users', href: '/admin/users', icon: Users },
];
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/admin-sidebar.tsx
git commit -m "feat: add Plans nav item to admin sidebar"
```

---

### Task 15: Plans Management Page

**Files:**
- Create: `apps/web/app/(admin)/admin/plans/page.tsx`

- [ ] **Step 1: Create the Plans page**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { listPlans } from '@onereal/admin/actions/list-plans';
import { createPlan } from '@onereal/admin/actions/create-plan';
import { updatePlan } from '@onereal/admin/actions/update-plan';
import { deletePlan } from '@onereal/admin/actions/delete-plan';
import {
  Button, Badge, Input, Label,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { PlanListItem, PlanFeatures } from '@onereal/types';

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formMaxProps, setFormMaxProps] = useState(10);
  const [formOnlinePayments, setFormOnlinePayments] = useState(false);
  const [formMessaging, setFormMessaging] = useState(false);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PlanListItem | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const result = await listPlans();
    if (result.success) setPlans(result.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  function openCreate() {
    setEditingId(null);
    setFormName('');
    setFormSlug('');
    setFormMaxProps(10);
    setFormOnlinePayments(false);
    setFormMessaging(false);
    setFormIsDefault(false);
    setFormOpen(true);
  }

  function openEdit(plan: PlanListItem) {
    setEditingId(plan.id);
    setFormName(plan.name);
    setFormSlug(plan.slug);
    setFormMaxProps(plan.max_properties);
    setFormOnlinePayments(plan.features.online_payments);
    setFormMessaging(plan.features.messaging);
    setFormIsDefault(plan.is_default);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formSlug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    setSaving(true);

    const features: PlanFeatures = {
      online_payments: formOnlinePayments,
      messaging: formMessaging,
    };

    if (editingId) {
      const result = await updatePlan(editingId, {
        name: formName,
        slug: formSlug,
        max_properties: formMaxProps,
        features,
        is_default: formIsDefault,
      });
      if (result.success) {
        toast.success('Plan updated');
        setFormOpen(false);
        fetchPlans();
      } else {
        toast.error(result.error);
      }
    } else {
      const result = await createPlan({
        name: formName,
        slug: formSlug,
        max_properties: formMaxProps,
        features,
        is_default: formIsDefault,
      });
      if (result.success) {
        toast.success('Plan created');
        setFormOpen(false);
        fetchPlans();
      } else {
        toast.error(result.error);
      }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deletePlan(deleteTarget.id);
    if (result.success) {
      toast.success('Plan deleted');
      setDeleteTarget(null);
      fetchPlans();
    } else {
      toast.error(result.error);
    }
  }

  // Auto-generate slug from name (only on create)
  function handleNameChange(value: string) {
    setFormName(value);
    if (!editingId) {
      setFormSlug(
        value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plans</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Create Plan
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : plans.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No plans found</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Property Limit</TableHead>
                <TableHead>Features</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">
                    {plan.name}
                    {plan.is_default && (
                      <Badge variant="secondary" className="ml-2">Default</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plan.slug}</TableCell>
                  <TableCell>
                    {plan.max_properties === 0 ? 'Unlimited' : plan.max_properties}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {plan.features.online_payments && (
                        <Badge variant="outline">Online Payments</Badge>
                      )}
                      {plan.features.messaging && (
                        <Badge variant="outline">Messaging</Badge>
                      )}
                      {!plan.features.online_payments && !plan.features.messaging && (
                        <span className="text-muted-foreground text-sm">None</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{plan.org_count}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(plan)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(plan)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={formName} onChange={(e) => handleNameChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input value={formSlug} onChange={(e) => setFormSlug(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Max Properties (0 = unlimited)</Label>
              <Input
                type="number"
                min={0}
                value={formMaxProps}
                onChange={(e) => setFormMaxProps(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>Features</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formOnlinePayments}
                    onChange={(e) => setFormOnlinePayments(e.target.checked)}
                    className="rounded"
                  />
                  Online Payments
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formMessaging}
                    onChange={(e) => setFormMessaging(e.target.checked)}
                    className="rounded"
                  />
                  Messaging
                </label>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
                className="rounded"
              />
              Default plan (assigned to new organizations)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Delete Plan"
          description={`This will permanently delete the "${deleteTarget.name}" plan. This cannot be undone.`}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(admin)/admin/plans/page.tsx"
git commit -m "feat: add admin plans management page"
```

---

### Task 16: Add Plan Column to Org List Page

**Files:**
- Modify: `apps/web/app/(admin)/admin/organizations/page.tsx`

- [ ] **Step 1: Add Plan column header**

Add after the `<TableHead>Type</TableHead>` line:
```tsx
<TableHead>Plan</TableHead>
```

- [ ] **Step 2: Add Plan cell in the row mapping**

Add after the `<TableCell>` with the type badge:
```tsx
<TableCell>
  <Badge variant="outline">{org.plan_name}</Badge>
</TableCell>
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(admin)/admin/organizations/page.tsx"
git commit -m "feat: add Plan column to admin org list"
```

---

### Task 17: Add Plan Card to Org Detail Page

**Files:**
- Modify: `apps/web/app/(admin)/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Add imports**

Add to existing imports:
```typescript
import { listPlans } from '@onereal/admin/actions/list-plans';
import { updateOrgPlan } from '@onereal/admin/actions/update-org-plan';
import type { OrgDetail, OrgMemberListItem, PlanListItem } from '@onereal/types';
```

Add to `@onereal/ui` imports:
```typescript
Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
```

- [ ] **Step 2: Add plans state and fetch**

Add state variables after the existing state declarations:
```typescript
const [allPlans, setAllPlans] = useState<PlanListItem[]>([]);
const [changingPlan, setChangingPlan] = useState(false);
```

Add a useEffect to fetch plans:
```typescript
useEffect(() => {
  listPlans().then((result) => {
    if (result.success) setAllPlans(result.data);
  });
}, []);
```

- [ ] **Step 3: Add plan change handler**

```typescript
async function handlePlanChange(newPlanId: string) {
  if (!data || newPlanId === data.organization.plan.id) return;
  setChangingPlan(true);
  const result = await updateOrgPlan(orgId, newPlanId);
  if (result.success) {
    toast.success('Plan updated');
    // Refresh org details
    const refreshed = await getOrgDetails(orgId);
    if (refreshed.success) setData(refreshed.data);
  } else {
    toast.error(result.error);
  }
  setChangingPlan(false);
}
```

- [ ] **Step 4: Add Plan card between Stats and Tabs**

Insert after the stats grid `</div>` and before `<Tabs>`:

```tsx
{/* Plan */}
<Card>
  <CardHeader className="flex flex-row items-center justify-between pb-2">
    <CardTitle className="text-sm font-medium">Plan</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <p className="text-lg font-semibold">{org.plan.name}</p>
        <p className="text-sm text-muted-foreground">
          {org.plan.max_properties === 0
            ? 'Unlimited properties'
            : `${stats.property_count} of ${org.plan.max_properties} properties`}
        </p>
      </div>
      <Select
        value={org.plan.id}
        onValueChange={handlePlanChange}
        disabled={changingPlan}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allPlans.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/organizations/[id]/page.tsx"
git commit -m "feat: add plan card with change dropdown to org detail page"
```

---

## Chunk 4: Enforcement & Gating

### Task 18: Property Limit Enforcement

**Files:**
- Modify: `modules/portfolio/src/actions/create-property.ts`

- [ ] **Step 1: Add plan limit check before the property insert**

After the `const db = supabase as any;` line and before the property insert, add:

```typescript
    // Check plan property limit
    const { data: orgWithPlan } = await db
      .from('organizations')
      .select('plans(max_properties)')
      .eq('id', orgId)
      .single();

    const maxProps = (orgWithPlan as any)?.plans?.max_properties ?? 0;
    if (maxProps > 0) {
      const { count } = await db
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      const current = count ?? 0;
      if (current >= maxProps) {
        return {
          success: false,
          error: `Property limit reached (${current}/${maxProps}). Upgrade your plan to add more.`,
        };
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add modules/portfolio/src/actions/create-property.ts
git commit -m "feat: enforce property limit from org's plan in createProperty"
```

---

### Task 19: Messaging Feature Gate — Landlord Page

**Files:**
- Modify: `apps/web/app/(dashboard)/messages/page.tsx`

- [ ] **Step 1: Add plan check**

Add `MessageSquare` to the lucide-react imports (if not already imported). Then add:
```typescript
import { getOrgPlan } from '@onereal/database';
```

Note: Use whatever `createClient` is already imported in this file for the browser-side Supabase client (e.g., `createClient` from `@onereal/database` or `@supabase/ssr`). If none exists, add: `import { createClient } from '@onereal/database';`

Add state and effect inside `MessagesPage` component (after the existing state declarations):

```typescript
const [messagingAllowed, setMessagingAllowed] = useState<boolean | null>(null);
const [planName, setPlanName] = useState('');

useEffect(() => {
  if (!activeOrg) return;
  const supabase = createClient() as any;
  getOrgPlan(supabase, activeOrg.id).then((plan: any) => {
    if (plan) {
      setMessagingAllowed(plan.features?.messaging ?? false);
      setPlanName(plan.name);
    } else {
      setMessagingAllowed(true); // Allow if no plan found (safety fallback)
    }
  }).catch(() => setMessagingAllowed(true));
}, [activeOrg]);
```

- [ ] **Step 2: Add upgrade banner**

Add before the main return — first a loading/null guard, then the gating check:

```typescript
if (messagingAllowed === null) return null; // Still loading plan info
```

Then immediately after:

```typescript
if (messagingAllowed === false) {
  return (
    <div className="flex h-[calc(100vh-6rem)] items-center justify-center">
      <div className="text-center max-w-md">
        <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <h2 className="text-xl font-semibold mb-2">Messaging Not Available</h2>
        <p className="text-muted-foreground">
          Messaging is available on paid plans. You are currently on the <strong>{planName}</strong> plan.
          Contact your administrator to upgrade.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/messages/page.tsx"
git commit -m "feat: add messaging feature gate on landlord messages page"
```

---

### Task 20: Messaging Feature Gate — Tenant Page

**Files:**
- Modify: `apps/web/app/(dashboard)/tenant/messages/page.tsx`

- [ ] **Step 1: Add plan check**

This page uses `useUser()` but the tenant's org is determined differently. The tenant needs to check the plan of the org they belong to.

Add `MessageSquare` to the lucide-react imports (if not already imported). Then add:
```typescript
import { getOrgPlan } from '@onereal/database';
```

Update the `useUser()` destructuring from `{ profile }` to include `activeOrg`:
```typescript
// Change:
const { profile } = useUser();
// To:
const { profile, activeOrg } = useUser();
```

Add state and effect inside `TenantMessagesPage`:

```typescript
const [messagingAllowed, setMessagingAllowed] = useState<boolean | null>(null);

useEffect(() => {
  if (!activeOrg) return;
  const supabase = createClient() as any;
  getOrgPlan(supabase, activeOrg.id).then((plan: any) => {
    setMessagingAllowed(plan?.features?.messaging ?? true);
  }).catch(() => setMessagingAllowed(true));
}, [activeOrg]);
```

Note: Use whatever `createClient` is already in this file for the browser Supabase client.

- [ ] **Step 2: Add upgrade banner**

Add before the main return (with a null guard first):

```typescript
if (messagingAllowed === null) return null;
```

Then:

```typescript
if (messagingAllowed === false) {
  return (
    <div className="flex h-[calc(100vh-6rem)] items-center justify-center">
      <div className="text-center max-w-md">
        <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <h2 className="text-xl font-semibold mb-2">Messaging Not Available</h2>
        <p className="text-muted-foreground">
          Messaging is not available on your organization's current plan.
          Contact your property manager for more information.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/tenant/messages/page.tsx"
git commit -m "feat: add messaging feature gate on tenant messages page"
```

---

### Task 21: Settings Page — Current Plan Card

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add plan state and fetch**

Add import:
```typescript
import { getOrgPlan, createClient as createDbClient } from '@onereal/database';
import type { Plan } from '@onereal/types';
```

Inside the component, add state and effect:

```typescript
const [plan, setPlan] = useState<Plan | null>(null);
const [propertyCount, setPropertyCount] = useState(0);

useEffect(() => {
  if (!activeOrg) return;
  const db = createDbClient() as any;
  getOrgPlan(db, activeOrg.id).then((p: any) => setPlan(p)).catch(() => {});
  db.from('properties')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', activeOrg.id)
    .then(({ count }: any) => setPropertyCount(count ?? 0));
}, [activeOrg]);
```

- [ ] **Step 2: Add Plan card after the General card**

```tsx
{plan && (
  <Card>
    <CardHeader><CardTitle>Current Plan</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">{plan.name}</span>
        <Badge variant="secondary">{plan.slug}</Badge>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          Properties: {propertyCount}{' '}
          {plan.max_properties > 0 ? `of ${plan.max_properties}` : '(Unlimited)'}
        </p>
        <p>
          Online Payments: {plan.features?.online_payments ? 'Enabled' : 'Not included'}
        </p>
        <p>
          Messaging: {plan.features?.messaging ? 'Enabled' : 'Not included'}
        </p>
      </div>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/settings/page.tsx"
git commit -m "feat: add Current Plan card to settings page"
```

---

## Chunk 5: Build Verification

### Task 22: Build Verification

- [ ] **Step 1: Run build**

```bash
cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal
pnpm build
```

Expected: Zero errors, all pages compile.

- [ ] **Step 2: Fix any build errors**

If TypeScript errors occur, fix them. Common issues:
- Missing type imports
- `as any` casts needed for Supabase typed client
- Import paths

- [ ] **Step 3: Final commit (if fixes were needed)**

Stage only the specific files that were fixed:
```bash
git add <changed-files>
git commit -m "fix: resolve build errors for plans feature"
```

---

## Verification Checklist

After all tasks are complete, verify against the spec:

1. [ ] Admin can create, edit, and delete plans
2. [ ] Only one plan can be marked as default
3. [ ] Cannot delete a plan with orgs assigned
4. [ ] New orgs (personal + company) get the default plan
5. [ ] Property creation blocked when at plan limit with clear error message
6. [ ] Messaging page shows upgrade banner when feature is gated
7. [ ] Admin can change an org's plan
8. [ ] Downgrade blocked when org exceeds target plan's property limit
9. [ ] Org list shows plan name column
10. [ ] Org detail shows plan card with change option
11. [ ] Settings page shows current plan info for landlords
12. [ ] `pnpm build` passes

# Phase 5A: Tenant Portal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable tenants to receive email invites, register, and access a self-service portal to view their lease details and payment history.

**Architecture:** Add `user_id` to the existing `tenants` table to link contact records to Supabase auth users. Modify `get_user_org_ids()` to exclude tenant-role memberships so tenants only see their own data via new tenant-specific RLS policies. Create a `modules/tenant-portal/` module with hooks and an invite action. Add `/tenant/*` routes with a simplified sidebar for tenant-role users.

**Tech Stack:** Next.js 15, Supabase (PostgreSQL + Auth), React Query, Zod, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-15-phase5a-tenant-portal-design.md`

---

## Chunk 1: Foundation (Database, Types, Service Client)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260315000013_tenant_portal.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Phase 5A: Tenant Portal
-- Adds user_id/invited_at to tenants, RLS helper functions, tenant-specific policies

-- 1. Add columns to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- Unique index: one user per tenant record
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_user_id
  ON public.tenants(user_id) WHERE user_id IS NOT NULL;

-- Unique partial index: prevent duplicate emails per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_org_email
  ON public.tenants(org_id, email) WHERE email IS NOT NULL;

-- Index on email for linking RPC performance
CREATE INDEX IF NOT EXISTS idx_tenants_email
  ON public.tenants(email) WHERE email IS NOT NULL;

-- 2. RLS helper: get lease IDs for the current tenant user
CREATE OR REPLACE FUNCTION public.get_tenant_lease_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.id FROM public.leases l
  INNER JOIN public.tenants t ON t.id = l.tenant_id
  WHERE t.user_id = auth.uid();
$$;

-- 3. Modify get_user_org_ids() to EXCLUDE tenant-role memberships
-- Tenants must NOT see all org data through existing org-wide SELECT policies.
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND om.role != 'tenant';
$$;

-- 4. RLS: tenants can see their own org_members and organizations
-- (Required because get_user_org_ids() now excludes tenant memberships,
--  but tenants still need to see their org for useUser/OrgSwitcher)
CREATE POLICY "Users can view own memberships"
  ON public.org_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view orgs they belong to"
  ON public.organizations FOR SELECT
  USING (id IN (
    SELECT org_id FROM public.org_members
    WHERE user_id = auth.uid() AND status = 'active'
  ));

-- 5. Tenant invite detection (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.check_is_invited_tenant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND invited_at IS NOT NULL
      AND user_id IS NULL
  );
$$;

-- 6. Tenant-specific RLS policies (read-only)

CREATE POLICY "Tenants can view own record"
  ON public.tenants FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Tenants can view own leases"
  ON public.leases FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants can view own invoices"
  ON public.invoices FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

CREATE POLICY "Tenants can view own lease charges"
  ON public.lease_charges FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

CREATE POLICY "Tenants can view own units"
  ON public.units FOR SELECT
  USING (
    id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
  );

CREATE POLICY "Tenants can view own properties"
  ON public.properties FOR SELECT
  USING (
    id IN (
      SELECT property_id FROM public.units
      WHERE id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
    )
  );

-- 7. Tenant linking function (called after onboarding)
CREATE OR REPLACE FUNCTION public.link_tenant_on_invite()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_tenant RECORD;
BEGIN
  v_user_id := auth.uid();

  SELECT email INTO v_user_email
  FROM auth.users WHERE id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN;
  END IF;

  FOR v_tenant IN
    SELECT id, org_id FROM public.tenants
    WHERE email = v_user_email
      AND invited_at IS NOT NULL
      AND user_id IS NULL
  LOOP
    UPDATE public.tenants SET user_id = v_user_id WHERE id = v_tenant.id;

    INSERT INTO public.org_members (org_id, user_id, role, status, joined_at)
    VALUES (v_tenant.org_id, v_user_id, 'tenant', 'active', now())
    ON CONFLICT (org_id, user_id) DO NOTHING;

    UPDATE public.profiles
    SET default_org_id = v_tenant.org_id
    WHERE id = v_user_id
      AND (
        default_org_id IS NULL
        OR default_org_id IN (
          SELECT id FROM public.organizations WHERE type = 'personal'
        )
      );
  END LOOP;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260315000013_tenant_portal.sql
git commit -m "feat: add tenant portal migration - user_id, RLS policies, linking functions"
```

---

### Task 2: Update Tenant Type

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add user_id and invited_at to Tenant interface**

Find the `Tenant` interface (around line 175) and add two fields after `status`:

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
  user_id: string | null;
  invited_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat: add user_id and invited_at to Tenant type"
```

---

### Task 3: Create Service Role Client

**Files:**
- Create: `packages/database/src/service-role.ts`
- Modify: `packages/database/package.json` (add export)

- [ ] **Step 1: Create the service role client utility**

```typescript
import { createClient } from '@supabase/supabase-js';

export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 2: Add export to package.json**

In `packages/database/package.json`, add to the `"exports"` field:

```json
"./service-role": "./src/service-role.ts"
```

The exports section should look like:

```json
"exports": {
  ".": "./src/index.ts",
  "./server": "./src/server.ts",
  "./service-role": "./src/service-role.ts"
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/service-role.ts packages/database/package.json
git commit -m "feat: add Supabase service role client for admin API access"
```

---

### Task 4: Create Tenant Portal Module

**Files:**
- Create: `modules/tenant-portal/package.json`
- Create: `modules/tenant-portal/src/index.ts`
- Create: `modules/tenant-portal/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@onereal/tenant-portal",
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
    "@onereal/types": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "next": "^15.0.0",
    "@tanstack/react-query": "^5.60.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create barrel export (empty for now)**

`modules/tenant-portal/src/index.ts`:

```typescript
// Hooks (client-only)
// export { useTenantLease } from './hooks/use-tenant-lease';
// export { useTenantInvoices } from './hooks/use-tenant-invoices';

// Server actions: use deep imports
// import { inviteTenant } from '@onereal/tenant-portal/actions/invite-tenant';
```

- [ ] **Step 4: Add module to workspace and install**

Run from monorepo root:

```bash
pnpm install
```

Then add the dependency to `apps/web/package.json`:

```json
"@onereal/tenant-portal": "workspace:*"
```

Run `pnpm install` again.

- [ ] **Step 5: Commit**

```bash
git add modules/tenant-portal/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat: scaffold tenant-portal module"
```

---

## Chunk 2: Backend (Invite Action, Hooks)

### Task 5: Create Invite Tenant Server Action

**Files:**
- Create: `modules/tenant-portal/src/actions/invite-tenant.ts`

- [ ] **Step 1: Implement the invite action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { createServiceRoleClient } from '@onereal/database/service-role';
import type { ActionResult } from '@onereal/types';

export async function inviteTenant(
  tenantId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Fetch tenant record
    const { data: tenant, error: fetchError } = await db
      .from('tenants')
      .select('id, email, user_id, invited_at, org_id')
      .eq('id', tenantId)
      .single();

    if (fetchError || !tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    if (!tenant.email) {
      return { success: false, error: 'Tenant has no email address' };
    }

    if (tenant.user_id) {
      return { success: false, error: 'Tenant already has portal access' };
    }

    // Verify caller is a manager of this org
    const { data: membership } = await db
      .from('org_members')
      .select('role')
      .eq('org_id', tenant.org_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['admin', 'landlord', 'property_manager'].includes(membership.role)) {
      return { success: false, error: 'Not authorized to invite tenants' };
    }

    // Send invite via Supabase admin API
    const serviceClient = createServiceRoleClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
      tenant.email,
      { redirectTo: `${siteUrl}/auth/callback` }
    );

    if (inviteError) {
      return { success: false, error: inviteError.message };
    }

    // Update invited_at timestamp
    await db
      .from('tenants')
      .update({ invited_at: new Date().toISOString() })
      .eq('id', tenantId);

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to send invite' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/tenant-portal/src/actions/invite-tenant.ts
git commit -m "feat: add inviteTenant server action with service role client"
```

---

### Task 6: Create Tenant Lease Hook

**Files:**
- Create: `modules/tenant-portal/src/hooks/use-tenant-lease.ts`

- [ ] **Step 1: Implement the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantLease() {
  return useQuery({
    queryKey: ['tenant-lease'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('leases')
        .select('*, units(unit_number, property_id, properties(name, address)), lease_charges(*)')
        .in('status', ['active', 'month_to_month'])
        .order('start_date', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return data ?? null;
    },
  });
}
```

RLS automatically scopes results to the current tenant's leases (via `get_tenant_lease_ids()` and the "Tenants can view own leases" policy). No `orgId` or `tenantId` parameter needed.

- [ ] **Step 2: Commit**

```bash
git add modules/tenant-portal/src/hooks/use-tenant-lease.ts
git commit -m "feat: add useTenantLease hook (RLS-scoped)"
```

---

### Task 7: Create Tenant Invoices Hook

**Files:**
- Create: `modules/tenant-portal/src/hooks/use-tenant-invoices.ts`

- [ ] **Step 1: Implement the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantInvoices(filter: 'open' | 'paid' | 'all' = 'all') {
  return useQuery({
    queryKey: ['tenant-invoices', filter],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('invoices')
        .select('*, leases(tenant_id, units(unit_number, properties(name)))')
        .order('due_date', { ascending: false });

      if (filter === 'open') {
        query = query.in('status', ['open', 'partially_paid']);
      } else if (filter === 'paid') {
        query = query.eq('status', 'paid');
      }

      const { data, error } = await query;
      if (error) throw error;

      // Compute displayStatus: overdue if open + past due_date
      const today = new Date().toISOString().split('T')[0];
      return (data ?? []).map((inv: any) => ({
        ...inv,
        displayStatus:
          (inv.status === 'open' || inv.status === 'partially_paid') && inv.due_date && inv.due_date < today
            ? 'overdue'
            : inv.status,
      }));
    },
  });
}
```

RLS automatically scopes results to the current tenant's invoices.

- [ ] **Step 2: Commit**

```bash
git add modules/tenant-portal/src/hooks/use-tenant-invoices.ts
git commit -m "feat: add useTenantInvoices hook with status filter and overdue computation"
```

---

### Task 8: Update Module Exports

**Files:**
- Modify: `modules/tenant-portal/src/index.ts`

- [ ] **Step 1: Uncomment and finalize barrel exports**

```typescript
// Hooks (client-only)
export { useTenantLease } from './hooks/use-tenant-lease';
export { useTenantInvoices } from './hooks/use-tenant-invoices';

// Server actions: use deep imports
// import { inviteTenant } from '@onereal/tenant-portal/actions/invite-tenant';
```

- [ ] **Step 2: Commit**

```bash
git add modules/tenant-portal/src/index.ts
git commit -m "feat: export tenant portal hooks from module barrel"
```

---

## Chunk 3: Middleware & Navigation

### Task 9: Update Middleware for Tenant Routing

**Files:**
- Modify: `apps/web/middleware.ts`

- [ ] **Step 1: Add role-based routing to the middleware**

The current middleware (lines 55-68) fetches the profile and checks `first_name` for onboarding. Keep the existing profile query as-is. After the onboarding redirect block (after the closing `}` on line 68), insert the following role-check block **before** the final `return supabaseResponse`:

> **Note:** The spec suggests combining the role fetch with the profile query via a join to avoid a second round trip. However, PostgREST does not support cross-column join conditions (we'd need `org_members.org_id = profiles.default_org_id` which isn't a navigable FK path). A separate query is the correct approach here.

```typescript
    // Role-based tenant routing (after onboarding check, before final return)
    if (user && !isOnboarding && !isPublicPath) {
      const { data: profile2 } = await supabase
        .from('profiles')
        .select('default_org_id')
        .eq('id', user.id)
        .single();

      if (profile2?.default_org_id) {
        const { data: membership } = await supabase
          .from('org_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('org_id', profile2.default_org_id)
          .single();

        const role = membership?.role;
        const isTenantRoute = pathname.startsWith('/tenant');

        if (role === 'tenant') {
          // Tenant users can only access /tenant/* and /settings/profile
          // (/auth/* and /onboarding are handled by earlier checks above)
          const allowedPaths = ['/tenant', '/settings/profile'];
          const isAllowed = allowedPaths.some(p => pathname.startsWith(p));
          if (!isAllowed) {
            return NextResponse.redirect(new URL('/tenant', request.url));
          }
        } else if (isTenantRoute) {
          // Non-tenant users cannot access /tenant/* routes
          return NextResponse.redirect(new URL('/', request.url));
        }
      }
    }
```

**Optimization note:** This adds a second profile query. To eliminate it, refactor the existing onboarding check block to store the profile result in a variable accessible to both blocks. The implementer should extract the `profile` const from the onboarding block (line 56) to a shared scope:

```typescript
  // Move profile query outside the onboarding-only block so both checks can use it
  let profile: { first_name: string | null; default_org_id: string | null } | null = null;
  if (user && !isPublicPath) {
    const { data } = await supabase
      .from('profiles')
      .select('first_name, default_org_id')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  // Onboarding check (use shared profile)
  if (user && !isOnboarding && !isPublicPath && !profile?.first_name) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Role-based tenant routing
  if (user && !isOnboarding && !isPublicPath && profile?.default_org_id) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', profile.default_org_id)
      .single();

    const role = membership?.role;
    const isTenantRoute = pathname.startsWith('/tenant');

    if (role === 'tenant') {
      const allowedPaths = ['/tenant', '/settings/profile'];
      const isAllowed = allowedPaths.some(p => pathname.startsWith(p));
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/tenant', request.url));
      }
    } else if (isTenantRoute) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }
```

Use this optimized version to replace lines 55-68 and add the role check. This avoids a redundant profile query.

- [ ] **Step 2: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat: add role-based tenant routing to middleware"
```

---

### Task 10: Update Sidebar for Tenant Navigation

**Files:**
- Modify: `apps/web/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Add tenant nav items and role-based rendering**

At the top of the file, add these imports (alongside existing ones):

```typescript
import { Home, FileText, CreditCard } from 'lucide-react';
import { useRole } from '@onereal/auth';
```

After the existing `navItems` array definition, add the tenant nav items:

```typescript
const tenantNavItems: NavItem[] = [
  { label: 'Home', href: '/tenant', icon: Home },
  { label: 'My Lease', href: '/tenant/lease', icon: FileText },
  { label: 'Payments', href: '/tenant/payments', icon: CreditCard },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, disabled: true, badge: 'Soon' },
];
```

In the `SidebarContent` function, before the `return` statement (around line 185 where `navItems` is mapped), add the role check:

```typescript
const role = useRole();
const items = role === 'tenant' ? tenantNavItems : navItems;
```

Then use `items` instead of `navItems` in the JSX mapping. The `bottomItems` (Settings) should remain for both roles.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/dashboard/sidebar.tsx
git commit -m "feat: add tenant-specific sidebar navigation based on role"
```

---

### Task 11: Update Onboarding for Tenant Detection

**Files:**
- Modify: `apps/web/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Add tenant detection after profile save**

The existing `saveProfileAndContinue()` function (lines 29-43) fetches the user, calls `updateProfile`, then calls `setStep(2)`. Modify it to add tenant detection between `updateProfile` and `setStep(2)`:

```typescript
async function saveProfileAndContinue() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  try {
    await updateProfile(supabase, user.id, {
      first_name: firstName,
      last_name: lastName,
      phone: phone || undefined,
    });

    // Check if this user was invited as a tenant
    const { data: isTenant } = await supabase.rpc('check_is_invited_tenant');

    if (isTenant) {
      // Link tenant and redirect to portal — skip org selection step
      await supabase.rpc('link_tenant_on_invite');
      router.push('/tenant');
      return;
    }

    setStep(2);
  } catch {
    toast.error('Failed to save profile');
  }
}
```

This preserves the existing patterns: `getUser()` call, `toast.error()` for errors, no `setLoading` (which is only used in the org step functions). The only addition is the tenant detection block between `updateProfile` and `setStep(2)`.

No new imports needed — `createClient` and `supabase` are already in scope (lines 5 and 21).

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(auth)/onboarding/page.tsx"
git commit -m "feat: detect invited tenants during onboarding, skip org selection"
```

---

## Chunk 4: Landlord-Side UI (Invite Button)

### Task 12: Add Invite UI to Tenant Detail Page

**Files:**
- Modify: `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx`

- [ ] **Step 1: Add invite button/badge to the tenant detail page**

Add the import for the invite action and icons:

```typescript
import { inviteTenant } from '@onereal/tenant-portal/actions/invite-tenant';
import { Send, CheckCircle, Clock } from 'lucide-react';
```

After the tenant name and status badge area (around line 63-67), add an invite status indicator. Create a helper component inside the file or inline:

```typescript
function InviteStatus({ tenant }: { tenant: any }) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  async function handleInvite() {
    setLoading(true);
    const result = await inviteTenant(tenant.id);
    setLoading(false);
    if (result.success) {
      toast.success('Invite sent!');
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
    } else {
      toast.error(result.error);
    }
  }

  if (!tenant.email) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Add email to invite
      </Badge>
    );
  }

  if (tenant.user_id) {
    return (
      <Badge className="bg-green-100 text-green-800 gap-1">
        <CheckCircle className="h-3 w-3" /> Portal Active
      </Badge>
    );
  }

  if (tenant.invited_at) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> Invite Pending
        </Badge>
        <Button variant="ghost" size="sm" onClick={handleInvite} disabled={loading}>
          {loading ? 'Sending...' : 'Resend'}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={handleInvite} disabled={loading}>
      <Send className="h-4 w-4" />
      {loading ? 'Sending...' : 'Invite to Portal'}
    </Button>
  );
}
```

Then render `<InviteStatus tenant={tenant} />` in the header area next to the tenant's name badge:

```tsx
<div className="flex items-center gap-4">
  <Button variant="ghost" size="icon" onClick={() => router.push('/contacts/tenants')}>
    <ArrowLeft className="h-4 w-4" />
  </Button>
  <h1 className="text-2xl font-bold">{tenant.first_name} {tenant.last_name}</h1>
  <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
    {tenant.status}
  </Badge>
  <InviteStatus tenant={tenant} />
</div>
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx"
git commit -m "feat: add invite to portal button on tenant detail page"
```

---

## Chunk 5: Tenant Portal Pages

### Task 13: Create Tenant Home Page

**Files:**
- Create: `apps/web/app/(dashboard)/tenant/page.tsx`

- [ ] **Step 1: Implement the tenant home page**

```typescript
'use client';

import { useTenantLease, useTenantInvoices } from '@onereal/tenant-portal';
import { useUser } from '@onereal/auth';
import {
  Card, CardContent, CardHeader, CardTitle, Badge,
} from '@onereal/ui';
import { Home, FileText } from 'lucide-react';
import Link from 'next/link';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

export default function TenantHomePage() {
  const { profile } = useUser();
  const { data: lease, isLoading: leaseLoading } = useTenantLease();
  const { data: invoices, isLoading: invoicesLoading } = useTenantInvoices('all');

  const recentInvoices = (invoices ?? []).slice(0, 5);

  // Quick stats
  const currentYear = new Date().getFullYear();
  const totalPaidThisYear = (invoices ?? [])
    .filter((inv: any) => inv.status === 'paid' && inv.due_date?.startsWith(String(currentYear)))
    .reduce((sum: number, inv: any) => sum + Number(inv.amount || 0), 0);

  const openInvoices = (invoices ?? []).filter(
    (inv: any) => inv.status === 'open' || inv.status === 'partially_paid'
  );
  const outstandingBalance = openInvoices.reduce(
    (sum: number, inv: any) => sum + Number(inv.amount || 0), 0
  );
  const nextDue = openInvoices.sort(
    (a: any, b: any) => (a.due_date || '').localeCompare(b.due_date || '')
  )[0];

  if (leaseLoading || invoicesLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        Welcome, {profile?.first_name ?? 'Tenant'}
      </h1>

      {/* Lease Summary */}
      {lease ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Lease</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">
                  {lease.units?.properties?.name ?? 'Property'}, Unit {lease.units?.unit_number ?? '—'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '—'} –{' '}
                  {lease.end_date ? new Date(lease.end_date).toLocaleDateString() : 'Ongoing'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">${Number(lease.rent_amount).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">/month</p>
              </div>
            </div>
            <div className="mt-3">
              <Badge className={lease.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}>
                {lease.status.replace('_', ' ')}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active lease found. Contact your landlord.</p>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Paid This Year</p>
            <p className="text-2xl font-bold">${totalPaidThisYear.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Outstanding Balance</p>
            <p className="text-2xl font-bold">${outstandingBalance.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Next Due Date</p>
            <p className="text-2xl font-bold">
              {nextDue?.due_date ? new Date(nextDue.due_date).toLocaleDateString() : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Recent Invoices</CardTitle>
          <Link href="/tenant/payments" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices found.</p>
          ) : (
            <div className="space-y-3">
              {recentInvoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium">{inv.description || `Invoice #${inv.invoice_number}`}</p>
                    <p className="text-sm text-muted-foreground">
                      Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="font-semibold">${Number(inv.amount).toLocaleString()}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.displayStatus] ?? ''}`}>
                      {inv.displayStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/tenant/page.tsx"
git commit -m "feat: create tenant home page with lease summary and recent invoices"
```

---

### Task 14: Create Tenant Lease Page

**Files:**
- Create: `apps/web/app/(dashboard)/tenant/lease/page.tsx`

- [ ] **Step 1: Implement the lease detail page**

```typescript
'use client';

import { useTenantLease } from '@onereal/tenant-portal';
import {
  Card, CardContent, CardHeader, CardTitle, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';

export default function TenantLeasePage() {
  const { data: lease, isLoading } = useTenantLease();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!lease) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Lease</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active lease found. Contact your landlord.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const charges = (lease.lease_charges ?? []).filter((c: any) => c.is_active);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">My Lease</h1>
        <Badge className={lease.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}>
          {lease.status.replace('_', ' ')}
        </Badge>
      </div>

      {/* Property & Unit */}
      <Card>
        <CardHeader>
          <CardTitle>Property & Unit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Property</p>
              <p className="font-medium">{lease.units?.properties?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unit</p>
              <p className="font-medium">{lease.units?.unit_number ?? '—'}</p>
            </div>
            {lease.units?.properties?.address && (
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-medium">{lease.units.properties.address}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lease Details */}
      <Card>
        <CardHeader>
          <CardTitle>Lease Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Start Date</p>
              <p className="font-medium">
                {lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '—'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">End Date</p>
              <p className="font-medium">
                {lease.end_date ? new Date(lease.end_date).toLocaleDateString() : 'Ongoing'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Monthly Rent</p>
              <p className="font-medium text-lg">${Number(lease.rent_amount).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Security Deposit</p>
              <p className="font-medium">
                {lease.security_deposit ? `$${Number(lease.security_deposit).toLocaleString()}` : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Charges */}
      {charges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Frequency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge: any) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.name}</TableCell>
                    <TableCell>${Number(charge.amount).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{charge.frequency.replace('_', ' ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/tenant/lease/page.tsx"
git commit -m "feat: create tenant lease detail page"
```

---

### Task 15: Create Tenant Payments Page

**Files:**
- Create: `apps/web/app/(dashboard)/tenant/payments/page.tsx`

- [ ] **Step 1: Implement the payments page**

```typescript
'use client';

import { useState } from 'react';
import { useTenantInvoices } from '@onereal/tenant-portal';
import {
  Card, CardContent, CardHeader, CardTitle,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

export default function TenantPaymentsPage() {
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('all');
  const { data: invoices, isLoading } = useTenantInvoices(filter);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'open' | 'paid' | 'all')}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !invoices || invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No invoices found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.description || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(inv.amount).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.displayStatus] ?? ''}`}>
                            {inv.displayStatus}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/tenant/payments/page.tsx"
git commit -m "feat: create tenant payments page with filter tabs"
```

---

## Chunk 6: Integration & Verification

### Task 16: Apply Migration and Verify Build

**Files:** None (verification only)

- [ ] **Step 1: Push migration to Supabase**

```bash
npx supabase db push --linked
```

Expected: Migration applies successfully. Check for any policy name conflicts.

- [ ] **Step 2: Add SUPABASE_SERVICE_ROLE_KEY to .env.local**

In `apps/web/.env.local`, add:

```
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Get the key from Supabase Dashboard → Settings → API → `service_role` key.

Also add (if not present):

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Run the build**

```bash
pnpm build
```

Expected: Build passes with no TypeScript errors.

- [ ] **Step 4: Manual smoke test — landlord side**

1. Start dev server: `pnpm dev --filter=@onereal/web`
2. Log in as landlord
3. Go to a tenant detail page → verify "Invite to Portal" button appears (or "Add email to invite" if no email)
4. Check sidebar → should show landlord nav items (Dashboard, Properties, Accounting, etc.)
5. Navigate to `/tenant` → should redirect back to `/` (since you're a landlord)

- [ ] **Step 5: Manual smoke test — tenant side**

1. From landlord view, invite a tenant (click "Invite to Portal" for a tenant with an email)
2. Check the tenant's email inbox for the Supabase invite link
3. Click the invite link → should arrive at `/onboarding`
4. Complete onboarding (enter name) → should redirect to `/tenant` (not step 2)
5. Verify sidebar shows tenant nav items: Home, My Lease, Payments, Maintenance (disabled)
6. Verify `/tenant` shows lease summary card and recent invoices
7. Navigate to `/tenant/lease` → verify lease details, property/unit, charges
8. Navigate to `/tenant/payments` → verify invoice table, All/Open/Paid tabs work
9. Navigate to `/` or any landlord route → should redirect back to `/tenant`

- [ ] **Step 6: Commit any fixes**

```bash
git add <specific-files-that-were-fixed>
git commit -m "fix: address build issues from Phase 5A integration"
```

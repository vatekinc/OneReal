# Super Admin Interface Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform admin dashboard where the OneReal admin can view all registered organizations, users, and platform stats, and perform admin actions (disable/enable accounts, delete orgs/users).

**Architecture:** Separate `(admin)` route group with its own layout and sidebar, middleware-gated by `is_platform_admin` flag on the `profiles` table. Server actions use `createServiceRoleClient()` to bypass RLS and access all data cross-org. No new database tables — just one column addition.

**Tech Stack:** Next.js 15 (App Router), Supabase (PostgreSQL + Admin API), TanStack React Table, shadcn/ui, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-15-super-admin-interface-design.md`

---

## Chunk 1: Foundation (Types, Module, Migration, Middleware)

### Task 1: Add admin types to shared types package

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add PlatformStats type**

Append after the `CollectionRatePoint` interface at the end of the file:

```typescript
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
```

- [ ] **Step 2: Add OrganizationListItem type**

```typescript
export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  created_at: string;
  member_count: number;
  property_count: number;
}
```

- [ ] **Step 3: Add UserListItem type**

```typescript
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
```

- [ ] **Step 4: Add OrgDetail type**

```typescript
export interface OrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    created_at: string;
    settings: Record<string, unknown>;
  };
  members: Array<{
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    role: string;
    status: string;
    joined_at: string | null;
  }>;
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
```

- [ ] **Step 5: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to the new types

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat(admin): add PlatformStats, OrganizationListItem, UserListItem, OrgDetail types"
```

---

### Task 2: Create admin module scaffolding

**Files:**
- Create: `modules/admin/package.json`
- Create: `modules/admin/tsconfig.json`
- Create: `modules/admin/src/index.ts`

- [ ] **Step 1: Create module package.json**

Create `modules/admin/package.json`:

```json
{
  "name": "@onereal/admin",
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
    "next": "^15.0.0"
  },
  "devDependencies": {
    "next": "^15.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create module tsconfig.json**

Create `modules/admin/tsconfig.json`:

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

- [ ] **Step 3: Create module index.ts**

Create `modules/admin/src/index.ts`:

```typescript
// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { getPlatformStats } from '@onereal/admin/actions/get-platform-stats';
```

- [ ] **Step 4: Install dependencies**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm install`
Expected: Resolves workspace dependencies for `@onereal/admin`

- [ ] **Step 5: Verify type-check**

Run: `cd modules/admin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add modules/admin/
git commit -m "feat(admin): scaffold admin module with package.json, tsconfig, index"
```

---

### Task 3: Add is_platform_admin column via Supabase migration

**Files:**
- Create: `supabase/migrations/20260315120000_add_platform_admin_flag.sql`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260315120000_add_platform_admin_flag.sql`:

```sql
-- Add platform admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;

-- Partial index: only index rows where is_platform_admin is true (sparse)
CREATE INDEX IF NOT EXISTS idx_profiles_is_platform_admin
  ON profiles(is_platform_admin) WHERE is_platform_admin = true;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase dashboard (SQL Editor) or CLI:
Run: `npx supabase db push` (if using Supabase CLI with linked project)

If using Supabase dashboard: copy the SQL and run it in the SQL Editor.

- [ ] **Step 3: Set your own user as platform admin**

Run in Supabase SQL Editor (replace with your actual email):
```sql
UPDATE profiles SET is_platform_admin = true WHERE email = '<your-email>';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260315120000_add_platform_admin_flag.sql
git commit -m "feat(admin): add is_platform_admin column to profiles table"
```

---

### Task 4: Update middleware to guard /admin routes

**Files:**
- Modify: `apps/web/middleware.ts` (lines 54-63 for profile query, add admin check block)

- [ ] **Step 1: Extend profile query to include is_platform_admin**

In `apps/web/middleware.ts`, change line 55 (the profile type) from:

```typescript
  let profile: { first_name: string | null; default_org_id: string | null } | null = null;
```

to:

```typescript
  let profile: { first_name: string | null; default_org_id: string | null; is_platform_admin: boolean | null } | null = null;
```

And change line 59 (the select query) from:

```typescript
      .select('first_name, default_org_id')
```

to:

```typescript
      .select('first_name, default_org_id, is_platform_admin')
```

- [ ] **Step 2: Add admin route guard**

After the onboarding check block (after line 70), add:

```typescript
  // Admin route guard
  const isAdminRoute = pathname.startsWith('/admin');
  if (isAdminRoute && user) {
    if (!profile?.is_platform_admin) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    // Platform admin accessing /admin — allow through, skip tenant routing
    return supabaseResponse;
  }
```

- [ ] **Step 3: Verify build**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm build 2>&1 | tail -20`
Expected: Build succeeds (admin pages don't exist yet, but middleware compiles)

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(admin): add /admin route guard checking is_platform_admin in middleware"
```

---

### Task 5: Create admin auth helper for server actions

**Files:**
- Create: `modules/admin/src/actions/require-admin.ts`

This shared helper is used by every admin action to verify the caller is a platform admin.

- [ ] **Step 1: Create the helper**

Create `modules/admin/src/actions/require-admin.ts`:

```typescript
import { createServerSupabaseClient } from '@onereal/database/server';

/**
 * Verifies the current user is a platform admin.
 * Returns the user ID if authorized, throws ActionResult-style error object if not.
 */
export async function requireAdmin(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_platform_admin) {
    throw new Error('Not authorized — platform admin required');
  }

  return user.id;
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/require-admin.ts
git commit -m "feat(admin): add requireAdmin() server-side auth helper"
```

---

## Chunk 2: Server Actions (Data Layer)

### Task 6: Implement getPlatformStats action

**Files:**
- Create: `modules/admin/src/actions/get-platform-stats.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/get-platform-stats.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, PlatformStats } from '@onereal/types';

export async function getPlatformStats(): Promise<ActionResult<PlatformStats>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Counts
    const [orgsRes, usersRes, propsRes, unitsRes] = await Promise.all([
      db.from('organizations').select('id', { count: 'exact', head: true }),
      db.from('profiles').select('id', { count: 'exact', head: true }),
      db.from('properties').select('id', { count: 'exact', head: true }),
      db.from('units').select('id', { count: 'exact', head: true }),
    ]);

    // Recent signups (last 5 profiles)
    const { data: recentSignups } = await db
      .from('profiles')
      .select('id, email, first_name, last_name, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Recent organizations (last 5 with member count)
    const { data: recentOrgs } = await db
      .from('organizations')
      .select('id, name, type, created_at, org_members(count)')
      .order('created_at', { ascending: false })
      .limit(5);

    const stats: PlatformStats = {
      total_organizations: orgsRes.count ?? 0,
      total_users: usersRes.count ?? 0,
      total_properties: propsRes.count ?? 0,
      total_units: unitsRes.count ?? 0,
      recent_signups: (recentSignups ?? []).map((p: any) => ({
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        created_at: p.created_at,
      })),
      recent_organizations: (recentOrgs ?? []).map((o: any) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        created_at: o.created_at,
        member_count: o.org_members?.[0]?.count ?? 0,
      })),
    };

    return { success: true, data: stats };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to fetch platform stats' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/get-platform-stats.ts
git commit -m "feat(admin): add getPlatformStats server action"
```

---

### Task 7: Implement listOrganizations action

**Files:**
- Create: `modules/admin/src/actions/list-organizations.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/list-organizations.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, OrganizationListItem } from '@onereal/types';

interface ListOrgsParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListOrgsResult {
  items: OrganizationListItem[];
  total: number;
}

export async function listOrganizations(
  params: ListOrgsParams = {}
): Promise<ActionResult<ListOrgsResult>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();
    const { search, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // Get total count
    let countQuery = db
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { count } = await countQuery;

    // Get page of orgs with member + property counts
    let query = db
      .from('organizations')
      .select('id, name, slug, type, created_at, org_members(count), properties(count)')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const items: OrganizationListItem[] = (data ?? []).map((o: any) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      created_at: o.created_at,
      member_count: o.org_members?.[0]?.count ?? 0,
      property_count: o.properties?.[0]?.count ?? 0,
    }));

    return { success: true, data: { items, total: count ?? 0 } };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list organizations' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/list-organizations.ts
git commit -m "feat(admin): add listOrganizations server action with search/pagination"
```

---

### Task 8: Implement listUsers action

**Files:**
- Create: `modules/admin/src/actions/list-users.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/list-users.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, UserListItem } from '@onereal/types';

interface ListUsersParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListUsersResult {
  items: UserListItem[];
  total: number;
}

export async function listUsers(
  params: ListUsersParams = {}
): Promise<ActionResult<ListUsersResult>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();
    const { search, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // Count
    let countQuery = db
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
      );
    }

    const { count } = await countQuery;

    // Get profiles with org membership count and default_org role (single query)
    let query = db
      .from('profiles')
      .select('id, email, first_name, last_name, avatar_url, is_platform_admin, created_at, default_org_id, org_members(count)')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    // Batch-fetch primary roles for all users with a default_org_id
    const userIds = (data ?? []).map((p: any) => p.id);
    const defaultOrgIds = (data ?? [])
      .filter((p: any) => p.default_org_id)
      .map((p: any) => ({ userId: p.id, orgId: p.default_org_id }));

    const roleMap = new Map<string, string>();
    if (defaultOrgIds.length > 0) {
      // Fetch all relevant memberships in a single query
      const { data: memberships } = await db
        .from('org_members')
        .select('user_id, org_id, role')
        .in('user_id', defaultOrgIds.map((d) => d.userId));

      for (const m of memberships ?? []) {
        const match = defaultOrgIds.find(
          (d) => d.userId === (m as any).user_id && d.orgId === (m as any).org_id
        );
        if (match) {
          roleMap.set((m as any).user_id, (m as any).role);
        }
      }
    }

    // Fetch ban status from Supabase Auth Admin API
    const banMap = new Map<string, boolean>();
    const { data: authUsers } = await db.auth.admin.listUsers({
      page: 1,
      perPage: 1000, // Fetch all auth users (sufficient for early-stage platform)
    });

    for (const authUser of authUsers?.users ?? []) {
      // Supabase sets banned_until to a future date when banned
      const isBanned = authUser.banned_until
        ? new Date(authUser.banned_until) > new Date()
        : false;
      banMap.set(authUser.id, isBanned);
    }

    const items: UserListItem[] = (data ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      first_name: p.first_name,
      last_name: p.last_name,
      avatar_url: p.avatar_url,
      is_platform_admin: p.is_platform_admin ?? false,
      banned: banMap.get(p.id) ?? false,
      created_at: p.created_at,
      org_count: p.org_members?.[0]?.count ?? 0,
      primary_role: roleMap.get(p.id) ?? null,
    }));

    return { success: true, data: { items, total: count ?? 0 } };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list users' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/list-users.ts
git commit -m "feat(admin): add listUsers server action with search/pagination"
```

---

### Task 9: Implement getOrgDetails action

**Files:**
- Create: `modules/admin/src/actions/get-org-details.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/get-org-details.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, OrgDetail } from '@onereal/types';

export async function getOrgDetails(
  orgId: string
): Promise<ActionResult<OrgDetail>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Fetch organization
    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('id, name, slug, type, created_at, settings')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'Organization not found' };
    }

    // Fetch members with profile info
    const { data: membersRaw } = await db
      .from('org_members')
      .select('user_id, role, status, joined_at, profiles(email, first_name, last_name)')
      .eq('org_id', orgId)
      .order('joined_at', { ascending: false });

    const members = (membersRaw ?? []).map((m: any) => ({
      user_id: m.user_id,
      email: m.profiles?.email ?? null,
      first_name: m.profiles?.first_name ?? null,
      last_name: m.profiles?.last_name ?? null,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
    }));

    // Fetch properties with unit counts
    const { data: propsRaw } = await db
      .from('properties')
      .select('id, name, type, status, city, state, units(count)')
      .eq('org_id', orgId)
      .order('name', { ascending: true });

    const properties = (propsRaw ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      city: p.city,
      state: p.state,
      unit_count: p.units?.[0]?.count ?? 0,
    }));

    // Compute stats
    const totalUnits = properties.reduce((sum: number, p: any) => sum + p.unit_count, 0);

    // Get occupied units count
    const { count: occupiedCount } = await db
      .from('units')
      .select('id', { count: 'exact', head: true })
      .in('property_id', properties.map((p: any) => p.id))
      .eq('status', 'occupied');

    const result: OrgDetail = {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        created_at: org.created_at,
        settings: (org as any).settings ?? {},
      },
      members,
      properties,
      stats: {
        member_count: members.length,
        property_count: properties.length,
        unit_count: totalUnits,
        occupied_units: occupiedCount ?? 0,
      },
    };

    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to fetch organization details' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/get-org-details.ts
git commit -m "feat(admin): add getOrgDetails server action"
```

---

### Task 10: Implement toggleUserStatus action

**Files:**
- Create: `modules/admin/src/actions/toggle-user-status.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/toggle-user-status.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function toggleUserStatus(
  userId: string,
  ban: boolean
): Promise<ActionResult> {
  try {
    const adminUserId = await requireAdmin();

    // Prevent self-disable
    if (userId === adminUserId) {
      return { success: false, error: 'Cannot disable your own account' };
    }

    const db = createServiceRoleClient();

    // Ban or unban via Supabase Admin API
    if (ban) {
      const { error } = await db.auth.admin.updateUserById(userId, {
        ban_duration: '876000h', // ~100 years = effectively permanent
      });
      if (error) throw error;
    } else {
      const { error } = await db.auth.admin.updateUserById(userId, {
        ban_duration: 'none',
      });
      if (error) throw error;
    }

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update user status' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/toggle-user-status.ts
git commit -m "feat(admin): add toggleUserStatus server action with self-disable guard"
```

---

### Task 11: Implement deleteOrganization action

**Files:**
- Create: `modules/admin/src/actions/delete-organization.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/delete-organization.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deleteOrganization(
  orgId: string
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Verify org exists
    const { data: org, error: fetchError } = await db
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single();

    if (fetchError || !org) {
      return { success: false, error: 'Organization not found' };
    }

    // Delete the organization — ON DELETE CASCADE handles all child records
    const { error } = await db
      .from('organizations')
      .delete()
      .eq('id', orgId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete organization' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/delete-organization.ts
git commit -m "feat(admin): add deleteOrganization server action"
```

---

### Task 12: Implement deleteUser action

**Files:**
- Create: `modules/admin/src/actions/delete-user.ts`

- [ ] **Step 1: Create the action**

Create `modules/admin/src/actions/delete-user.ts`:

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deleteUser(
  userId: string
): Promise<ActionResult> {
  try {
    const adminUserId = await requireAdmin();

    // Prevent self-delete
    if (userId === adminUserId) {
      return { success: false, error: 'Cannot delete your own account' };
    }

    const db = createServiceRoleClient();

    // Check if user has a personal org where they're the sole member
    const { data: memberships } = await db
      .from('org_members')
      .select('org_id, organizations(type)')
      .eq('user_id', userId);

    for (const m of memberships ?? []) {
      const orgType = (m as any).organizations?.type;
      if (orgType === 'personal') {
        // Check if sole member
        const { count } = await db
          .from('org_members')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', m.org_id);

        if (count === 1) {
          // Delete the personal org (cascades to all its data)
          await db.from('organizations').delete().eq('id', m.org_id);
        }
      }
    }

    // Remove from all remaining org_members
    await db.from('org_members').delete().eq('user_id', userId);

    // Delete profile
    await db.from('profiles').delete().eq('id', userId);

    // Delete auth user
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete user' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/admin/src/actions/delete-user.ts
git commit -m "feat(admin): add deleteUser server action with personal org cleanup"
```

---

### Task 13: Create admin sidebar component

**Files:**
- Create: `apps/web/components/admin/admin-sidebar.tsx`

- [ ] **Step 1: Create the admin sidebar**

Create `apps/web/components/admin/admin-sidebar.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@onereal/ui';
import { LayoutDashboard, Building2, Users, ArrowLeft } from 'lucide-react';

const adminNavItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Organizations', href: '/admin/organizations', icon: Building2 },
  { label: 'Users', href: '/admin/users', icon: Users },
];

export function AdminSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden h-screen w-[240px] border-r bg-card md:block">
      <div className="flex h-full flex-col gap-2 p-3">
        {/* Branding */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-lg font-bold">OneReal</span>
          <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
            Admin
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-1">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Back to app */}
        <nav className="flex flex-col gap-1 border-t pt-2">
          <Link
            href="/"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span>Back to App</span>
          </Link>
        </nav>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/admin-sidebar.tsx
git commit -m "feat(admin): add AdminSidebar component"
```

---

## Chunk 3: UI Pages and Layout

### Task 14: Create admin layout

**Files:**
- Create: `apps/web/app/(admin)/admin/layout.tsx`

- [ ] **Step 1: Create the layout**

Create `apps/web/app/(admin)/admin/layout.tsx`:

```typescript
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { UserMenu } from '@/components/dashboard/user-menu';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm font-medium text-muted-foreground">Platform Admin</span>
          <UserMenu />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(admin)/admin/layout.tsx
git commit -m "feat(admin): add admin layout with sidebar and topbar"
```

---

### Task 15: Create confirm dialog component

**Files:**
- Create: `apps/web/components/admin/confirm-dialog.tsx`

This is a reusable confirmation dialog that requires typing the entity name to confirm destructive actions.

- [ ] **Step 1: Create the component**

Create `apps/web/components/admin/confirm-dialog.tsx`:

```typescript
'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Input,
} from '@onereal/ui';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'destructive' | 'default';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  onConfirm,
  variant = 'destructive',
}: ConfirmDialogProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const isMatch = input.trim().toLowerCase() === confirmText.trim().toLowerCase();

  async function handleConfirm() {
    if (!isMatch) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      setInput('');
      onOpenChange(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) setInput('');
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm:
          </p>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={confirmText}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={!isMatch || loading}
          >
            {loading ? 'Deleting...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/confirm-dialog.tsx
git commit -m "feat(admin): add ConfirmDialog component with typed confirmation"
```

---

### Task 16: Create admin dashboard page

**Files:**
- Create: `apps/web/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `apps/web/app/(admin)/admin/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { getPlatformStats } from '@onereal/admin/actions/get-platform-stats';
import {
  Card, CardContent, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge,
} from '@onereal/ui';
import { Building2, Users, Home, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import type { PlatformStats } from '@onereal/types';

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlatformStats().then((result) => {
      if (result.success) setStats(result.data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!stats) {
    return <p className="text-sm text-destructive">Failed to load platform stats.</p>;
  }

  const statCards = [
    { label: 'Organizations', value: stats.total_organizations, icon: Building2 },
    { label: 'Users', value: stats.total_users, icon: Users },
    { label: 'Properties', value: stats.total_properties, icon: Home },
    { label: 'Units', value: stats.total_units, icon: DoorOpen },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform Dashboard</h1>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{card.value.toLocaleString()}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent signups */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Signups</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recent_signups.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.first_name} {user.last_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {stats.recent_signups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No signups yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent organizations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Organizations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recent_organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="font-medium hover:underline"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {org.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{org.member_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {stats.recent_organizations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No organizations yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(admin)/admin/page.tsx
git commit -m "feat(admin): add admin dashboard page with stats and recent activity"
```

---

### Task 17: Create organizations list page

**Files:**
- Create: `apps/web/app/(admin)/admin/organizations/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/app/(admin)/admin/organizations/page.tsx`:

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { listOrganizations } from '@onereal/admin/actions/list-organizations';
import {
  Input, Badge, Button,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import type { OrganizationListItem } from '@onereal/types';

export default function AdminOrganizationsPage() {
  const [items, setItems] = useState<OrganizationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await listOrganizations({ search: search || undefined, page, pageSize });
    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Organizations</h1>

      <Input
        placeholder="Search organizations..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No organizations found</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Properties</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{org.type}</Badge>
                    </TableCell>
                    <TableCell>{org.member_count}</TableCell>
                    <TableCell>{org.property_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/organizations/${org.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(admin)/admin/organizations/page.tsx
git commit -m "feat(admin): add organizations list page with search and pagination"
```

---

### Task 18: Create organization detail page

**Files:**
- Create: `apps/web/app/(admin)/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/app/(admin)/admin/organizations/[id]/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getOrgDetails } from '@onereal/admin/actions/get-org-details';
import { deleteOrganization } from '@onereal/admin/actions/delete-organization';
import {
  Card, CardContent, CardHeader, CardTitle,
  Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { ArrowLeft, Building2, Users, Home, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { OrgDetail } from '@onereal/types';

export default function AdminOrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    getOrgDetails(orgId).then((result) => {
      if (result.success) setData(result.data);
      setLoading(false);
    });
  }, [orgId]);

  async function handleDelete() {
    const result = await deleteOrganization(orgId);
    if (result.success) {
      toast.success('Organization deleted');
      router.push('/admin/organizations');
    } else {
      toast.error(result.error);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!data) return <p className="text-sm text-destructive">Organization not found.</p>;

  const { organization: org, members, properties, stats } = data;
  const occupancyRate = stats.unit_count > 0
    ? Math.round((stats.occupied_units / stats.unit_count) * 100)
    : 0;

  const statCards = [
    { label: 'Members', value: stats.member_count, icon: Users },
    { label: 'Properties', value: stats.property_count, icon: Building2 },
    { label: 'Units', value: stats.unit_count, icon: Home },
    { label: 'Occupancy', value: `${occupancyRate}%`, icon: DoorOpen },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/organizations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <Badge variant="secondary">{org.type}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {new Date(org.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="properties">Properties ({properties.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {m.first_name} {m.last_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.status === 'active' ? 'default' : 'secondary'}>
                        {m.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No members
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="properties" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.type.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[p.city, p.state].filter(Boolean).join(', ') || '\u2014'}
                    </TableCell>
                    <TableCell>{p.unit_count}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {properties.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No properties
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this organization</p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete the organization and all its data.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete Organization
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Organization"
        description={`This will permanently delete "${org.name}" and all associated data (members, properties, leases, invoices). This action cannot be undone.`}
        confirmText={org.name}
        onConfirm={handleDelete}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(admin)/admin/organizations/[id]/page.tsx
git commit -m "feat(admin): add organization detail page with members, properties, delete"
```

---

### Task 19: Create users list page

**Files:**
- Create: `apps/web/app/(admin)/admin/users/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/app/(admin)/admin/users/page.tsx`:

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { listUsers } from '@onereal/admin/actions/list-users';
import { toggleUserStatus } from '@onereal/admin/actions/toggle-user-status';
import { deleteUser } from '@onereal/admin/actions/delete-user';
import {
  Input, Badge, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { UserListItem } from '@onereal/types';

export default function AdminUsersPage() {
  const [items, setItems] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  // Dialog state
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserListItem | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await listUsers({ search: search || undefined, page, pageSize });
    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  async function handleToggleConfirm() {
    if (!toggleTarget) return;
    setToggling(true);
    // Toggle: if currently banned, unban; if not banned, ban
    const shouldBan = !toggleTarget.banned;
    const result = await toggleUserStatus(toggleTarget.id, shouldBan);
    if (result.success) {
      toast.success(shouldBan ? 'User disabled' : 'User enabled');
      setToggleTarget(null);
      fetchData();
    } else {
      toast.error(result.error);
    }
    setToggling(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteUser(deleteTarget.id);
    if (result.success) {
      toast.success('User deleted');
      setDeleteTarget(null);
      fetchData();
    } else {
      toast.error(result.error);
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>

      <Input
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No users found</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Orgs</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.first_name} {user.last_name}
                      {user.is_platform_admin && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Admin</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {user.primary_role ? (
                        <Badge variant="outline">{user.primary_role}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{'\u2014'}</span>
                      )}
                    </TableCell>
                    <TableCell>{user.org_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.banned ? 'destructive' : 'default'}>
                        {user.banned ? 'Disabled' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setToggleTarget(user)}
                        >
                          {user.banned ? 'Enable' : 'Disable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(user)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Toggle status dialog */}
      {toggleTarget && (
        <Dialog open={!!toggleTarget} onOpenChange={(open) => { if (!open) setToggleTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {toggleTarget.banned ? 'Enable' : 'Disable'} User Account
              </DialogTitle>
              <DialogDescription>
                {toggleTarget.banned
                  ? `This will re-enable the account for "${toggleTarget.first_name} ${toggleTarget.last_name}" (${toggleTarget.email}). They will be able to log in again.`
                  : `This will disable the account for "${toggleTarget.first_name} ${toggleTarget.last_name}" (${toggleTarget.email}). They will not be able to log in.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setToggleTarget(null)} disabled={toggling}>
                Cancel
              </Button>
              <Button
                variant={toggleTarget.banned ? 'default' : 'destructive'}
                onClick={handleToggleConfirm}
                disabled={toggling}
              >
                {toggling ? 'Processing...' : toggleTarget.banned ? 'Enable Account' : 'Disable Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete user dialog */}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete User"
          description={`This will permanently delete the user "${deleteTarget.first_name} ${deleteTarget.last_name}" (${deleteTarget.email}), remove them from all organizations, and delete their personal org if they're the sole member.`}
          confirmText={deleteTarget.email ?? 'delete'}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(admin)/admin/users/page.tsx
git commit -m "feat(admin): add users list page with search, disable, delete"
```

---

### Task 20: Build verification and final commit

**Files:**
- None (verification only)

- [ ] **Step 1: Install dependencies**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm install`
Expected: All workspace dependencies resolve

- [ ] **Step 2: Run build**

Run: `pnpm build 2>&1 | tail -30`
Expected: Build passes with zero errors. Admin pages listed in output:
- `/admin` (dashboard)
- `/admin/organizations` (list)
- `/admin/organizations/[id]` (detail)
- `/admin/users` (list)

- [ ] **Step 3: Fix any build errors**

If TypeScript errors appear (e.g., property mismatches on `as any` casts, missing imports), fix them in the affected files and re-run build.

- [ ] **Step 4: Manual testing checklist**

1. Set `is_platform_admin = true` for your user in Supabase
2. Navigate to `/admin` — should see dashboard with stats
3. Navigate to `/admin/organizations` — should see org list with search
4. Click "View" on an org — should see detail page with members/properties tabs
5. Navigate to `/admin/users` — should see user list with Active/Disabled badges
6. Click "Disable" on a user — confirmation dialog appears, user becomes "Disabled"
7. Click "Enable" on disabled user — confirmation dialog, user becomes "Active" again
8. Click "Delete" on a user — typed confirmation dialog appears, user removed from list
9. On org detail page, click "Delete Organization" — typed confirmation, redirects to list
10. Log out, log in as a non-admin user, navigate to `/admin` — should redirect to `/`

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(admin): resolve build errors from verification"
```

# Super Admin Interface — Design Spec

> **Status:** Approved
> **Date:** 2026-03-15
> **Scope:** Platform admin dashboard for OneReal (Phase 1: Admin Dashboard only; billing/plans deferred)

---

## 1. Purpose

OneReal needs a platform-level admin interface that sits above the org-scoped dashboard. This allows the platform owner to see all registered accounts, organizations, and platform-wide statistics — and to perform admin actions like disabling accounts or deleting organizations.

**What's in scope:**
- Platform admin dashboard with aggregate stats
- Organization listing and detail views
- User/profile listing with status management
- Admin actions: view details, disable/enable accounts, delete org/user

**What's NOT in scope (deferred):**
- Subscription plans and billing
- Revenue tracking / monetization features
- Impersonation ("log in as user")

---

## 2. Admin Identity

### Approach: `is_platform_admin` flag on `profiles` table

A boolean column `is_platform_admin` (default `false`) on the existing `profiles` table. This is the simplest approach — no new tables, no new role enums, no changes to the org-scoped role system.

**Why not a separate `platform_admins` table?**
- One extra join on every admin check with no real benefit.
- A single boolean is easy to query, easy to set, and easy to check in middleware.

**Why not hardcoded emails?**
- Can't manage admin access without code deploys.
- The boolean flag can be toggled via Supabase dashboard or a future admin management UI.

### Database Migration

```sql
ALTER TABLE profiles ADD COLUMN is_platform_admin BOOLEAN DEFAULT false;
```

Set the initial admin manually:
```sql
UPDATE profiles SET is_platform_admin = true WHERE email = 'admin@onereal.com';
```

---

## 3. Architecture

### Route Structure

```
apps/web/app/
├── (admin)/
│   └── admin/
│       ├── layout.tsx              # Admin layout (admin sidebar + topbar)
│       ├── page.tsx                # Admin dashboard (stats, recent activity)
│       ├── organizations/
│       │   ├── page.tsx            # Organizations list
│       │   └── [id]/
│       │       └── page.tsx        # Organization detail (members, properties)
│       └── users/
│           └── page.tsx            # Users list
```

### Layout

The admin interface has its own layout, completely separate from the `(dashboard)` layout. This includes:

- **Admin sidebar** with:
  - "OneReal Admin" branding (distinct from "OneReal")
  - Dashboard link
  - Organizations link
  - Users link
  - Divider
  - "Back to App" link (navigates to `/`)
- **Admin topbar** with:
  - "Platform Admin" label
  - User avatar/menu (reuse existing)

### Middleware Guard

Update `apps/web/middleware.ts` to check admin routes:

```
If pathname starts with '/admin':
  1. Get user session (already done in middleware)
  2. Fetch profile with is_platform_admin
  3. If not platform admin → redirect to '/'
```

This keeps the check server-side and prevents non-admins from even loading admin pages.

### Data Access: Service Role Client

All admin queries use `createServiceRoleClient()` from `packages/database/src/service-role.ts` (already exists, used by tenant invite flow). This bypasses all RLS policies, giving admin read/write access to all orgs.

**Why service role instead of RLS policies?**
- Admin needs to read ALL organizations, ALL profiles — across org boundaries
- Writing org-spanning RLS policies is complex and error-prone
- Service role is already established in the codebase
- Admin actions are server-side only (server actions), so the service role key is never exposed to the client

---

## 4. Admin Module

### Module Structure

```
modules/admin/
├── src/
│   ├── actions/
│   │   ├── get-platform-stats.ts
│   │   ├── list-organizations.ts
│   │   ├── list-users.ts
│   │   ├── get-org-details.ts
│   │   ├── toggle-user-status.ts
│   │   ├── delete-organization.ts
│   │   └── delete-user.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

Every action is a Next.js server action (`'use server'`) that:
1. Checks the caller is a platform admin (re-verify server-side, don't trust middleware alone)
2. Uses `createServiceRoleClient()` to query Supabase
3. Returns typed data

### Server Actions

#### `getPlatformStats()`
Returns aggregate platform statistics:
```typescript
interface PlatformStats {
  total_organizations: number;
  total_users: number;
  total_properties: number;
  total_units: number;
  recent_signups: Array<{
    id: string;
    email: string;
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

Queries:
- `SELECT COUNT(*) FROM organizations`
- `SELECT COUNT(*) FROM profiles`
- `SELECT COUNT(*) FROM properties`
- `SELECT COUNT(*) FROM units`
- `SELECT * FROM profiles ORDER BY created_at DESC LIMIT 5`
- `SELECT o.*, (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) as member_count FROM organizations ORDER BY created_at DESC LIMIT 5`

#### `listOrganizations(search?, page?, pageSize?)`
Returns paginated list of all organizations with member counts.

```typescript
interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  created_at: string;
  member_count: number;
  property_count: number;
}
```

Queries:
- Fetch organizations with LEFT JOIN counts for members and properties
- Optional `ilike` filter on name/slug
- Paginated with offset/limit

#### `listUsers(search?, page?, pageSize?)`
Returns paginated list of all user profiles.

```typescript
interface UserListItem {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  created_at: string;
  org_count: number;
  primary_role: string | null;
}
```

Queries:
- Fetch profiles with org membership count
- Primary role = role from their default_org membership
- Optional `ilike` filter on email/first_name/last_name

#### `getOrgDetails(orgId)`
Returns full organization detail including members, properties, and stats.

```typescript
interface OrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    created_at: string;
    settings: any;
  };
  members: Array<{
    user_id: string;
    email: string;
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

#### `toggleUserStatus(userId, disabled)`
Disables or enables a user account. This uses the Supabase Admin API (`auth.admin.updateUserById`) to ban/unban the auth user. A banned user cannot log in.

#### `deleteOrganization(orgId)`
Deletes an organization and all associated data. Uses cascading deletes (foreign key constraints handle this). Requires confirmation in the UI (double-confirm dialog).

**Steps:**
1. Delete all org_members for the org
2. Delete all properties (cascades to units, property_images)
3. Delete all leases, invoices, income, expenses for the org
4. Delete the organization itself

#### `deleteUser(userId)`
Deletes a user profile and their auth account.

**Steps:**
1. Remove from all org_members
2. Delete profile
3. Delete auth user via `auth.admin.deleteUser(userId)`

---

## 5. UI Components

### Admin Dashboard Page (`/admin`)

**Layout:**
- 4 stat cards across the top: Total Organizations, Total Users, Total Properties, Total Units
- Two-column grid below:
  - Left: "Recent Signups" — table with name, email, date (last 5)
  - Right: "Recent Organizations" — table with name, type, members, date (last 5)

### Organizations Page (`/admin/organizations`)

**Layout:**
- Search input at top
- Data table with columns: Name, Type, Members, Properties, Created, Actions
- Actions column: "View" button → navigates to `/admin/organizations/[id]`
- Pagination at bottom

### Organization Detail Page (`/admin/organizations/[id]`)

**Layout:**
- Header: Org name, type badge, created date
- Stats row: Members, Properties, Units, Occupancy
- Two tabs:
  - **Members**: table with name, email, role, status
  - **Properties**: table with name, type, city/state, units, status

- Danger zone at bottom:
  - "Delete Organization" button (red, with confirmation dialog)

### Users Page (`/admin/users`)

**Layout:**
- Search input at top
- Data table with columns: Name, Email, Role (primary), Orgs, Created, Status, Actions
- Status: Active/Disabled badge
- Actions: "Disable" / "Enable" toggle button, "Delete" button
- Both actions require confirmation dialog
- Pagination at bottom

---

## 6. Security Considerations

1. **Double-gate admin access:**
   - Middleware redirects non-admins from `/admin` routes (prevents page load)
   - Every server action re-checks `is_platform_admin` before executing (defense in depth)

2. **Service role key safety:**
   - `SUPABASE_SERVICE_ROLE_KEY` is server-only (not prefixed with `NEXT_PUBLIC_`)
   - Only used inside server actions, never exposed to client

3. **Destructive action safety:**
   - Delete actions require confirmation dialogs with org/user name typed to confirm
   - Toggle disable/enable shows clear status change before confirming

4. **Audit trail (future):**
   - For now, admin actions are not logged beyond Supabase's built-in audit
   - Future: add an `admin_audit_log` table to track who did what

---

## 7. Files to Create

| File | Purpose |
|------|---------|
| `modules/admin/package.json` | Module package config |
| `modules/admin/tsconfig.json` | TypeScript config |
| `modules/admin/src/index.ts` | Public exports |
| `modules/admin/src/actions/get-platform-stats.ts` | Aggregate stats query |
| `modules/admin/src/actions/list-organizations.ts` | Paginated org list |
| `modules/admin/src/actions/list-users.ts` | Paginated user list |
| `modules/admin/src/actions/get-org-details.ts` | Full org detail |
| `modules/admin/src/actions/toggle-user-status.ts` | Ban/unban user |
| `modules/admin/src/actions/delete-organization.ts` | Delete org + cascade |
| `modules/admin/src/actions/delete-user.ts` | Delete user + auth cleanup |
| `apps/web/app/(admin)/admin/layout.tsx` | Admin layout with sidebar |
| `apps/web/app/(admin)/admin/page.tsx` | Admin dashboard |
| `apps/web/app/(admin)/admin/organizations/page.tsx` | Organizations list |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Organization detail |
| `apps/web/app/(admin)/admin/users/page.tsx` | Users list |
| `apps/web/components/admin/admin-sidebar.tsx` | Admin sidebar navigation |
| `apps/web/components/admin/stat-cards.tsx` | Dashboard stat cards |
| `apps/web/components/admin/confirm-dialog.tsx` | Reusable confirmation dialog |

## 8. Files to Modify

| File | Change |
|------|--------|
| `apps/web/middleware.ts` | Add `/admin` route guard checking `is_platform_admin` |
| `packages/types/src/models.ts` | Add `PlatformStats`, `OrganizationListItem`, `UserListItem`, `OrgDetail` types |

## 9. Database Migration

Single migration file:

```sql
-- Add platform admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_platform_admin ON profiles(is_platform_admin) WHERE is_platform_admin = true;
```

---

## 10. Verification

1. **Migration**: `is_platform_admin` column added, set to `true` for test user
2. **Middleware**: Non-admin user navigating to `/admin` gets redirected to `/`
3. **Dashboard**: Shows correct counts for orgs, users, properties, units
4. **Organizations list**: Shows all orgs with search and pagination
5. **Organization detail**: Shows members, properties, and stats for selected org
6. **Users list**: Shows all users with search, status badges, pagination
7. **Disable user**: Toggle disables user account, badge changes to "Disabled"
8. **Delete org**: Confirmation dialog works, org removed from list
9. **Delete user**: Confirmation dialog works, user removed from list
10. **Build**: `pnpm build` passes with zero errors

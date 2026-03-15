# Phase 5A: Tenant Portal — Invite, Registration & Portal

## Overview

Enable tenants to access a self-service portal where they can view their lease details and payment history. Landlords invite tenants via email; tenants register through a Supabase magic link and get a role-restricted view of the app.

**Scope:** Invite flow, tenant registration/linking, tenant portal UI (Home, My Lease, Payments). Maintenance requests and online payments are deferred to later phases.

## Architecture Decision

**Approach: Add `user_id` to tenants table.**

Tenants are currently plain contact records with no link to auth users. We add a nullable `user_id` column to the existing `tenants` table. When a tenant accepts an invite, their Supabase auth user ID gets written here. Combined with `org_members` (role='tenant'), this provides both the data link and access control.

Alternatives considered and rejected:
- **org_members only** (email-based correlation) — fragile, no FK relationship
- **Bridge table** (`tenant_users`) — extra join everywhere for no benefit

## Database Changes

### Migration: `20260315000013_tenant_portal.sql`

```sql
-- 1. Add user_id and invited_at to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- Unique index: one user per tenant record
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_user_id
  ON public.tenants(user_id) WHERE user_id IS NOT NULL;

-- Unique partial index: prevent duplicate emails per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_org_email
  ON public.tenants(org_id, email) WHERE email IS NOT NULL;

-- 2. RLS helper function for tenant data scoping
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
-- Tenants must NOT see all org data through the org-wide SELECT policies.
-- Instead, tenant-specific policies (below) scope access to their own records only.
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

-- 4. RLS policies so tenants can see their own org_members and organizations
-- (Required because get_user_org_ids() now excludes tenant memberships,
--  but tenants still need to see their org for useUser/OrgSwitcher to work)
CREATE POLICY "Users can view own memberships"
  ON public.org_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view orgs they belong to"
  ON public.organizations FOR SELECT
  USING (id IN (
    SELECT org_id FROM public.org_members
    WHERE user_id = auth.uid() AND status = 'active'
  ));

-- 5. Tenant invite detection function (SECURITY DEFINER to bypass RLS)
-- Called during onboarding to check if the current user was invited as a tenant
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

-- 6. RLS policies for tenant self-service (read-only)

-- Tenants can view their own tenant record
CREATE POLICY "Tenants can view own record"
  ON public.tenants FOR SELECT
  USING (user_id = auth.uid());

-- Tenants can view their own leases
CREATE POLICY "Tenants can view own leases"
  ON public.leases FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

-- Tenants can view their own invoices (via lease)
CREATE POLICY "Tenants can view own invoices"
  ON public.invoices FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

-- Tenants can view their own lease charges
CREATE POLICY "Tenants can view own lease charges"
  ON public.lease_charges FOR SELECT
  USING (lease_id IN (SELECT public.get_tenant_lease_ids()));

-- Tenants can view unit info for their leases
CREATE POLICY "Tenants can view own units"
  ON public.units FOR SELECT
  USING (
    id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
  );

-- Tenants can view property info for their units
CREATE POLICY "Tenants can view own properties"
  ON public.properties FOR SELECT
  USING (
    id IN (
      SELECT property_id FROM public.units
      WHERE id IN (SELECT unit_id FROM public.leases WHERE id IN (SELECT public.get_tenant_lease_ids()))
    )
  );

-- 7. Index on tenants.email for linking RPC performance
CREATE INDEX IF NOT EXISTS idx_tenants_email
  ON public.tenants(email) WHERE email IS NOT NULL;

-- 8. Tenant linking function: called after tenant completes onboarding
-- Matches auth.users.email → tenants.email, sets user_id, creates org_members
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

  -- Get user's email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users WHERE id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN;
  END IF;

  -- Find all tenant records with matching email that have invited_at set but no user_id yet
  FOR v_tenant IN
    SELECT id, org_id FROM public.tenants
    WHERE email = v_user_email
      AND invited_at IS NOT NULL
      AND user_id IS NULL
  LOOP
    -- Link the tenant record to this user
    UPDATE public.tenants SET user_id = v_user_id WHERE id = v_tenant.id;

    -- Create org_members row (skip if already exists)
    INSERT INTO public.org_members (org_id, user_id, role, status, joined_at)
    VALUES (v_tenant.org_id, v_user_id, 'tenant', 'active', now())
    ON CONFLICT (org_id, user_id) DO NOTHING;

    -- Set default_org_id if not already set to a non-personal org
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

### Key Design Decisions

**RLS security**: The existing `get_user_org_ids()` function is modified to exclude `role='tenant'` memberships. This prevents tenants from seeing all org data through existing org-wide SELECT policies. Instead, tenants only access data through the new tenant-specific policies that scope access to their own records. Separate policies on `org_members` and `organizations` ensure tenants can still see their own membership and org info (needed for `useUser()` and `OrgSwitcher`).

**Linking function**: `link_tenant_on_invite()` is an RPC function called explicitly after onboarding completes (not a trigger). This gives us control over when linking happens and avoids race conditions with the existing `handle_new_profile()` trigger.

**Helper function**: `get_tenant_lease_ids()` is a SECURITY DEFINER function that returns the lease IDs belonging to the current tenant user. This avoids deeply nested subqueries in RLS policies and improves performance.

**Tenant detection**: `check_is_invited_tenant()` is a SECURITY DEFINER function that checks if the current user's email matches an invited tenant record. This is needed because the tenant user has no RLS access to the `tenants` table before linking (their `user_id` hasn't been set yet).

**search_path security**: All SECURITY DEFINER functions use `SET search_path = ''` (empty string) to prevent search_path hijacking attacks, consistent with existing helper functions.

## Invite & Registration Flow

### Landlord Side

1. Landlord navigates to tenant detail page (`/contacts/tenants/[id]`)
2. UI shows invite status based on tenant state:
   - `email IS NULL` → No button, tooltip: "Add email to invite"
   - `email IS NOT NULL` AND `user_id IS NULL` AND `invited_at IS NULL` → **"Invite to Portal"** button
   - `email IS NOT NULL` AND `user_id IS NULL` AND `invited_at IS NOT NULL` → **"Invite Pending"** badge + "Resend" button
   - `user_id IS NOT NULL` → **"Portal Active"** green badge
3. Clicking "Invite to Portal" triggers the `inviteTenant` server action

### Invite Server Action

```
inviteTenant(tenantId: string)
```

1. Validate caller is a manager of the tenant's org
2. Fetch tenant record, confirm email exists and user_id is null
3. Call `supabase.auth.admin.inviteUserByEmail(tenant.email, { redirectTo: SITE_URL + '/auth/callback' })` using the service role client
4. Set `tenants.invited_at = now()`
5. Return success

**Requires:** `SUPABASE_SERVICE_ROLE_KEY` environment variable for admin API access. This is a server-only action.

### Tenant Side

1. Tenant receives Supabase magic link email
2. Clicks link → hits `/auth/callback` → Supabase creates/confirms the auth user
3. The existing `handle_new_user()` trigger creates a `profiles` row
4. The existing `handle_new_profile()` trigger creates a personal org (this is expected and harmless)
5. Redirected to `/onboarding` to complete their profile (name)
6. **Onboarding is modified**: If the user has a matching `tenants.email` with `invited_at IS NOT NULL`, skip step 2 (org selection). Only show the name input step.
7. After onboarding saves the profile name, the client calls `supabase.rpc('link_tenant_on_invite')` which:
   - Matches `auth.users.email` with `tenants.email` where `invited_at IS NOT NULL`
   - Sets `tenants.user_id = auth.uid()`
   - Creates `org_members` row with `role='tenant'`, `status='active'`
   - Updates `profiles.default_org_id` to the landlord's org (overriding the personal org)
8. On next page load, middleware detects `role='tenant'` → redirects to `/tenant`

### Edge Cases

- **Tenant has no email** → "Invite to Portal" button is hidden, tooltip says "Add email first"
- **Tenant already has a Supabase account** (same email, registered as landlord): The linking RPC adds the tenant role to their existing account. They can switch between landlord and tenant orgs via OrgSwitcher.
- **Multiple orgs invite same tenant email**: The linking RPC loops through all matching tenant records and creates org_members for each org. Tenant can switch orgs.
- **Invite expires**: Landlord can click "Resend" to send a new magic link. Updates `invited_at`.
- **Landlord removes tenant access**: Set `tenants.user_id = NULL`, `tenants.invited_at = NULL`, and delete the `org_members` row. All three must be cleared to fully revoke access and prevent accidental re-linking.
- **Tenant with no active lease**: Portal shows an empty state message: "No active lease found. Contact your landlord."
- **Duplicate email in same org**: Prevented by `idx_tenants_org_email` unique partial index.
- **Tenant invited to multiple orgs**: The first org accepted becomes the default. Tenant can switch orgs via OrgSwitcher.
- **Middleware with NULL default_org_id**: If `profiles.default_org_id` is NULL (e.g., incomplete onboarding), the role defaults to NULL and the user is treated as a non-tenant (landlord view). The existing redirect to `/onboarding` handles this case.

## Middleware & Routing

### Middleware Changes

Current middleware flow: check auth → check profile → allow.

Updated flow:
1. Check auth (existing)
2. Check profile completion (existing)
3. **NEW**: Fetch user's role in their active org (combined with the existing profile query by joining `org_members` on `profiles.default_org_id` to avoid a second round trip)
4. If `role === 'tenant'`:
   - Allow: `/tenant/*`, `/settings/profile`, `/auth/*`, `/onboarding`
   - Redirect everything else → `/tenant`
5. If `role !== 'tenant'`:
   - Allow: all existing routes
   - Redirect `/tenant/*` → `/` (landlords cannot access tenant pages)

### Route Structure

```
apps/web/app/(dashboard)/tenant/
├── page.tsx              # Home: lease summary + recent invoices
├── lease/page.tsx        # My Lease: full lease details + charges
└── payments/page.tsx     # Payments: invoice table with filters
```

All tenant pages are client components using React Query hooks for data fetching. All data access is enforced by RLS — tenant hooks query the same tables as landlord hooks but RLS restricts results to the tenant's own data.

## Sidebar Modification

The existing sidebar component (`apps/web/components/dashboard/sidebar.tsx`) is modified to check the user's role:

**If `role === 'tenant'`**, show:
| Nav Item | Icon | Route |
|----------|------|-------|
| Home | Home | `/tenant` |
| My Lease | FileText | `/tenant/lease` |
| Payments | CreditCard | `/tenant/payments` |
| Maintenance | Wrench | disabled, "Soon" badge |

**If any other role**, show current landlord navigation (unchanged).

## Onboarding Modification

The existing onboarding page (`apps/web/app/(auth)/onboarding/page.tsx`) has two steps:
1. Profile name input
2. Personal vs company org selection

**For invited tenants** (detected by checking if `tenants.email` matches the user's email with `invited_at IS NOT NULL`):
- Show only step 1 (name input)
- Skip step 2 entirely (they don't need to create an org — they'll be linked to the landlord's org)
- After saving, call `supabase.rpc('link_tenant_on_invite')` then redirect to `/tenant`

**Detection method**: After the profile name is saved, call `supabase.rpc('check_is_invited_tenant')`. This SECURITY DEFINER function checks if the user's email matches an invited tenant record (bypasses RLS since the tenant has no data access before linking). If it returns `true`, call the linking RPC and skip step 2.

## Module Structure

### New module: `modules/tenant-portal/`

```
modules/tenant-portal/
├── package.json
└── src/
    ├── actions/
    │   └── invite-tenant.ts       # Server action: send magic link, set invited_at
    ├── hooks/
    │   ├── use-tenant-lease.ts     # Fetch tenant's active lease with unit + property
    │   └── use-tenant-invoices.ts  # Fetch tenant's invoices with status filter
    └── index.ts                    # Barrel exports
```

### Hook Details

**`useTenantLease()`** — no arguments needed, RLS scopes to current user:
- Query: `leases` → join `units(unit_number, property_id, properties(name, address))` → join `lease_charges`
- Filter: `status IN ('active', 'month_to_month')`
- Returns: lease details with property name, unit number, rent, dates, charges

**`useTenantInvoices(filter?: 'open' | 'paid' | 'all')`**:
- Query: `invoices` → join `leases` (for description context)
- Sort: `due_date DESC`
- Filter by status: `open` tab shows `status IN ('open', 'partially_paid')`, `paid` shows `status = 'paid'`
- Returns: invoice list with number, description, amount, due_date, status
- Note: `overdue` is a computed display state (status='open' AND due_date < today), not a DB value

### Invite Action

**`inviteTenant(tenantId: string): Promise<ActionResult>`**:
- Requires service role client (admin API via `SUPABASE_SERVICE_ROLE_KEY`)
- Validates: tenant exists, has email, no user_id, caller is manager
- Calls `supabase.auth.admin.inviteUserByEmail()`
- Updates `tenants.invited_at`

## Tenant Portal Pages

### Home (`/tenant`)
- **Lease summary card**: Property name, unit number, rent amount, lease status, start/end dates
- **Recent invoices** (last 5): Description, amount, due date, status badge (open/paid/overdue)
- **Quick stats**: Total paid this year, next due date, outstanding balance
- **Empty state**: If no active lease, show message: "No active lease found. Contact your landlord."

### My Lease (`/tenant/lease`)
- **Lease info**: Full details — start date, end date, rent amount, deposit, status
- **Property & unit**: Property name, address, unit number
- **Additional charges**: List of active lease charges (name, amount, frequency)
- **Empty state**: If no active lease, same message as Home

### Payments (`/tenant/payments`)
- **Tabs**: Open | Paid | All
- **Table columns**: Invoice #, Description, Amount, Due Date, Status
- **Status badges**: Same color scheme as landlord view — open (blue), paid (green), overdue (red, computed: open + past due_date), void (gray)
- **Empty state**: "No invoices found"

## Types

Update `packages/types/src/models.ts`:

```typescript
// Add to existing Tenant interface
export interface Tenant {
  // ... existing fields
  user_id: string | null;
  invited_at: string | null;
}
```

No new interfaces needed — tenant portal reuses existing `Lease`, `Invoice`, `LeaseCharge` types.

## Security

- **RLS isolation**: `get_user_org_ids()` excludes tenant-role memberships, so tenants cannot see all org data through existing org-wide policies. Tenant-specific RLS policies scope access to their own records only.
- **Read-only access**: Tenant role users can only SELECT. Existing RLS INSERT/UPDATE/DELETE policies require manager roles.
- **Middleware enforcement**: Tenant-role users are blocked from accessing landlord pages at the routing level.
- **Invite authorization**: Only managers can send invites (enforced in server action).
- **Service role key**: Used only server-side for the admin invite API. Never exposed to the client.
- **SECURITY DEFINER functions**: `link_tenant_on_invite()` and `get_tenant_lease_ids()` run with elevated privileges to perform cross-table operations that RLS would otherwise block.

## What's NOT in Scope

- Maintenance requests (Phase 5B)
- Online rent payments (future phase)
- Lease document viewing (future phase)
- Tenant-to-landlord messaging
- Push notifications

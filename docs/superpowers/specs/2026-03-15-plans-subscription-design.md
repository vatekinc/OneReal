# Plans & Subscription Management

> **Status:** Approved
> **Date:** 2026-03-15
> **Scope:** Admin-managed plans system with property limits and feature gating

---

## 1. Problem

All organizations have identical capabilities today. There's no way to:
- Limit how many properties an org can manage (free tier vs paid)
- Gate premium features (Online Payments, Messaging) behind a plan
- Offer different service tiers to different customers

## 2. Solution

A `plans` table where admin creates plans with custom limits and feature flags. Each organization references a plan via `plan_id`. Enforcement happens at the application level when creating properties or accessing gated features.

### What changes:

1. **New `plans` table** — stores plan definitions with limits and features
2. **`organizations.plan_id`** — FK to plans table, NOT NULL, defaults to "Free" plan
3. **Property limit enforcement** — check in `createProperty` action
4. **Feature gating** — middleware + server action checks for gated routes/features
5. **Admin Plans page** — CRUD for plans, plan assignment on org detail page
6. **Landlord plan info** — read-only plan card on settings page, upgrade prompts when limits hit

---

## 3. Database Schema

### New table: `plans`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | gen_random_uuid() | PK |
| `name` | text NOT NULL | | e.g., "Free", "Pro", "Enterprise" |
| `slug` | text NOT NULL UNIQUE | | e.g., "free", "pro" — used in code |
| `max_properties` | int NOT NULL | 10 | 0 = unlimited |
| `features` | jsonb NOT NULL | `{}` | `{ "online_payments": bool, "messaging": bool }` |
| `is_default` | boolean NOT NULL | false | Only one plan can be default |
| `created_at` | timestamptz | now() | |
| `updated_at` | timestamptz | now() | |

### Modify: `organizations`

Add column: `plan_id UUID REFERENCES plans(id)` — FK with NO ON DELETE CASCADE (prevents accidental plan deletion at DB level).

**Migration ordering** (critical for existing data):
1. Create `plans` table and insert seed data
2. Add `plan_id` column as **NULLABLE** to `organizations`
3. Backfill all existing organizations: `UPDATE organizations SET plan_id = (SELECT id FROM plans WHERE slug = 'free')`
4. `ALTER COLUMN plan_id SET NOT NULL`
5. Add default: `ALTER COLUMN plan_id SET DEFAULT (SELECT id FROM plans WHERE is_default = true)` — or handle in application code

### Seed data

```sql
INSERT INTO plans (name, slug, max_properties, features, is_default) VALUES
  ('Free', 'free', 10, '{"online_payments": false, "messaging": false}', true),
  ('Paid', 'paid', 0, '{"online_payments": true, "messaging": true}', false);
-- Note: max_properties = 0 means unlimited
```

### RLS

- `plans` table: SELECT for all authenticated users (everyone reads their org's plan)
- INSERT/UPDATE/DELETE: service role only (admin actions use service role client)

### Constraint: single default plan

```sql
CREATE UNIQUE INDEX plans_single_default ON plans (is_default) WHERE is_default = true;
```

This ensures only one plan can have `is_default = true` at any time.

### `updated_at` trigger

Add a `moddatetime` trigger on `plans.updated_at`, matching the pattern used on `organizations` and `profiles`:
```sql
CREATE TRIGGER handle_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

### Database types update

Add `plans` table definition to `packages/database/src/types.ts` and add a `Relationships` entry to `organizations` for the `plan_id -> plans(id)` FK. This enables Supabase's embedded resource syntax: `.from('organizations').select('*, plans(*)').eq('id', orgId)`.

---

## 4. TypeScript Types

### `Plan`

```typescript
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

export interface PlanFeatures {
  online_payments: boolean;
  messaging: boolean;
}
```

### `PlanListItem` (admin)

```typescript
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

### Updated types

- `Organization`: add `plan_id: string`
- `OrganizationListItem` (admin): add `plan_name: string`
- `OrgDetail` (admin): add `plan: { id: string; name: string; slug: string; max_properties: number; features: PlanFeatures }` to the organization object

---

## 5. Admin Server Actions

### `listPlans()`

Returns: `ActionResult<PlanListItem[]>`

Query: all plans with org count via `organizations(count)` relation. Ordered by `created_at ASC`.

### `createPlan(data)`

Parameters: `{ name, slug, max_properties, features, is_default }`

Validation:
- `slug` must be unique
- If `is_default: true`, atomically flip all plans: `UPDATE plans SET is_default = (id = $new_plan_id)` — single statement, no partial-update risk

Returns: `ActionResult<Plan>`

### `updatePlan(id, data)`

Parameters: `{ name?, slug?, max_properties?, features?, is_default? }`

Validation:
- If changing `slug`, must remain unique
- If setting `is_default: true`, use same atomic flip: `UPDATE plans SET is_default = (id = $target_id)`

Returns: `ActionResult<Plan>`

### `deletePlan(id)`

Validation:
- Count orgs on this plan. If > 0, return error: `"Cannot delete plan with {count} organizations assigned. Reassign them first."`
- Cannot delete the default plan

Returns: `ActionResult<void>`

### `updateOrgPlan(orgId, planId)`

Validation:
- Fetch target plan's `max_properties`
- If `max_properties > 0`, count org's current properties
- If `property_count > max_properties`, return error: `"Organization has {count} properties but target plan allows {max}. Remove properties first."`

Returns: `ActionResult<void>`

---

## 6. Property Limit Enforcement

In `modules/portfolio/src/actions/create-property.ts`, before the insert:

```
1. Query org's plan: organizations JOIN plans WHERE org_id = orgId
2. If plan.max_properties === 0, skip check (unlimited)
3. Count current properties: properties WHERE org_id = orgId
4. If count >= plan.max_properties:
   return { success: false, error: "Property limit reached ({count}/{max}). Upgrade your plan to add more." }
5. Proceed with insert
```

---

## 7. Feature Gating

### Feature keys

Two gatable features stored in `plans.features` JSONB:
- `online_payments` — gates the online payment module (future)
- `messaging` — gates the `/messages` route and messaging actions

### Page-level gating (not middleware)

Feature gating is done at the **page component and server action level**, not in middleware. The middleware already makes 2-3 Supabase queries per request — adding plan lookups there would hurt performance on every page load. Instead:

- **Messaging page**: the page component fetches the org's plan and shows an upgrade banner if `messaging: false`
- **Tenant messaging page** (`/tenant/messages`): same check — if the tenant's org has messaging disabled, show upgrade banner

### Server action gating

A helper function `checkFeature(orgId, feature)` in `packages/database/src/queries/plans.ts`:
- Queries `organizations JOIN plans` using embedded syntax: `.from('organizations').select('plan_id, plans(features)').eq('id', orgId).single()`
- Returns `{ allowed: boolean, plan_name: string }`
- Used by messaging actions to early-return if feature is gated

### Data fetching for plan info

A `getOrgPlan(client, orgId)` query in `packages/database/src/queries/plans.ts`:
- Returns the full `Plan` object for the org
- Used by settings page, messaging page, and property creation limit check

### Landlord-facing prompts

- **Property limit hit**: toast error with limit info when `createProperty` returns the limit error
- **Gated feature page**: messaging page shows an upgrade banner instead of the chat interface when feature is disabled
- **Settings page**: read-only "Current Plan" card showing plan name, property usage (`7 of 10`), and enabled features list

---

## 8. Admin UI

### Plans page (`/admin/plans`)

- Table: Name, Slug, Property Limit ("Unlimited" if 0), Features (badges), Orgs Count, Default (badge)
- "Create Plan" button → dialog with form
- Edit button per row → same dialog pre-filled
- Delete button per row → confirm dialog (blocked if orgs assigned)

### Plan form fields

- Name (text input, required)
- Slug (text input, auto-generated from name on create, editable)
- Max Properties (number input, 0 = unlimited)
- Online Payments (checkbox)
- Messaging (checkbox)
- Default Plan (checkbox)

### Org detail page enhancement

Above the Members/Properties tabs, add a "Plan" card:
- Shows current plan name and badge
- "Change Plan" select dropdown listing all plans
- On change: calls `updateOrgPlan` with downgrade validation
- Error toast if downgrade blocked

### Org list page enhancement

Add "Plan" column to the organizations table (between Type and Members columns).

### Admin sidebar

Add "Plans" nav item with `CreditCard` icon, positioned between "Organizations" and "Users".

---

## 9. Org Creation: Default Plan Assignment

### SQL trigger (`handle_new_profile`)

The trigger that auto-creates a "Personal" org for new signups must set `plan_id` to the default plan:

```sql
INSERT INTO organizations (name, slug, type, plan_id)
VALUES ('Personal', ..., 'personal', (SELECT id FROM plans WHERE is_default = true));
```

### `createCompanyOrg()` function

When creating a company org, also assign the default plan:

```typescript
const { data: defaultPlan } = await client
  .from('plans')
  .select('id')
  .eq('is_default', true)
  .single();

await client.from('organizations').insert({
  name, slug, type: 'company',
  plan_id: defaultPlan.id
});
```

---

## 10. Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/` | New migration: create plans table, add plan_id to organizations, seed data |
| `packages/database/src/types.ts` | Add plans table types, add plan_id to organizations |
| `packages/types/src/models.ts` | Add Plan, PlanFeatures, PlanListItem types; update Organization, OrganizationListItem, OrgDetail |
| `packages/database/src/queries/organizations.ts` | Update `createCompanyOrg` to assign default plan |
| `packages/database/src/queries/plans.ts` | **New** — `getOrgPlan()`, `checkFeature()` helpers |
| `modules/admin/src/actions/list-plans.ts` | **New** |
| `modules/admin/src/actions/create-plan.ts` | **New** |
| `modules/admin/src/actions/update-plan.ts` | **New** |
| `modules/admin/src/actions/delete-plan.ts` | **New** |
| `modules/admin/src/actions/update-org-plan.ts` | **New** |
| `modules/admin/src/actions/get-org-details.ts` | Include plan info in org details |
| `modules/admin/src/actions/list-organizations.ts` | Include plan name in org list |
| `modules/portfolio/src/actions/create-property.ts` | Add property limit check |
| `apps/web/app/(admin)/admin/plans/page.tsx` | **New** — Plans management page |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Add plan card with change dropdown |
| `apps/web/app/(admin)/admin/organizations/page.tsx` | Add Plan column |
| `apps/web/components/admin/admin-sidebar.tsx` | Add Plans nav item |
| `apps/web/app/(dashboard)/messages/page.tsx` | Add upgrade banner when messaging is gated |
| `apps/web/app/(dashboard)/tenant/messages/page.tsx` | Add upgrade banner for tenant messaging when gated |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add "Current Plan" card (uses `getOrgPlan` to fetch full plan details) |
| `packages/database/src/index.ts` | Export new `plans` query module |

## 11. Verification

1. Admin can create, edit, and delete plans
2. Only one plan can be marked as default
3. Cannot delete a plan with orgs assigned
4. New orgs (personal + company) get the default plan
5. Property creation blocked when at plan limit with clear error message
6. Messaging page shows upgrade banner when feature is gated
7. Admin can change an org's plan
8. Downgrade blocked when org exceeds target plan's property limit
9. Org list shows plan name column
10. Org detail shows plan card with change option
11. Settings page shows current plan info for landlords
12. `pnpm build` passes

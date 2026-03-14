# OneReal Phase 1 MVP — Design Spec

> **Status:** Approved
> **Date:** 2026-03-14
> **Approach:** Full Phase 1 (Approach A)

---

## 1. Overview

OneReal Phase 1 delivers a complete, polished MVP of a modular, multi-tenant real estate rental management portal. The scope covers project scaffolding, database foundation, full authentication with onboarding, a data-rich dashboard, and full property portfolio CRUD.

### Primary Personas

Both equally from day one:
- **Individual landlords** — auto-created personal org, transparent multi-tenancy
- **Property management companies** — company org with team invites and role management

### Success Criteria

1. User can register (email/password or Google OAuth), complete onboarding, and land on a data-rich dashboard
2. User can create properties, manage units and images from the property detail page, and view a portfolio list with table/grid toggle
3. Multi-tenancy works: data is isolated per organization via RLS, org switcher lets users switch between orgs
4. "Coming Soon" placeholders exist for Transactions, Tenants, and Maintenance modules

---

## 2. Monorepo & Project Structure

**Tooling:** Turborepo + pnpm + Next.js 15 (App Router) + TypeScript (strict)

```
OneReal/
├── apps/web/                    # Next.js 15 Application
│   ├── app/
│   │   ├── (auth)/              # Public auth pages (login, register, forgot-password, reset-password, onboarding)
│   │   ├── (dashboard)/         # Protected dashboard pages
│   │   │   ├── page.tsx         # Dashboard home
│   │   │   ├── properties/     # Property list, new, [id] detail, [id]/edit
│   │   │   ├── transactions/   # Coming Soon placeholder
│   │   │   ├── tenants/        # Coming Soon placeholder
│   │   │   ├── maintenance/    # Coming Soon placeholder
│   │   │   └── settings/       # Org settings, profile settings
│   │   └── api/webhooks/       # Future webhook routes
│   ├── components/
│   │   ├── dashboard/          # sidebar, topbar, breadcrumbs, coming-soon
│   │   └── onboarding/         # profile-step, org-step
│   ├── lib/supabase/           # client.ts, server.ts
│   └── middleware.ts           # Auth + onboarding route protection
│
├── packages/
│   ├── ui/                     # shadcn/ui design system (button, input, card, data-table, stat-card, dialog, sheet, badge, tabs, dropdown-menu, avatar, form, select, textarea, toast)
│   ├── database/               # Supabase clients + typed query helpers (organizations, profiles, properties, units)
│   ├── auth/                   # Hooks (useUser, useSession, useRole), guards (<RoleGate>), actions (signIn, signUp, signOut, signInWithGoogle)
│   └── types/                  # Shared enums (PropertyType, UnitStatus, UserRole, etc.) + domain model interfaces
│
├── modules/
│   ├── portfolio/              # Components, hooks, actions, schemas for property management
│   ├── transactions/           # Placeholder package.json only
│   ├── tenants/                # Placeholder package.json only
│   ├── maintenance/            # Placeholder package.json only
│   └── listings/               # Placeholder package.json only
│
├── supabase/                   # Migrations + seed.sql + config.toml
├── turbo.json                  # Pipelines: build, dev, lint, type-check
└── package.json                # pnpm workspaces
```

**Path aliases:** `@onereal/ui`, `@onereal/database`, `@onereal/auth`, `@onereal/types`, `@onereal/portfolio`

**Turbo pipelines:**
- `build` — depends on `^build`
- `dev` — persistent, no caching
- `lint` — independent
- `type-check` — depends on `^build`

---

## 3. Database Schema

**Supabase Cloud** — no local Docker. Migrations run against cloud project.

### Migration 001: Core Tables

**`organizations`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | default gen_random_uuid() |
| name | TEXT NOT NULL | |
| slug | TEXT UNIQUE NOT NULL | URL-friendly |
| type | TEXT NOT NULL | 'personal' or 'company' |
| logo_url | TEXT | |
| settings | JSONB | default '{}' |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

**`profiles`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK, FK → auth.users | |
| first_name | TEXT | |
| last_name | TEXT | |
| email | TEXT | |
| phone | TEXT | |
| avatar_url | TEXT | |
| default_org_id | UUID FK → organizations | Active org |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | default now() |

**`org_members`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| user_id | UUID FK → profiles | |
| role | TEXT NOT NULL | admin, landlord, property_manager, tenant, contractor |
| status | TEXT NOT NULL | invited, active, inactive |
| invited_at | TIMESTAMPTZ | |
| joined_at | TIMESTAMPTZ | |

Constraint: `UNIQUE(org_id, user_id)`

### Migration 002: Portfolio Tables

**`properties`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| name | TEXT NOT NULL | |
| type | TEXT NOT NULL | single_family, townhouse, apartment_complex, condo, commercial, other |
| status | TEXT NOT NULL | active, inactive, sold |
| address_line1 | TEXT | |
| address_line2 | TEXT | |
| city | TEXT | |
| state | TEXT | |
| zip | TEXT | |
| country | TEXT | default 'US' |
| latitude | DOUBLE PRECISION | |
| longitude | DOUBLE PRECISION | |
| year_built | INTEGER | |
| purchase_price | DECIMAL(12,2) | |
| purchase_date | DATE | |
| market_value | DECIMAL(12,2) | |
| metadata | JSONB | default '{}', type-specific fields |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`units`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| property_id | UUID FK → properties | |
| unit_number | TEXT NOT NULL | "Main" for auto-created |
| type | TEXT | studio, 1bed, 2bed, 3bed, 4bed, commercial_unit, residential, other |
| bedrooms | INTEGER | |
| bathrooms | DECIMAL(3,1) | |
| square_feet | INTEGER | |
| rent_amount | DECIMAL(10,2) | |
| deposit_amount | DECIMAL(10,2) | |
| status | TEXT NOT NULL | vacant, occupied, maintenance, not_available |
| floor | INTEGER | |
| features | JSONB | default '[]' |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraint: `UNIQUE(property_id, unit_number)`

**`property_images`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| property_id | UUID FK → properties | |
| unit_id | UUID FK → units, nullable | |
| url | TEXT NOT NULL | Supabase Storage URL |
| caption | TEXT | |
| is_primary | BOOLEAN | default false |
| sort_order | INTEGER | default 0 |
| created_at | TIMESTAMPTZ | |

### Migration 003: Placeholder Tables

Tables created with full schema so foreign keys are valid. No UI until later phases.

**`leases`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| unit_id | UUID FK → units | |
| tenant_id | UUID FK → profiles | |
| start_date | DATE | |
| end_date | DATE | null = month-to-month |
| rent_amount | DECIMAL(10,2) | |
| deposit_amount | DECIMAL(10,2) | |
| payment_due_day | INTEGER | 1-28 |
| status | TEXT | draft, active, expired, terminated |
| terms | JSONB | default '{}' |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`transactions`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| lease_id | UUID FK → leases, nullable | |
| unit_id | UUID FK → units | |
| tenant_id | UUID FK → profiles, nullable | |
| type | TEXT | rent, deposit, fee, invoice, refund, expense, other |
| amount | DECIMAL(10,2) | |
| payment_method | TEXT | stripe, cash, check, zelle, bank_transfer, other |
| payment_status | TEXT | pending, completed, failed, refunded |
| stripe_payment_id | TEXT | |
| due_date | DATE | |
| paid_date | DATE | |
| description | TEXT | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`maintenance_requests`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| unit_id | UUID FK → units | |
| reported_by | UUID FK → profiles | |
| assigned_to | UUID FK → profiles, nullable | |
| title | TEXT NOT NULL | |
| description | TEXT | |
| priority | TEXT | low, medium, high, emergency |
| status | TEXT | open, in_progress, waiting_parts, completed, closed |
| category | TEXT | plumbing, electrical, hvac, appliance, structural, pest, other |
| images | JSONB | default '[]' |
| estimated_cost | DECIMAL(10,2) | |
| actual_cost | DECIMAL(10,2) | |
| scheduled_date | DATE | |
| completed_date | DATE | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### Triggers

1. **`on_auth_user_created`** — Creates `profiles` row from `auth.users` data
2. **`on_profile_created`** — Creates personal `organizations` row + `org_members` row (admin role)
3. **`moddatetime`** — Auto-updates `updated_at` on row changes (using moddatetime extension)

### RLS Policies

**Tables with direct `org_id`** (organizations, org_members, properties, leases, transactions, maintenance_requests):
- **SELECT**: `org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active')`
- **INSERT**: Same as SELECT + role check (`role IN ('admin', 'landlord', 'property_manager')`)
- **UPDATE**: Same as INSERT
- **DELETE**: Same as INSERT

**Tables without `org_id` (joined through parent):**

`units` — RLS via join to `properties`:
- **SELECT**: `property_id IN (SELECT id FROM properties WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'))`
- **INSERT/UPDATE/DELETE**: Same + role check

`property_images` — RLS via join to `properties`:
- **SELECT**: `property_id IN (SELECT id FROM properties WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'))`
- **INSERT/UPDATE/DELETE**: Same + role check

**`profiles`**: user can only SELECT/UPDATE their own row (`id = auth.uid()`).

### Supabase Storage

- Bucket: `property-images` (public read, authenticated write)
- Policy: Users can upload/delete images for properties in their org

---

## 4. Authentication & Onboarding

### Auth Flow

```
Register (email/pwd or Google OAuth)
  → Supabase creates auth.users
  → Trigger: auto-create profile + personal org
  → Redirect to /onboarding
  → Step 1: Complete profile (first name, last name, phone)
  → Step 2: Org choice:
      a) Keep personal org (individual landlord) → done
      b) Create company org (name, slug) → new org created, user added as admin
      c) Join existing org (deferred — option hidden in Phase 1, requires invite system)
  → Redirect to dashboard
```

### Auth Pages

| Route | Page |
|-------|------|
| `/login` | Email/password form + Google OAuth button + "Forgot password?" link |
| `/register` | Name, email, password + Google OAuth button |
| `/forgot-password` | Email input → sends Supabase reset link |
| `/reset-password` | New password form (from email link) |
| `/onboarding` | Two-step wizard (profile → org choice) |

### Middleware

- Unauthenticated → redirect to `/login`
- Authenticated without completed onboarding → redirect to `/onboarding`. Completion check: `profiles.first_name IS NOT NULL AND profiles.default_org_id IS NOT NULL`. The `on_profile_created` trigger sets `default_org_id` to the auto-created personal org, but `first_name` is null until onboarding step 1 is completed.
- Authenticated on auth pages → redirect to dashboard
- No role-based route blocking in Phase 1

**Google OAuth note:** The `on_auth_user_created` trigger fires for both email/password and OAuth registrations. For Google OAuth, the trigger creates the profile with `email` populated from Google but `first_name` null, so the user still goes through onboarding to complete their profile and choose an org.

### Auth Package (`@onereal/auth`)

**Hooks:**
- `useUser()` — current profile + active org
- `useSession()` — Supabase session
- `useRole()` — user's role in active org

**Components:**
- `<RoleGate role="landlord">` — conditional rendering by role

**Server Actions:**
- `signIn(email, password)`
- `signUp(email, password, name)`
- `signInWithGoogle()`
- `signOut()`

### Org Switcher

- Users can belong to multiple orgs
- `default_org_id` on profiles tracks active org
- Switching updates `default_org_id` and refreshes page
- All queries scope to active org

---

## 5. Dashboard Shell

### Layout: Classic Sidebar

**Sidebar (fixed, collapsible):**
- Logo + "OneReal" at top
- Nav items with Lucide icons:
  - Dashboard (`LayoutDashboard`) — active
  - Properties (`Building2`) — active
  - Transactions (`CreditCard`) — "Soon" badge, disabled
  - Tenants (`Users`) — "Soon" badge, disabled
  - Maintenance (`Wrench`) — "Soon" badge, disabled
  - Settings (`Settings`) — active, bottom-anchored
- Collapse toggle: collapses to icon-only
- Mobile (<768px): sheet overlay via hamburger

**Topbar:**
- Left: Breadcrumbs (auto-generated from route)
- Right: Org switcher dropdown, user avatar dropdown (profile, settings, sign out)
- No notification bell in Phase 1 (deferred to Phase 2 when there are events to notify about)

**Dashboard Home:**
- 4 stat cards: Total Properties, Total Units, Occupancy %, Total Rent Potential
- Quick actions: "Add Property" button
- Recent Activity placeholder: "Activity will appear here as you manage properties"

**Responsive breakpoints:**
- Desktop (≥1280px): sidebar expanded + full content
- Tablet (768-1279px): sidebar collapsed to icons
- Mobile (<768px): sidebar hidden, hamburger → sheet overlay

**Theme:** Light mode only in Phase 1. Dark mode deferred.

---

## 6. Property Portfolio Module

### Property List Page (`/properties`)

- **DataTable**: Sortable columns — Name, Type, Address, Units count, Occupancy %, Status
- **Filters**: Type dropdown, Status dropdown, text search (name/address)
- **View toggle**: Table ↔ Card/grid view
- **Pagination**: Server-side via TanStack Query
- **Row actions**: View, Edit, Delete (with confirmation dialog)
- **"Add Property"** button top-right

### Create Property (`/properties/new`)

Single-page form with sections (not a multi-step wizard — this differs from ARCHITECTURE.md Step 5b which described a 5-step wizard. Units and images are managed from the property detail page instead, per the two-phase approach decision):
- **Basic Info**: Name, Type (dropdown), Status
- **Address**: Line 1, Line 2, City, State, ZIP, Country
- **Details**: Year built, purchase price, purchase date, market value, notes, metadata (type-specific fields shown conditionally)

On save:
- Property created via server action
- SFH/townhouse/condo → auto-create "Main" unit (in server action, not DB trigger)
- Redirect to property detail page

### Property Detail (`/properties/[id]`)

Tabbed view:

| Tab | Content |
|-----|---------|
| **Overview** | Property info card, stats (units, occupied/vacant, rent potential), address |
| **Units** | DataTable: Unit #, Type, Beds, Baths, Sqft, Rent, Status. Add/edit via dialog. Delete with confirmation. Inline status toggle. |
| **Images** | Gallery grid. Drag-drop upload to Supabase Storage. Set primary. Delete. Captions. |
| **Activity** | Placeholder: "Lease and transaction history will appear here in a future update." |

### Edit Property (`/properties/[id]/edit`)

Same form as create, pre-populated with existing data.

### Server Actions (`@onereal/portfolio/actions`)

- `createProperty(data)` — Zod validation, insert, auto-create "Main" unit for SFH/townhouse/condo
- `updateProperty(id, data)` — validate, update
- `deleteProperty(id)` — application-level cascade: delete images from Supabase Storage, then delete DB records (units, images, property) using DB CASCADE constraints
- `createUnit(propertyId, data)` — validate, insert
- `updateUnit(id, data)` — validate, update
- `deleteUnit(id)` — prevent deleting last unit, delete
- `uploadImage(propertyId, file)` — upload to Supabase Storage, create DB record. Constraints: max 5MB per file, accepted formats: JPEG, PNG, WebP. Max 20 images per property.
- `deleteImage(id)` — delete from storage + DB
- `setPrimaryImage(id)` — unset current primary, set new

### TanStack Query Hooks (`@onereal/portfolio/hooks`)

- `useProperties(filters)` — paginated list
- `useProperty(id)` — single property with units and images
- `useUnits(propertyId)` — units for property
- `usePropertyImages(propertyId)` — images for property
- Mutation hooks for each server action with optimistic updates

### Zod Schemas (`@onereal/portfolio/schemas`)

- `propertySchema` — validates create/update property form
- `unitSchema` — validates create/update unit form

### Portfolio Stats (Dashboard)

Computed from data, not stored:
- Total properties count
- Total units count
- Occupied / Total = Occupancy %
- Sum of rent_amount = Total Rent Potential

---

## 7. Maps

**Status:** Nice-to-have — does not block MVP.

- `latitude` and `longitude` fields stored on properties
- If Mapbox token is configured: basic map view on property list page showing all properties as pins, click for summary popup
- If not configured: map section gracefully hidden

---

## 8. Settings

**Organization Settings (`/settings`):**
- Edit org name, upload logo
- View org slug
- Slug auto-generated from org name on creation (kebab-case, e.g., "My Properties LLC" → "my-properties-llc"). Collisions handled by appending a random 4-char suffix.
- For company orgs: members list with roles (read-only in Phase 1). Full invite-by-email flow deferred to Phase 2 — requires email templates, invite acceptance flow, and handling of existing vs. new users.

**Profile Settings (`/settings/profile`):**
- Edit first name, last name, phone, avatar upload
- Change password link (Supabase email flow)

---

## 9. Module Placeholders

Reusable `<ComingSoon>` component, each page shows:
- Module icon (large, centered)
- Module name and description
- Planned features bullet list
- "In Development" badge

Pages: `/transactions`, `/tenants`, `/maintenance`

---

## 10. Verification Plan

### Per-Step Verification

| Step | Verification |
|------|-------------|
| Scaffolding | `turbo dev` starts successfully, all packages resolve |
| Database | Migrations run on Supabase Cloud, types generate |
| Auth | Register → auto profile + org → login → dashboard → logout → redirect |
| Dashboard | Sidebar works, responsive, org switcher, breadcrumbs |
| Portfolio | Full CRUD: add property → list/grid → detail → units → images → stats |
| Placeholders | All pages render with correct content |

### End-to-End Smoke Test

1. Register a new account (email/password)
2. Complete onboarding (create company org)
3. Add 3 properties: SFH (auto "Main" unit), Apartment (4 units), Townhouse (auto "Main" unit)
4. Upload images for each property
5. Verify dashboard stats: 3 properties, 6 units, 0% occupancy
6. Edit a property, update unit rent amounts
7. Toggle unit status to occupied, verify occupancy % updates
8. Delete a property, verify removal from list and stats
9. Switch to placeholder modules, see "Coming Soon" pages
10. Log out, verify redirect to login
11. Register second user, create separate org, verify data isolation

---

## 11. Error Handling Pattern

All server actions return a consistent result type:
- **Success**: `{ success: true, data: T }`
- **Error**: `{ success: false, error: string }`

UI feedback via `toast.tsx` from `@onereal/ui`:
- Success actions (create, update, delete) show a success toast
- Validation errors show inline form errors (React Hook Form)
- Server errors show an error toast with a generic message

---

## 12. Out of Scope (Phase 1)

- Dark/light theme toggle
- Stripe payments
- Tenant portal
- Lease management UI
- Maintenance request UI
- Real-time updates (Supabase Realtime)
- Email notifications
- Automated testing (Vitest, Playwright)
- CI/CD pipeline
- Notification bell in topbar
- "Join existing org" onboarding option (requires invite system)
- Invite members by email (requires email templates + acceptance flow)
- Zustand stores (not needed in Phase 1 — TanStack Query handles server state, React state handles simple UI state like view toggles)

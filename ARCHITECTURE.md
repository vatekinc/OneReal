# OneReal — Real Estate Rental Management Portal

## Architecture & Implementation Plan

> **Status:** Draft — Under Review
> **Date:** 2026-03-03
> **Project Path:** `C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Modules Overview](#3-modules-overview)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication & Multi-Tenancy](#6-authentication--multi-tenancy)
7. [User Roles & Permissions](#7-user-roles--permissions)
8. [Phase 1 Implementation Plan](#8-phase-1-implementation-plan)
9. [Key Architecture Decisions](#9-key-architecture-decisions)
10. [Future Modules Roadmap](#10-future-modules-roadmap)
11. [Verification Plan](#11-verification-plan)

---

## 1. Project Overview

OneReal is a **modular, multi-tenant** real estate rental management portal designed for landlords, property managers, tenants, and contractors. The platform is built with a modular architecture where each functional area (Portfolio, Transactions, Tenants, Maintenance, Listings) is an independent module that can be developed and integrated incrementally.

### Core Principles

- **Modular** — Each feature area is an isolated module with its own components, hooks, actions, and schemas
- **Multi-tenant** — Data is isolated per organization using PostgreSQL Row Level Security
- **Extensible** — Property types, transaction types, and metadata are designed for future expansion (including commercial real estate)
- **Dashboard-first** — Data-rich UI with tables, charts, stat cards, and actionable insights

---

## 2. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Next.js 15 (App Router) | SSR for SEO (future listings), Server Actions, API routes, image optimization |
| **Language** | TypeScript (strict mode) | Type safety across the monorepo, Supabase generated types |
| **Database** | Supabase (PostgreSQL) | Managed PostgreSQL, Row Level Security for multi-tenancy, Realtime subscriptions |
| **Auth** | Supabase Auth | Email/password + Google OAuth, session management, JWTs |
| **Storage** | Supabase Storage | Property images, lease documents, maintenance photos |
| **Monorepo** | Turborepo | Module isolation, shared packages, parallel builds, caching |
| **UI** | Tailwind CSS + shadcn/ui | Consistent design system, accessible components, dashboard-friendly |
| **Forms** | React Hook Form + Zod | Performant forms with schema-based validation |
| **Server State** | TanStack Query v5 | Caching, background refetching, optimistic updates |
| **Client State** | Zustand | Lightweight stores per module (UI state, filters) |
| **Maps** | Mapbox GL JS | Property locations, interactive map search |
| **Payments** | Stripe (Phase 2) | Online rent collection, recurring payments, invoices |
| **Hosting** | Vercel | Zero-config Next.js deployment, edge functions, preview deployments |

### Why Not Plain React (CRA/Vite)?

| Feature | Plain React | Next.js |
|---------|------------|---------|
| SEO (future listings) | No SSR, poor SEO | SSR/SSG built-in |
| API routes | Need separate backend | Built-in API routes |
| Image optimization | Manual setup | Built-in `<Image>` component |
| Server Actions | Not available | Type-safe mutations without API boilerplate |
| File-based routing | Need React Router | Automatic from folder structure |

---

## 3. Modules Overview

```
┌─────────────────────────────────────────────────────────┐
│                    OneReal Platform                       │
├─────────────┬─────────────┬────────────┬────────────────┤
│  Portfolio  │Transactions │  Tenants   │  Maintenance   │
│  (Phase 1)  │ (Phase 2)   │ (Phase 2)  │  (Phase 3)     │
├─────────────┴─────────────┴────────────┴────────────────┤
│              Core (Auth, Orgs, Roles, UI)                │
├─────────────────────────────────────────────────────────┤
│            Supabase (PostgreSQL + Auth + Storage)         │
└─────────────────────────────────────────────────────────┘
```

| Module | Phase | Description |
|--------|-------|-------------|
| **Core** | 1 | Authentication, organizations, roles, dashboard shell, shared UI |
| **Property Portfolio** | 1 | Property & unit management, images, map view, portfolio stats |
| **Tenant Management** | 2 | Tenant onboarding, lease creation & tracking, tenant portal |
| **Rental Transactions** | 2 | Rent collection (Stripe + offline), deposits, invoices, payment tracking |
| **Maintenance** | 3 | Maintenance requests, contractor assignment, status tracking, communication |
| **Rental Listings** | Future | Public-facing property listings with SEO, application forms |

---

## 4. Monorepo Structure

```
OneReal/
│
├── apps/
│   └── web/                              # Next.js 15 Application
│       ├── app/
│       │   ├── (auth)/                   # Public auth pages (no sidebar)
│       │   │   ├── login/page.tsx
│       │   │   ├── register/page.tsx
│       │   │   ├── forgot-password/page.tsx
│       │   │   └── layout.tsx            # Auth layout (centered card)
│       │   │
│       │   ├── (dashboard)/              # Protected dashboard pages
│       │   │   ├── layout.tsx            # Dashboard shell (sidebar + topbar)
│       │   │   ├── page.tsx              # Dashboard home (stats, activity)
│       │   │   │
│       │   │   ├── properties/           # Portfolio module routes
│       │   │   │   ├── page.tsx          # Property list (table + grid toggle)
│       │   │   │   ├── new/page.tsx      # Multi-step add property form
│       │   │   │   └── [id]/
│       │   │   │       ├── page.tsx      # Property detail (tabbed view)
│       │   │   │       └── edit/page.tsx  # Edit property
│       │   │   │
│       │   │   ├── transactions/         # Placeholder → "Coming Soon"
│       │   │   │   └── page.tsx
│       │   │   ├── tenants/              # Placeholder → "Coming Soon"
│       │   │   │   └── page.tsx
│       │   │   ├── maintenance/          # Placeholder → "Coming Soon"
│       │   │   │   └── page.tsx
│       │   │   │
│       │   │   └── settings/
│       │   │       ├── page.tsx          # Org settings
│       │   │       └── profile/page.tsx  # Profile settings
│       │   │
│       │   ├── (public)/                 # Future public-facing pages
│       │   │   └── layout.tsx
│       │   │
│       │   ├── api/                      # API routes (webhooks only)
│       │   │   └── webhooks/
│       │   │       └── stripe/route.ts   # Stripe webhooks (Phase 2)
│       │   │
│       │   ├── layout.tsx                # Root layout
│       │   └── globals.css               # Global styles
│       │
│       ├── components/                   # App-specific components
│       │   ├── dashboard/
│       │   │   ├── sidebar.tsx           # Collapsible sidebar navigation
│       │   │   ├── topbar.tsx            # Top bar (org switcher, user menu)
│       │   │   ├── breadcrumbs.tsx
│       │   │   └── coming-soon.tsx       # Reusable placeholder page
│       │   └── onboarding/
│       │       ├── profile-step.tsx
│       │       └── org-step.tsx
│       │
│       ├── lib/                          # App utilities
│       │   ├── supabase/
│       │   │   ├── client.ts             # Browser Supabase client
│       │   │   └── server.ts             # Server Supabase client
│       │   └── utils.ts
│       │
│       ├── middleware.ts                 # Auth + role-based route protection
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── tsconfig.json
│
├── packages/                             # Shared packages
│   │
│   ├── ui/                               # Design system (shadcn/ui based)
│   │   ├── src/components/
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── data-table.tsx            # Reusable sortable/filterable table
│   │   │   ├── stat-card.tsx             # Dashboard metric card
│   │   │   ├── dialog.tsx
│   │   │   ├── sheet.tsx                 # Side panel
│   │   │   ├── badge.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── form.tsx                  # Form components (RHF integration)
│   │   │   ├── select.tsx
│   │   │   ├── textarea.tsx
│   │   │   └── toast.tsx
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── database/                         # Supabase client & query layer
│   │   ├── src/
│   │   │   ├── client.ts                 # createBrowserClient()
│   │   │   ├── server.ts                 # createServerClient()
│   │   │   ├── types.ts                  # Auto-generated from Supabase schema
│   │   │   └── queries/                  # Type-safe query helpers
│   │   │       ├── organizations.ts
│   │   │       ├── profiles.ts
│   │   │       ├── properties.ts
│   │   │       └── units.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── auth/                             # Auth utilities
│   │   ├── src/
│   │   │   ├── hooks.ts                  # useUser, useSession, useRole
│   │   │   ├── middleware.ts             # Auth middleware helpers
│   │   │   ├── guards.tsx                # <RoleGate role="landlord">
│   │   │   └── actions.ts               # signIn, signUp, signOut
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── types/                            # Shared types & enums
│       ├── src/
│       │   ├── enums.ts                  # PropertyType, UnitStatus, UserRole, etc.
│       │   └── models.ts                 # Domain model interfaces
│       ├── package.json
│       └── tsconfig.json
│
├── modules/                              # Feature modules
│   │
│   ├── portfolio/                        # Property Portfolio (Phase 1)
│   │   ├── components/
│   │   │   ├── property-list.tsx         # Data table with filters & search
│   │   │   ├── property-form.tsx         # Multi-step add/edit form
│   │   │   ├── property-card.tsx         # Grid view card
│   │   │   ├── property-detail.tsx       # Detail view with tabs
│   │   │   ├── unit-list.tsx             # Units table (within property)
│   │   │   ├── unit-form.tsx             # Add/edit unit modal
│   │   │   ├── image-upload.tsx          # Drag-drop image upload
│   │   │   ├── property-map.tsx          # Mapbox map view
│   │   │   └── portfolio-stats.tsx       # Dashboard stat cards
│   │   ├── hooks/
│   │   │   ├── use-properties.ts         # TanStack Query: list, get, mutate
│   │   │   ├── use-units.ts
│   │   │   └── use-property-images.ts
│   │   ├── actions/                      # Next.js Server Actions
│   │   │   ├── property-actions.ts       # createProperty, updateProperty, deleteProperty
│   │   │   ├── unit-actions.ts           # createUnit, updateUnit, deleteUnit
│   │   │   └── image-actions.ts          # uploadImage, deleteImage, setPrimary
│   │   ├── schemas/                      # Zod validation schemas
│   │   │   ├── property-schema.ts
│   │   │   └── unit-schema.ts
│   │   ├── package.json
│   │   └── index.ts                      # Public exports
│   │
│   ├── transactions/                     # Placeholder (Phase 2)
│   │   └── package.json
│   ├── tenants/                          # Placeholder (Phase 2)
│   │   └── package.json
│   ├── maintenance/                      # Placeholder (Phase 3)
│   │   └── package.json
│   └── listings/                         # Placeholder (Future)
│       └── package.json
│
├── supabase/                             # Database
│   ├── migrations/                       # SQL migrations (see Section 5)
│   ├── seed.sql                          # Sample data for development
│   └── config.toml                       # Supabase local dev config
│
├── turbo.json                            # Turborepo pipeline config
├── package.json                          # Root workspace config
├── .env.local.example                    # Environment variable template
├── .gitignore
└── ARCHITECTURE.md                       # This file
```

---

## 5. Database Schema

### Entity Relationship Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   auth.users │────▶│   profiles   │────▶│  org_members     │
│   (Supabase) │     │              │     │  (role, status)  │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
                                          ┌─────────▼─────────┐
                                          │  organizations    │
                                          │  (personal/co.)   │
                                          └─────────┬─────────┘
                                                    │
                          ┌─────────────────────────┼──────────────────────┐
                          │                         │                      │
                ┌─────────▼─────────┐    ┌─────────▼──────┐    ┌─────────▼───────────┐
                │    properties     │    │    leases      │    │ maintenance_requests │
                │ (type, address,   │    │  (Phase 2)     │    │    (Phase 3)         │
                │  lat/lng, meta)   │    └────────┬───────┘    └─────────────────────┘
                └─────────┬─────────┘             │
                          │                       │
                ┌─────────▼─────────┐    ┌────────▼────────┐
                │      units        │    │  transactions   │
                │ (beds, bath, rent,│    │   (Phase 2)     │
                │  status)          │    └─────────────────┘
                └─────────┬─────────┘
                          │
                ┌─────────▼─────────┐
                │ property_images   │
                └───────────────────┘
```

### Core Tables

#### `organizations`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `name` | TEXT | Organization name |
| `slug` | TEXT (UNIQUE) | URL-friendly identifier |
| `type` | TEXT | `'personal'` or `'company'` |
| `logo_url` | TEXT | Organization logo |
| `settings` | JSONB | Extensible settings |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

#### `profiles`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK, FK → auth.users) | Links to Supabase auth |
| `first_name` | TEXT | User's first name |
| `last_name` | TEXT | User's last name |
| `email` | TEXT | Email address |
| `phone` | TEXT | Phone number |
| `avatar_url` | TEXT | Profile photo URL |
| `default_org_id` | UUID (FK → organizations) | Default active organization |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

#### `org_members`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `org_id` | UUID (FK → organizations) | Organization |
| `user_id` | UUID (FK → profiles) | User |
| `role` | TEXT | `'admin'`, `'landlord'`, `'property_manager'`, `'tenant'`, `'contractor'` |
| `status` | TEXT | `'invited'`, `'active'`, `'inactive'` |
| `invited_at` | TIMESTAMPTZ | When invited |
| `joined_at` | TIMESTAMPTZ | When accepted invite |

**Constraint:** `UNIQUE(org_id, user_id)` — one role per org per user.

### Portfolio Tables

#### `properties`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `org_id` | UUID (FK → organizations) | Owning organization |
| `name` | TEXT | Property name (e.g., "Sunrise Apartments") |
| `type` | TEXT | `'single_family'`, `'townhouse'`, `'apartment_complex'`, `'condo'`, `'commercial'`, `'other'` |
| `status` | TEXT | `'active'`, `'inactive'`, `'sold'` |
| `address_line1` | TEXT | Street address |
| `address_line2` | TEXT | Apt/Suite/Unit |
| `city` | TEXT | City |
| `state` | TEXT | State |
| `zip` | TEXT | ZIP code |
| `country` | TEXT | Country (default: `'US'`) |
| `latitude` | DOUBLE PRECISION | Geocoded latitude |
| `longitude` | DOUBLE PRECISION | Geocoded longitude |
| `year_built` | INTEGER | Year constructed |
| `purchase_price` | DECIMAL(12,2) | Acquisition cost |
| `purchase_date` | DATE | Date acquired |
| `market_value` | DECIMAL(12,2) | Current market value |
| `metadata` | JSONB | Type-specific fields (see below) |
| `notes` | TEXT | Free-form notes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Metadata JSONB examples by property type:**
```json
// Commercial
{ "zoning": "C-2", "parking_spaces": 50, "loading_docks": 2, "lease_type": "NNN" }

// Apartment Complex
{ "total_floors": 4, "has_elevator": true, "amenities": ["pool", "gym", "laundry"] }

// Single Family
{ "garage_spaces": 2, "has_basement": true, "hoa_fee": 150 }
```

#### `units`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `property_id` | UUID (FK → properties) | Parent property |
| `unit_number` | TEXT | Unit identifier (e.g., "101", "Main") |
| `type` | TEXT | `'studio'`, `'1bed'`, `'2bed'`, `'3bed'`, `'4bed'`, `'commercial_unit'`, `'residential'`, `'other'` |
| `bedrooms` | INTEGER | Number of bedrooms |
| `bathrooms` | DECIMAL(3,1) | Number of bathrooms |
| `square_feet` | INTEGER | Unit size |
| `rent_amount` | DECIMAL(10,2) | Monthly rent |
| `deposit_amount` | DECIMAL(10,2) | Security deposit |
| `status` | TEXT | `'vacant'`, `'occupied'`, `'maintenance'`, `'not_available'` |
| `floor` | INTEGER | Floor number |
| `features` | JSONB | Feature list (e.g., `["washer_dryer", "balcony", "updated_kitchen"]`) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Constraint:** `UNIQUE(property_id, unit_number)` — no duplicate unit numbers per property.

**Important design note:** Every property has at least one unit. For Single Family Homes, Townhouses, and Condos, a "Main" unit is auto-created. For Apartment Complexes and Commercial properties, units are added manually. This normalizes the data model so leases, transactions, and maintenance always reference a **unit**, not a property directly.

#### `property_images`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `property_id` | UUID (FK → properties) | Parent property |
| `unit_id` | UUID (FK → units, nullable) | Optional unit association |
| `url` | TEXT | Supabase Storage URL |
| `caption` | TEXT | Image description |
| `is_primary` | BOOLEAN | Primary/cover image flag |
| `sort_order` | INTEGER | Display order |
| `created_at` | TIMESTAMPTZ | Upload timestamp |

### Placeholder Tables (DB created in Phase 1, UI in later phases)

#### `leases` (Phase 2 — Tenant Management)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `org_id` | UUID (FK → organizations) | Organization |
| `unit_id` | UUID (FK → units) | Leased unit |
| `tenant_id` | UUID (FK → profiles) | Tenant |
| `start_date` | DATE | Lease start |
| `end_date` | DATE | Lease end (null = month-to-month) |
| `rent_amount` | DECIMAL(10,2) | Monthly rent |
| `deposit_amount` | DECIMAL(10,2) | Security deposit |
| `payment_due_day` | INTEGER (1-28) | Day rent is due |
| `status` | TEXT | `'draft'`, `'active'`, `'expired'`, `'terminated'` |
| `terms` | JSONB | Additional lease terms |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

#### `transactions` (Phase 2 — Rental Transactions)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `org_id` | UUID (FK → organizations) | Organization |
| `lease_id` | UUID (FK → leases, nullable) | Associated lease |
| `unit_id` | UUID (FK → units) | Associated unit |
| `tenant_id` | UUID (FK → profiles, nullable) | Payer |
| `type` | TEXT | `'rent'`, `'deposit'`, `'fee'`, `'invoice'`, `'refund'`, `'expense'`, `'other'` |
| `amount` | DECIMAL(10,2) | Transaction amount |
| `payment_method` | TEXT | `'stripe'`, `'cash'`, `'check'`, `'zelle'`, `'bank_transfer'`, `'other'` |
| `payment_status` | TEXT | `'pending'`, `'completed'`, `'failed'`, `'refunded'` |
| `stripe_payment_id` | TEXT | Stripe reference (if online) |
| `due_date` | DATE | When payment is due |
| `paid_date` | DATE | When payment was received |
| `description` | TEXT | Transaction description |
| `notes` | TEXT | Internal notes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

#### `maintenance_requests` (Phase 3)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `org_id` | UUID (FK → organizations) | Organization |
| `unit_id` | UUID (FK → units) | Affected unit |
| `reported_by` | UUID (FK → profiles) | Who reported |
| `assigned_to` | UUID (FK → profiles, nullable) | Assigned contractor |
| `title` | TEXT | Request title |
| `description` | TEXT | Detailed description |
| `priority` | TEXT | `'low'`, `'medium'`, `'high'`, `'emergency'` |
| `status` | TEXT | `'open'`, `'in_progress'`, `'waiting_parts'`, `'completed'`, `'closed'` |
| `category` | TEXT | `'plumbing'`, `'electrical'`, `'hvac'`, `'appliance'`, `'structural'`, `'pest'`, `'other'` |
| `images` | JSONB | Array of image URLs |
| `estimated_cost` | DECIMAL(10,2) | Estimated repair cost |
| `actual_cost` | DECIMAL(10,2) | Actual repair cost |
| `scheduled_date` | DATE | Scheduled repair date |
| `completed_date` | DATE | Completion date |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Database Triggers

1. **Auto-create profile** — When a new user registers via Supabase Auth, a `profiles` row is auto-created from `auth.users`.
2. **Auto-create personal org** — When a profile is created, a personal organization is auto-created and the user is added as `admin`.
3. **Auto-update timestamps** — `updated_at` is auto-set on row updates.

---

## 6. Authentication & Multi-Tenancy

### Auth Flow

```
Register → Create auth.users → Trigger: Create profile
  → Trigger: Create personal org → Onboarding wizard
  → Step 1: Complete profile (name, phone)
  → Step 2: Org choice:
      a) Keep personal org (individual landlord)
      b) Create company org (property management company)
      c) Join existing org (via invite code)
  → Dashboard
```

### Multi-Tenancy Model (Hybrid)

- **Individual landlords** get an auto-created `personal` org on signup. They never need to think about "organizations."
- **Property management companies** create a `company` org and invite team members.
- **Tenants** are invited to an org by a landlord/PM and get the `tenant` role.
- **All data is scoped to `org_id`** with Row Level Security (RLS) policies.
- **Org switcher** in the top bar allows users belonging to multiple orgs to switch context.

### RLS Policy Pattern

```sql
-- Example: properties table
CREATE POLICY "Users can view properties in their org"
  ON properties FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Admins/landlords can insert properties"
  ON properties FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );
```

---

## 7. User Roles & Permissions

| Role | Properties | Units | Leases | Transactions | Maintenance | Settings |
|------|-----------|-------|--------|-------------|-------------|----------|
| **Admin** | CRUD | CRUD | CRUD | CRUD | CRUD | CRUD |
| **Landlord** | CRUD | CRUD | CRUD | CRUD | CRUD | Read |
| **Property Manager** | CRUD | CRUD | CRUD | CRUD | CRUD | Read |
| **Tenant** | Read (own unit) | Read (own) | Read (own) | Read (own) + Pay | Create + Read | — |
| **Contractor** | — | Read (assigned) | — | — | Read/Update (assigned) | — |
| **Public** | Read (listings*) | — | — | — | — | — |

*Public access only for the future Listings module.

---

## 8. Phase 1 Implementation Plan

### Step 1: Project Scaffolding

**Goal:** Working Turborepo monorepo with Next.js app, all packages initialized.

| Task | Details |
|------|---------|
| Initialize Turborepo | `npx create-turbo@latest` at project root |
| Create Next.js app | `apps/web` — App Router, TypeScript, Tailwind, ESLint |
| Create shared packages | `packages/ui`, `packages/database`, `packages/auth`, `packages/types` |
| Create module folders | `modules/portfolio`, `modules/transactions`, `modules/tenants`, `modules/maintenance`, `modules/listings` |
| Configure Turborepo | `turbo.json` with `build`, `dev`, `lint`, `type-check` pipelines |
| Set up shadcn/ui | Initialize in `packages/ui` with core components |
| Configure path aliases | `@onereal/ui`, `@onereal/database`, `@onereal/auth`, `@onereal/types`, `@onereal/portfolio` |
| Create env template | `.env.local.example` with all required variables |
| Git init | `.gitignore`, initial commit |

**Verification:** `turbo dev` starts the Next.js dev server successfully.

---

### Step 2: Supabase Foundation

**Goal:** All database tables created with RLS policies, TypeScript types generated.

| Task | Details |
|------|---------|
| Initialize Supabase | `npx supabase init` in project root |
| Core migrations | `organizations`, `profiles`, `org_members` tables |
| Portfolio migrations | `properties`, `units`, `property_images` tables |
| Placeholder migrations | `leases`, `transactions`, `maintenance_requests` tables |
| RLS policies | Multi-tenant isolation for all tables |
| Database triggers | Auto-create profile, auto-create personal org, auto-update timestamps |
| Type generation | Generate TypeScript types from Supabase schema |
| Supabase client setup | Browser + server clients in `packages/database` |
| Seed data | Demo org with sample properties and units |
| Storage bucket | Create `property-images` bucket with policies |

**Verification:** `npx supabase db reset` runs all migrations. Types generate successfully.

---

### Step 3: Authentication & Onboarding

**Goal:** Users can register, log in, complete onboarding, and access protected routes.

| Task | Details |
|------|---------|
| Auth package | `useUser()`, `useSession()`, `useRole()` hooks |
| Auth actions | `signIn()`, `signUp()`, `signOut()` server actions |
| Auth middleware | Protect `(dashboard)` routes, redirect unauthenticated to login |
| Login page | Email/password form + Google OAuth button |
| Register page | Name, email, password form |
| Forgot password | Email input, send reset link |
| Onboarding flow | Profile setup → Org choice (personal/company/join) |
| Role-based routing | Redirect based on role after login |

**Verification:** Register → profile/org auto-created → login → dashboard → logout → redirected to login.

---

### Step 4: Dashboard Shell

**Goal:** Complete dashboard layout with navigation, org switcher, and responsive design.

| Task | Details |
|------|---------|
| Dashboard layout | Sidebar + topbar + main content area |
| Sidebar navigation | Collapsible, module links with icons, "Coming Soon" badges |
| Top bar | Org switcher dropdown, notification bell (placeholder), user avatar menu |
| Breadcrumbs | Auto-generated from route structure |
| Dashboard home | Summary stat cards, quick actions, recent activity placeholder |
| Settings pages | Org settings (name, logo), profile settings, members list |
| Responsive design | Sidebar collapses to icons → sheet overlay on mobile |
| Theme | Dashboard-heavy dark/light theme toggle |

**Navigation items:**
| Item | Icon | Status |
|------|------|--------|
| Dashboard | `LayoutDashboard` | Active |
| Properties | `Building2` | Active |
| Transactions | `CreditCard` | Coming Soon |
| Tenants | `Users` | Coming Soon |
| Maintenance | `Wrench` | Coming Soon |
| Settings | `Settings` | Active |

**Verification:** Navigate all routes, sidebar collapses/expands, org switcher works.

---

### Step 5: Property Portfolio Module

**Goal:** Full CRUD for properties and units with images and map view.

#### 5a. Property List
| Feature | Details |
|---------|---------|
| Data table | Sortable columns: Name, Type, Address, Units, Occupancy %, Status |
| Filters | Type dropdown, status dropdown, text search (name/address) |
| View toggle | Table view ↔ Card/grid view |
| Pagination | Server-side pagination |
| Actions | Add Property button, row actions (view, edit, delete) |

#### 5b. Add/Edit Property (Multi-Step Form)
| Step | Fields |
|------|--------|
| 1. Basic Info | Name, Type (dropdown), Status |
| 2. Address | Address line 1 & 2, City, State, ZIP, Country (geocode on save for lat/lng) |
| 3. Details | Year built, Purchase price, Purchase date, Market value, Notes, Metadata (type-specific) |
| 4. Units | Auto-create "Main" for SFH/townhouse/condo. Add multiple for apartments. Unit: number, type, beds, baths, sqft, rent, deposit |
| 5. Images | Drag-drop upload, set primary, reorder, captions |

#### 5c. Property Detail (Tabbed View)
| Tab | Content |
|-----|---------|
| Overview | Property stats (units, occupancy, rent potential), details, map pin |
| Units | Data table of units with status badges, inline status toggle, add/edit/delete |
| Images | Gallery grid, upload new, set primary, delete |
| Activity | Placeholder: "Lease and transaction history will appear here" |

#### 5d. Supporting Features
| Feature | Details |
|---------|---------|
| Unit CRUD | Add/edit via dialog modal within property detail |
| Image upload | Drag-drop to Supabase Storage `property-images` bucket |
| Map view | Mapbox GL showing all properties as pins, click for summary popup |
| Portfolio stats | Dashboard cards: total properties, total units, occupied, vacant, vacancy rate, total rent potential |

**Verification:** Add 3 properties (SFH with 1 unit, apartment with 4 units, townhouse), verify list/grid views, edit, upload images, view on map, check dashboard stats.

---

### Step 6: Module Placeholders

**Goal:** Coming Soon pages for future modules with feature previews.

Each placeholder page shows:
- Module name and icon
- Brief description
- Planned features list (bullet points)
- "In Development" status badge

---

## 9. Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Every property has units** | Normalizes the data model. Leases, transactions, and maintenance always reference a unit, not a property directly. SFH/townhouse/condo gets 1 auto-created "Main" unit. |
| **Hybrid multi-tenancy** | Individual landlords shouldn't deal with "organization" concepts. Auto-created personal org makes it seamless. Companies get formal orgs with team management. |
| **Modules as Turborepo packages** | Each module is independently developable, testable, and deployable. Shared packages prevent code duplication. New modules plug in without touching existing ones. |
| **Server Actions over API routes** | Type-safe mutations without REST API boilerplate. API routes reserved for webhooks (Stripe) and external integrations only. |
| **Metadata JSONB for extensibility** | Properties and units have `metadata` JSONB for type-specific fields. No need to alter the schema when adding commercial real estate fields. |
| **shadcn/ui in shared package** | Consistent design system across all modules. Dashboard-heavy components (DataTable, StatCard) are reusable. |
| **TanStack Query per module** | Each module manages its own server state. No global state coupling between modules. |

---

## 10. Future Modules Roadmap

### Phase 2: Tenant Management + Rental Transactions

**Tenant Management:**
- Tenant onboarding (invite by email, application form)
- Lease creation and management (create, renew, terminate)
- Tenant portal (view lease, pay rent, submit maintenance)
- Lease document storage (Supabase Storage)

**Rental Transactions:**
- Rent collection via Stripe (one-time + recurring payments)
- Offline payment recording (cash, check, Zelle, bank transfer)
- Invoice generation
- Deposit tracking (security deposit, pet deposit)
- Payment history and reporting
- Late fee automation
- Financial dashboard (income, expenses, P&L by property)

### Phase 3: Maintenance

- Maintenance request submission (by tenants)
- Request assignment (to contractors)
- Status tracking with real-time updates (Supabase Realtime)
- Photo documentation (before/after)
- Cost tracking (estimated vs actual)
- Communication thread (tenant ↔ landlord ↔ contractor)
- Maintenance history per unit

### Future: Rental Listings

- Public-facing property listing pages (SSR for SEO)
- Search by location, price, bedrooms, amenities
- Map-based search
- Online application forms
- Application review workflow
- Listing syndication (Zillow, Apartments.com APIs)

---

## 11. Verification Plan

### After Each Step

| Step | How to Verify |
|------|---------------|
| 1. Scaffolding | `turbo dev` starts successfully, all packages resolve |
| 2. Supabase | `npx supabase db reset` runs all migrations, types generate |
| 3. Auth | Register → auto-profile + org → login → dashboard → logout → redirect |
| 4. Dashboard | Sidebar works, responsive layout, org switcher, breadcrumbs |
| 5. Portfolio | Full CRUD flow: add properties → list/grid → detail → units → images → map → stats |
| 6. Placeholders | All placeholder pages render with correct content |

### End-to-End Smoke Test

1. Register a new account
2. Complete onboarding (create company org)
3. Add 3 properties:
   - Single Family Home (auto-creates 1 "Main" unit)
   - Apartment Complex with 4 units
   - Townhouse (auto-creates 1 "Main" unit)
4. Upload images for each property
5. Verify dashboard stats: 3 properties, 6 units, 0% occupancy
6. View map with 3 pins
7. Edit a property, update unit rent amounts
8. Delete a property, verify removal
9. Switch to placeholder modules, see "Coming Soon" pages
10. Log out, verify redirect to login

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=your-mapbox-token

# Stripe (Phase 2)
STRIPE_SECRET_KEY=your-stripe-secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your-stripe-publishable
STRIPE_WEBHOOK_SECRET=your-webhook-secret

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

*Document created: 2026-03-03*
*Status: Draft — Under Review*

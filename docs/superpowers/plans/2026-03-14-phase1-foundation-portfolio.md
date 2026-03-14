# Phase 1: Foundation & Portfolio — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 MVP of OneReal — a modular, multi-tenant real estate rental management portal with full auth, dashboard shell, and property portfolio CRUD.

**Architecture:** Turborepo monorepo with shared packages (types, ui, database, auth) and feature modules (portfolio). Next.js 15 App Router web app with Supabase Cloud for auth, database (PostgreSQL + RLS), and storage. Two route groups: `(auth)` for public pages and `(dashboard)` for protected pages behind sidebar layout.

**Tech Stack:** Next.js 15 (App Router) · TypeScript (strict) · Turborepo + pnpm · Supabase (Auth, PostgreSQL, Storage) · shadcn/ui + Tailwind CSS · TanStack Query v5 + TanStack Table v8 · Zod + React Hook Form · Lucide React icons

**Spec:** `docs/superpowers/specs/2026-03-14-phase1-mvp-design.md`

**Note on testing:** Automated testing (Vitest, Playwright) is out of scope for Phase 1 per spec. Verification uses type-checking (`turbo type-check`), dev server startup, and manual checks.

---

## File Structure

```
OneReal/
├── package.json                          # Root workspace config
├── pnpm-workspace.yaml                   # Workspace package paths
├── turbo.json                            # Build pipeline definitions
├── tsconfig.json                         # Base TypeScript config
├── .gitignore
├── .env.local.example                    # Environment variable template
│
├── apps/web/                             # Next.js 15 application
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts                    # transpilePackages for monorepo
│   ├── tailwind.config.ts                # Scans all workspace packages
│   ├── postcss.config.mjs
│   ├── middleware.ts                     # Auth guard + onboarding redirect
│   ├── app/
│   │   ├── layout.tsx                    # Root layout: fonts, QueryProvider, Toaster
│   │   ├── globals.css                   # Tailwind imports + CSS variables
│   │   ├── (auth)/
│   │   │   ├── layout.tsx               # Centered card layout for auth pages
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   ├── reset-password/page.tsx
│   │   │   └── onboarding/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx               # Sidebar + topbar shell
│   │   │   ├── page.tsx                 # Dashboard home: stat cards + quick actions
│   │   │   ├── properties/
│   │   │   │   ├── page.tsx             # Property list: table/grid toggle, filters
│   │   │   │   ├── new/page.tsx         # Create property form
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx         # Property detail: tabbed view
│   │   │   │       └── edit/page.tsx    # Edit property form
│   │   │   ├── transactions/page.tsx    # Coming Soon placeholder
│   │   │   ├── tenants/page.tsx         # Coming Soon placeholder
│   │   │   ├── maintenance/page.tsx     # Coming Soon placeholder
│   │   │   └── settings/
│   │   │       ├── page.tsx             # Organization settings
│   │   │       └── profile/page.tsx     # User profile settings
│   │   └── auth/callback/route.ts       # Supabase OAuth callback handler
│   ├── components/
│   │   ├── providers.tsx                # QueryClientProvider + Toaster wrapper
│   │   ├── dashboard/
│   │   │   ├── sidebar.tsx              # Collapsible nav sidebar
│   │   │   ├── topbar.tsx               # Breadcrumbs + org switcher + user menu
│   │   │   ├── breadcrumbs.tsx          # Auto-generated from route
│   │   │   ├── org-switcher.tsx         # Dropdown to switch active org
│   │   │   ├── user-menu.tsx            # Avatar dropdown: profile, settings, sign out
│   │   │   └── coming-soon.tsx          # Reusable placeholder component
│   │   ├── onboarding/
│   │   │   ├── profile-step.tsx         # First/last name + phone
│   │   │   └── org-step.tsx             # Personal vs company org choice
│   │   └── properties/
│   │       ├── property-form.tsx        # Shared form for create/edit
│   │       ├── property-list.tsx        # Table view with DataTable
│   │       ├── property-card.tsx        # Card/grid view item
│   │       ├── property-detail-tabs.tsx # Overview, Units, Images, Activity tabs
│   │       ├── unit-table.tsx           # Unit DataTable
│   │       ├── unit-dialog.tsx          # Create/edit unit dialog
│   │       ├── image-gallery.tsx        # Image grid with primary badge
│   │       └── image-upload.tsx         # Drag-drop file upload
│   └── lib/supabase/
│       ├── client.ts                    # createBrowserClient()
│       └── server.ts                    # createServerClient() for Server Components/Actions
│
├── packages/
│   ├── ui/                              # shadcn/ui shared design system
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts           # Minimal config for shadcn CLI
│   │   ├── components.json              # shadcn CLI config
│   │   └── src/
│   │       ├── index.ts                 # Re-exports all components
│   │       ├── globals.css              # Tailwind base + CSS variables
│   │       ├── lib/utils.ts             # cn() class merging helper
│   │       └── components/
│   │           ├── ui/                  # shadcn-generated: button, input, card, badge,
│   │           │                        # tabs, dialog, sheet, dropdown-menu, avatar,
│   │           │                        # form, select, textarea, label, table,
│   │           │                        # separator, scroll-area, tooltip, sonner
│   │           ├── stat-card.tsx         # Custom: metric display card
│   │           └── data-table.tsx        # Custom: TanStack Table wrapper
│   │
│   ├── database/                        # Supabase clients + typed query helpers
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts               # createBrowserClient wrapper
│   │       ├── server.ts               # createServerClient wrapper
│   │       ├── types.ts                # Supabase generated database types
│   │       └── queries/
│   │           ├── organizations.ts
│   │           ├── profiles.ts
│   │           ├── properties.ts
│   │           └── units.ts
│   │
│   ├── auth/                           # Auth hooks, guards, server actions
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── hooks/
│   │       │   ├── use-user.ts
│   │       │   ├── use-session.ts
│   │       │   └── use-role.ts
│   │       ├── components/
│   │       │   └── role-gate.tsx
│   │       └── actions/
│   │           ├── sign-in.ts
│   │           ├── sign-up.ts
│   │           ├── sign-out.ts
│   │           └── sign-in-with-google.ts
│   │
│   └── types/                          # Shared enums + domain model interfaces
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── enums.ts
│           └── models.ts
│
├── modules/
│   ├── portfolio/                      # Property management feature module
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── actions/
│   │       │   ├── create-property.ts
│   │       │   ├── update-property.ts
│   │       │   ├── delete-property.ts
│   │       │   ├── create-unit.ts
│   │       │   ├── update-unit.ts
│   │       │   ├── delete-unit.ts
│   │       │   ├── upload-image.ts
│   │       │   ├── delete-image.ts
│   │       │   └── set-primary-image.ts
│   │       ├── hooks/
│   │       │   ├── use-properties.ts
│   │       │   ├── use-property.ts
│   │       │   ├── use-units.ts
│   │       │   └── use-property-images.ts
│   │       └── schemas/
│   │           ├── property-schema.ts
│   │           └── unit-schema.ts
│   │
│   ├── transactions/package.json       # Placeholder (Phase 2)
│   ├── tenants/package.json            # Placeholder (Phase 4)
│   ├── maintenance/package.json        # Placeholder (Phase 5)
│   └── listings/package.json           # Placeholder (Phase 6)
│
└── supabase/
    ├── config.toml                     # Supabase project config
    ├── seed.sql                        # Dev seed data
    └── migrations/
        ├── 001_core_tables.sql         # organizations, profiles, org_members + triggers + RLS
        ├── 002_portfolio_tables.sql    # properties, units, property_images + RLS
        └── 003_placeholder_tables.sql  # leases, transactions, maintenance_requests + RLS
```

---

## Chunk 1: Monorepo Scaffolding & Shared Packages

### Task 1: Initialize Monorepo Root & All Package Shells

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`, `.gitignore`, `.env.local.example`
- Create: All workspace `package.json` and `tsconfig.json` files

**Prerequisites:** The `OneReal/` directory already exists (contains `ARCHITECTURE.md` and `.git/`). All files are created inside this directory. If starting fresh, run `mkdir OneReal && cd OneReal && git init` first.

- [ ] **Step 1: Create root configuration files**

`package.json`:
```json
{
  "name": "onereal",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "type-check": "turbo type-check"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.6.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "modules/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "lint": {},
    "type-check": {
      "dependsOn": ["^build"]
    }
  }
}
```

`tsconfig.json` (root base — all packages extend this):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules"]
}
```

`.gitignore`:
```
node_modules/
.next/
dist/
.turbo/
.env.local
.env*.local
*.tsbuildinfo
.DS_Store
```

`.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 2: Create all workspace package.json files**

`packages/types/package.json`:
```json
{
  "name": "@onereal/types",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`packages/ui/package.json`:
```json
{
  "name": "@onereal/ui",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./globals.css": "./src/globals.css"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.450.0",
    "tailwind-merge": "^2.5.0",
    "tailwindcss-animate": "^1.0.7",
    "sonner": "^1.5.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "@tanstack/react-table": "^8.20.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "@tanstack/react-table": "^8.20.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/database/package.json`:
```json
{
  "name": "@onereal/database",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.0",
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

`packages/auth/package.json`:
```json
{
  "name": "@onereal/auth",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@onereal/database": "workspace:*",
    "@onereal/types": "workspace:*",
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.0"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

`modules/portfolio/package.json`:
```json
{
  "name": "@onereal/portfolio",
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

`apps/web/package.json`:
```json
{
  "name": "@onereal/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.0",
    "@tanstack/react-query": "^5.60.0",
    "@tanstack/react-table": "^8.20.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "zod": "^3.23.0",
    "lucide-react": "^0.450.0",
    "sonner": "^1.5.0",
    "@onereal/ui": "workspace:*",
    "@onereal/database": "workspace:*",
    "@onereal/auth": "workspace:*",
    "@onereal/types": "workspace:*",
    "@onereal/portfolio": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "tailwindcss-animate": "^1.0.7"
  }
}
```

Placeholder module packages (each file):

`modules/transactions/package.json`:
```json
{ "name": "@onereal/transactions", "version": "0.0.0", "private": true }
```

`modules/tenants/package.json`:
```json
{ "name": "@onereal/tenants", "version": "0.0.0", "private": true }
```

`modules/maintenance/package.json`:
```json
{ "name": "@onereal/maintenance", "version": "0.0.0", "private": true }
```

`modules/listings/package.json`:
```json
{ "name": "@onereal/listings", "version": "0.0.0", "private": true }
```

- [ ] **Step 3: Create all tsconfig.json files**

`packages/types/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/ui/tsconfig.json`:
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

`packages/database/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/auth/tsconfig.json`:
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

`modules/portfolio/tsconfig.json`:
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

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    },
    "allowJs": true,
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create placeholder source files for workspace resolution**

Every package with an `exports` field needs at least a minimal index file so TypeScript and pnpm can resolve imports. Create these minimal files:

`packages/types/src/index.ts`:
```ts
// Populated in Task 2
export {};
```

`packages/ui/src/index.ts`:
```ts
// Populated in Task 3
export {};
```

`packages/database/src/index.ts`:
```ts
// Populated in Chunk 2
export {};
```

`packages/auth/src/index.ts`:
```ts
// Populated in Chunk 3
export {};
```

`modules/portfolio/src/index.ts`:
```ts
// Populated in Chunk 5
export {};
```

- [ ] **Step 5: Run pnpm install**

Run: `pnpm install`
Expected: All packages resolved, `pnpm-lock.yaml` created, no errors.

- [ ] **Step 6: Verify workspace recognition**

Run: `pnpm turbo build --dry`
Expected: Shows task graph listing all workspace packages. No errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize turborepo monorepo with all package shells"
```

---

### Task 2: @onereal/types — Enums & Domain Models

**Files:**
- Create: `packages/types/src/enums.ts`, `packages/types/src/models.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Write enums.ts**

`packages/types/src/enums.ts`:
```ts
export const PropertyType = {
  SINGLE_FAMILY: 'single_family',
  TOWNHOUSE: 'townhouse',
  APARTMENT_COMPLEX: 'apartment_complex',
  CONDO: 'condo',
  COMMERCIAL: 'commercial',
  OTHER: 'other',
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

export const PropertyStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SOLD: 'sold',
} as const;
export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];

export const UnitType = {
  STUDIO: 'studio',
  ONE_BED: '1bed',
  TWO_BED: '2bed',
  THREE_BED: '3bed',
  FOUR_BED: '4bed',
  COMMERCIAL_UNIT: 'commercial_unit',
  RESIDENTIAL: 'residential',
  OTHER: 'other',
} as const;
export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export const UnitStatus = {
  VACANT: 'vacant',
  OCCUPIED: 'occupied',
  MAINTENANCE: 'maintenance',
  NOT_AVAILABLE: 'not_available',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];

export const UserRole = {
  ADMIN: 'admin',
  LANDLORD: 'landlord',
  PROPERTY_MANAGER: 'property_manager',
  TENANT: 'tenant',
  CONTRACTOR: 'contractor',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrgType = {
  PERSONAL: 'personal',
  COMPANY: 'company',
} as const;
export type OrgType = (typeof OrgType)[keyof typeof OrgType];

export const MemberStatus = {
  INVITED: 'invited',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

export const LeaseStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  TERMINATED: 'terminated',
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];

export const TransactionType = {
  RENT: 'rent',
  DEPOSIT: 'deposit',
  FEE: 'fee',
  INVOICE: 'invoice',
  REFUND: 'refund',
  EXPENSE: 'expense',
  OTHER: 'other',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const PaymentMethod = {
  STRIPE: 'stripe',
  CASH: 'cash',
  CHECK: 'check',
  ZELLE: 'zelle',
  BANK_TRANSFER: 'bank_transfer',
  OTHER: 'other',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const MaintenancePriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  EMERGENCY: 'emergency',
} as const;
export type MaintenancePriority = (typeof MaintenancePriority)[keyof typeof MaintenancePriority];

export const MaintenanceStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_PARTS: 'waiting_parts',
  COMPLETED: 'completed',
  CLOSED: 'closed',
} as const;
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

export const MaintenanceCategory = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  HVAC: 'hvac',
  APPLIANCE: 'appliance',
  STRUCTURAL: 'structural',
  PEST: 'pest',
  OTHER: 'other',
} as const;
export type MaintenanceCategory = (typeof MaintenanceCategory)[keyof typeof MaintenanceCategory];
```

- [ ] **Step 2: Write models.ts**

`packages/types/src/models.ts`:
```ts
export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  logo_url: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  default_org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  status: string;
  invited_at: string | null;
  joined_at: string | null;
}

export interface Property {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  year_built: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  market_value: number | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Unit {
  id: string;
  property_id: string;
  unit_number: string;
  type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  rent_amount: number | null;
  deposit_amount: number | null;
  status: string;
  floor: number | null;
  features: string[];
  created_at: string;
  updated_at: string;
}

export interface PropertyImage {
  id: string;
  property_id: string;
  unit_id: string | null;
  url: string;
  caption: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PropertyWithUnits extends Property {
  units: Unit[];
}

export interface PropertyWithDetails extends Property {
  units: Unit[];
  images: PropertyImage[];
}

export interface PortfolioStats {
  total_properties: number;
  total_units: number;
  occupied_units: number;
  occupancy_rate: number;
  total_rent_potential: number;
}
```

- [ ] **Step 3: Update index.ts to re-export**

`packages/types/src/index.ts`:
```ts
export * from './enums';
export * from './models';
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm turbo type-check --filter=@onereal/types`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/
git commit -m "feat(types): add shared enums and domain model interfaces"
```

---

### Task 3: @onereal/ui — Design System with shadcn

**Files:**
- Create: `packages/ui/tailwind.config.ts`, `packages/ui/postcss.config.mjs`, `packages/ui/components.json`
- Create: `packages/ui/src/globals.css`, `packages/ui/src/lib/utils.ts`
- Create: shadcn-generated components via CLI
- Create: `packages/ui/src/components/stat-card.tsx`, `packages/ui/src/components/data-table.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create UI package config files**

`packages/ui/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

`packages/ui/postcss.config.mjs`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`packages/ui/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2: Install shadcn components (run BEFORE creating globals.css/utils.ts)**

Run from project root:
```bash
pnpm dlx shadcn@latest add button input card badge tabs dialog sheet dropdown-menu avatar form select textarea label table separator scroll-area tooltip sonner --cwd packages/ui --yes
```

Expected: Components generated in `packages/ui/src/components/ui/`. One file per component. Additional `@radix-ui/*` dependencies added to `packages/ui/package.json`. The CLI will also create `src/globals.css` and `src/lib/utils.ts` with default content.

After the command completes, verify `packages/ui/package.json` has all needed deps. If `react-hook-form`, `@hookform/resolvers`, or any `@radix-ui/*` packages are missing, add them manually.

- [ ] **Step 3: Overwrite globals.css and utils.ts with project-specific content**

Replace the shadcn-generated files with:

`packages/ui/src/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

`packages/ui/src/lib/utils.ts`:
```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Write custom stat-card component**

`packages/ui/src/components/stat-card.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: { value: number; positive: boolean };
  className?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {trend && (
          <p
            className={cn(
              'text-xs',
              trend.positive ? 'text-green-600' : 'text-red-600'
            )}
          >
            {trend.positive ? '+' : ''}
            {trend.value}% from last month
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Write custom data-table component**

`packages/ui/src/components/data-table.tsx`:
```tsx
'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
  });

  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write index.ts re-exports**

`packages/ui/src/index.ts`:
```ts
// shadcn/ui components
export { Button, buttonVariants } from '@/components/ui/button';
export { Input } from '@/components/ui/input';
export { Label } from '@/components/ui/label';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
export { Badge, badgeVariants } from '@/components/ui/badge';
export { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
export { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from '@/components/ui/form';
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
export { Textarea } from '@/components/ui/textarea';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
export { Separator } from '@/components/ui/separator';
export { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
export { Toaster } from '@/components/ui/sonner';

// Custom components
export { StatCard } from '@/components/stat-card';
export { DataTable } from '@/components/data-table';

// Utilities
export { cn } from '@/lib/utils';
```

- [ ] **Step 7: Verify UI package types**

Run: `pnpm turbo type-check --filter=@onereal/ui`
Expected: No errors (some shadcn components may have minor type issues — fix if needed).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): add shadcn design system with stat-card and data-table"
```

---

### Task 4: Next.js Web App Skeleton

**Files:**
- Create: `apps/web/next.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`
- Create: `apps/web/components/providers.tsx`

- [ ] **Step 1: Create Next.js config files**

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@onereal/ui',
    '@onereal/database',
    '@onereal/auth',
    '@onereal/types',
    '@onereal/portfolio',
  ],
};

export default nextConfig;
```

`apps/web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
import uiConfig from '../../packages/ui/tailwind.config';

const config: Config = {
  ...uiConfig,
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/*/src/**/*.{ts,tsx}',
    '../../modules/*/src/**/*.{ts,tsx}',
  ],
};

export default config;
```

`apps/web/postcss.config.mjs`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2: Create root layout and globals.css**

`apps/web/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

`apps/web/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OneReal — Property Management',
  description: 'Modern real estate rental management portal',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

`apps/web/app/page.tsx` (temporary — replaced by dashboard redirect later):
```tsx
export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold">OneReal</h1>
    </div>
  );
}
```

- [ ] **Step 3: Create providers component**

`apps/web/components/providers.tsx`:
```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from '@onereal/ui';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Verify dev server starts**

Run: `pnpm turbo dev --filter=@onereal/web`
Expected: Next.js dev server starts on http://localhost:3000. Page renders "OneReal" heading.

Press Ctrl+C to stop after verifying.

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold Next.js 15 app with layout and providers"
```

---

### Task 5: Full Monorepo Verification

- [ ] **Step 1: Run type-check across entire monorepo**

Run: `pnpm turbo type-check`
Expected: All packages pass type-check with no errors. Fix any issues before proceeding.

- [ ] **Step 2: Run build**

Run: `pnpm turbo build`
Expected: Web app builds successfully. Other packages have no build script (skip gracefully).

- [ ] **Step 3: Commit any fixes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix: resolve monorepo type-check issues"
```

---

## Chunk 2: Supabase & Database Package

### Task 6: Supabase Project Setup

**Files:**
- Create: `supabase/config.toml`

**Prerequisites:** A Supabase project must be created at https://supabase.com/dashboard. Copy the project URL and anon key to `.env.local` (from `.env.local.example`). Install Supabase CLI: `pnpm add -D supabase --workspace-root`.

- [ ] **Step 1: Initialize Supabase CLI**

Run from project root:
```bash
pnpm dlx supabase init
```

Expected: Creates `supabase/` directory with `config.toml` and `seed.sql`. If directory exists, accept overwrite for `config.toml`.

- [ ] **Step 2: Link to Supabase Cloud project**

Run:
```bash
pnpm dlx supabase link --project-ref <YOUR_PROJECT_REF>
```

Replace `<YOUR_PROJECT_REF>` with your Supabase project reference ID (found in project settings URL).

Expected: "Linked project" confirmation message.

- [ ] **Step 3: Enable required extensions**

Via Supabase Dashboard → SQL Editor, run:
```sql
CREATE EXTENSION IF NOT EXISTS "moddatetime" SCHEMA extensions;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "chore: initialize supabase project config"
```

---

### Task 7: Migration 001 — Core Tables

**Files:**
- Create: `supabase/migrations/001_core_tables.sql`

- [ ] **Step 1: Create migration file**

`supabase/migrations/001_core_tables.sql`:
```sql
-- ============================================================
-- Migration 001: Core Tables
-- organizations, profiles, org_members
-- Triggers: auto-create profile, auto-create personal org
-- RLS policies for all tables
-- ============================================================

-- organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'company')),
  logo_url TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- profiles (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  default_org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- org_members (join table)
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'landlord', 'property_manager', 'tenant', 'contractor')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'inactive')),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Indexes
CREATE INDEX idx_org_members_org_id ON org_members(org_id);
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_profiles_default_org ON profiles(default_org_id);

-- moddatetime triggers for updated_at
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Trigger: on_auth_user_created
-- When a new user registers, create a profile row
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Trigger: on_profile_created
-- When a profile is created, auto-create personal org + membership
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  slug_base TEXT;
  final_slug TEXT;
BEGIN
  -- Generate slug from email (part before @)
  slug_base := lower(split_part(COALESCE(NEW.email, NEW.id::text), '@', 1));
  slug_base := regexp_replace(slug_base, '[^a-z0-9]', '-', 'g');
  slug_base := regexp_replace(slug_base, '-+', '-', 'g');
  slug_base := trim(BOTH '-' FROM slug_base);

  -- Handle slug collision by appending random suffix
  final_slug := slug_base;
  WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = final_slug) LOOP
    final_slug := slug_base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create personal org
  INSERT INTO organizations (name, slug, type)
  VALUES ('Personal', final_slug, 'personal')
  RETURNING id INTO new_org_id;

  -- Add user as admin of personal org
  INSERT INTO org_members (org_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'admin', 'active');

  -- Set as default org
  UPDATE profiles SET default_org_id = new_org_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- ============================================================
-- RLS: Enable and create policies
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update own row
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- organizations: members can view their orgs
CREATE POLICY "Members can view org"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- organizations: admins can update their orgs
CREATE POLICY "Admins can update org"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin')
    )
  );

-- org_members: members can view members in their orgs
CREATE POLICY "Members can view org members"
  ON org_members FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- org_members: admins can insert/update/delete members
CREATE POLICY "Admins can manage org members"
  ON org_members FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update org members"
  ON org_members FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete org members"
  ON org_members FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role = 'admin'
    )
  );

-- organizations: authenticated users can create orgs (for onboarding company org creation)
CREATE POLICY "Authenticated users can create orgs"
  ON organizations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- org_members: users can add themselves as first member of a new org (for onboarding)
CREATE POLICY "Users can add themselves to their own new org"
  ON org_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM org_members existing WHERE existing.org_id = org_members.org_id
    )
  );
```

- [ ] **Step 2: Push migration to Supabase Cloud**

Run:
```bash
pnpm dlx supabase db push
```

Expected: Migration applied successfully. Tables `organizations`, `profiles`, `org_members` created with triggers and RLS policies.

- [ ] **Step 3: Verify in Supabase Dashboard**

Open Supabase Dashboard → Table Editor. Confirm:
- All 3 tables exist with correct columns
- RLS is enabled (shield icon) on all tables

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/001_core_tables.sql
git commit -m "feat(db): add core tables — organizations, profiles, org_members with triggers and RLS"
```

---

### Task 8: Migration 002 — Portfolio Tables

**Files:**
- Create: `supabase/migrations/002_portfolio_tables.sql`

- [ ] **Step 1: Create migration file**

`supabase/migrations/002_portfolio_tables.sql`:
```sql
-- ============================================================
-- Migration 002: Portfolio Tables
-- properties, units, property_images
-- RLS policies (units + images use nested subquery through properties)
-- ============================================================

-- properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single_family', 'townhouse', 'apartment_complex', 'condo', 'commercial', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  year_built INTEGER,
  purchase_price DECIMAL(12,2),
  purchase_date DATE,
  market_value DECIMAL(12,2),
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- units
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  type TEXT CHECK (type IN ('studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other')),
  bedrooms INTEGER,
  bathrooms DECIMAL(3,1),
  square_feet INTEGER,
  rent_amount DECIMAL(10,2),
  deposit_amount DECIMAL(10,2),
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'maintenance', 'not_available')),
  floor INTEGER,
  features JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(property_id, unit_number)
);

-- property_images
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  caption TEXT,
  is_primary BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_properties_org_id ON properties(org_id);
CREATE INDEX idx_units_property_id ON units(property_id);
CREATE INDEX idx_property_images_property_id ON property_images(property_id);

-- moddatetime triggers
CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- RLS: properties (has direct org_id)
-- ============================================================
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view properties"
  ON properties FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Managers can insert properties"
  ON properties FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

CREATE POLICY "Managers can update properties"
  ON properties FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

CREATE POLICY "Managers can delete properties"
  ON properties FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND status = 'active'
        AND role IN ('admin', 'landlord', 'property_manager')
    )
  );

-- ============================================================
-- RLS: units (no org_id — join through properties)
-- ============================================================
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view units"
  ON units FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

CREATE POLICY "Managers can insert units"
  ON units FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can update units"
  ON units FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can delete units"
  ON units FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

-- ============================================================
-- RLS: property_images (no org_id — join through properties)
-- ============================================================
ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view property images"
  ON property_images FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

CREATE POLICY "Managers can insert property images"
  ON property_images FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can update property images"
  ON property_images FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

CREATE POLICY "Managers can delete property images"
  ON property_images FOR DELETE
  USING (
    property_id IN (
      SELECT id FROM properties WHERE org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND status = 'active'
          AND role IN ('admin', 'landlord', 'property_manager')
      )
    )
  );

-- ============================================================
-- Supabase Storage: property-images bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public read for property images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

CREATE POLICY "Authenticated users can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Authenticated users can delete own property images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
  );
```

- [ ] **Step 2: Push migration**

Run:
```bash
pnpm dlx supabase db push
```

Expected: Migration applied. Tables `properties`, `units`, `property_images` created. Storage bucket `property-images` created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_portfolio_tables.sql
git commit -m "feat(db): add portfolio tables — properties, units, images with RLS and storage"
```

---

### Task 9: Migration 003 — Placeholder Tables

**Files:**
- Create: `supabase/migrations/003_placeholder_tables.sql`

- [ ] **Step 1: Create migration file**

`supabase/migrations/003_placeholder_tables.sql`:
```sql
-- ============================================================
-- Migration 003: Placeholder Tables
-- leases, transactions, maintenance_requests
-- Full schema for valid foreign keys. No UI until later phases.
-- ============================================================

-- leases
CREATE TABLE leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES profiles(id),
  start_date DATE,
  end_date DATE,
  rent_amount DECIMAL(10,2),
  deposit_amount DECIMAL(10,2),
  payment_due_day INTEGER CHECK (payment_due_day BETWEEN 1 AND 28),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  terms JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id UUID REFERENCES leases(id) ON DELETE SET NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  tenant_id UUID REFERENCES profiles(id),
  type TEXT CHECK (type IN ('rent', 'deposit', 'fee', 'invoice', 'refund', 'expense', 'other')),
  amount DECIMAL(10,2),
  payment_method TEXT CHECK (payment_method IN ('stripe', 'cash', 'check', 'zelle', 'bank_transfer', 'other')),
  payment_status TEXT CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  stripe_payment_id TEXT,
  due_date DATE,
  paid_date DATE,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- maintenance_requests
CREATE TABLE maintenance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id),
  reported_by UUID NOT NULL REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_parts', 'completed', 'closed')),
  category TEXT CHECK (category IN ('plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest', 'other')),
  images JSONB DEFAULT '[]',
  estimated_cost DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  scheduled_date DATE,
  completed_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_leases_org_id ON leases(org_id);
CREATE INDEX idx_leases_unit_id ON leases(unit_id);
CREATE INDEX idx_transactions_org_id ON transactions(org_id);
CREATE INDEX idx_transactions_unit_id ON transactions(unit_id);
CREATE INDEX idx_maintenance_org_id ON maintenance_requests(org_id);
CREATE INDEX idx_maintenance_unit_id ON maintenance_requests(unit_id);

-- moddatetime triggers
CREATE TRIGGER leases_updated_at
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER maintenance_requests_updated_at
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- RLS: All placeholder tables use direct org_id
-- ============================================================
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

-- leases
CREATE POLICY "Members can view leases"
  ON leases FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage leases"
  ON leases FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));

-- transactions
CREATE POLICY "Members can view transactions"
  ON transactions FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage transactions"
  ON transactions FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));

-- maintenance_requests
CREATE POLICY "Members can view maintenance requests"
  ON maintenance_requests FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Managers can manage maintenance requests"
  ON maintenance_requests FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'landlord', 'property_manager')));
```

- [ ] **Step 2: Push migration**

Run:
```bash
pnpm dlx supabase db push
```

Expected: Migration applied. All placeholder tables created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_placeholder_tables.sql
git commit -m "feat(db): add placeholder tables — leases, transactions, maintenance_requests"
```

---

### Task 10: Generate Supabase Types & Database Package

**Files:**
- Create: `packages/database/src/types.ts` (generated)
- Create: `packages/database/src/client.ts`, `packages/database/src/server.ts`
- Create: `packages/database/src/queries/organizations.ts`, `profiles.ts`, `properties.ts`, `units.ts`
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: Generate TypeScript types from Supabase**

Run:
```bash
pnpm dlx supabase gen types typescript --linked > packages/database/src/types.ts
```

Expected: `types.ts` created with full database type definitions including `Database` type.

- [ ] **Step 2: Write database client wrappers**

`packages/database/src/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

`packages/database/src/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component.
            // This can be ignored if middleware refreshes user sessions.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Write query helpers**

`packages/database/src/queries/organizations.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getOrganization(client: Client, orgId: string) {
  const { data, error } = await client
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getUserOrganizations(client: Client, userId: string) {
  const { data, error } = await client
    .from('org_members')
    .select('org_id, role, organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  return data;
}

export async function getOrgMembers(client: Client, orgId: string) {
  const { data, error } = await client
    .from('org_members')
    .select('*, profiles(*)')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (error) throw error;
  return data;
}

export async function updateOrganization(
  client: Client,
  orgId: string,
  updates: { name?: string; logo_url?: string | null }
) {
  const { data, error } = await client
    .from('organizations')
    .update(updates)
    .eq('id', orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createCompanyOrg(
  client: Client,
  userId: string,
  name: string,
  slug: string
) {
  // Create org
  const { data: org, error: orgError } = await client
    .from('organizations')
    .insert({ name, slug, type: 'company' })
    .select()
    .single();

  if (orgError) throw orgError;

  // Add user as admin
  const { error: memberError } = await client
    .from('org_members')
    .insert({ org_id: org.id, user_id: userId, role: 'admin', status: 'active' });

  if (memberError) throw memberError;

  // Set as default org
  const { error: profileError } = await client
    .from('profiles')
    .update({ default_org_id: org.id })
    .eq('id', userId);

  if (profileError) throw profileError;

  return org;
}
```

`packages/database/src/queries/profiles.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(
  client: Client,
  userId: string,
  updates: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    avatar_url?: string | null;
    default_org_id?: string;
  }
) {
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

`packages/database/src/queries/properties.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export interface PropertyFilters {
  orgId: string;
  type?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function getProperties(client: Client, filters: PropertyFilters) {
  const { orgId, type, status, search, page = 1, pageSize = 20 } = filters;

  let query = client
    .from('properties')
    .select('*, units(id, status, rent_amount)', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);
  if (search) {
    query = query.or(`name.ilike.%${search}%,address_line1.ilike.%${search}%,city.ilike.%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { data: data ?? [], count: count ?? 0 };
}

export async function getProperty(client: Client, propertyId: string) {
  const { data, error } = await client
    .from('properties')
    .select('*, units(*), property_images(*)')
    .eq('id', propertyId)
    .single();

  if (error) throw error;
  return data;
}

export async function getPortfolioStats(client: Client, orgId: string) {
  const { data: properties, error } = await client
    .from('properties')
    .select('id, units(id, status, rent_amount)')
    .eq('org_id', orgId);

  if (error) throw error;

  const allUnits = (properties ?? []).flatMap((p) => p.units ?? []);
  const occupiedUnits = allUnits.filter((u) => u.status === 'occupied');
  const totalRent = allUnits.reduce((sum, u) => sum + (Number(u.rent_amount) || 0), 0);

  return {
    total_properties: properties?.length ?? 0,
    total_units: allUnits.length,
    occupied_units: occupiedUnits.length,
    occupancy_rate: allUnits.length > 0
      ? Math.round((occupiedUnits.length / allUnits.length) * 100)
      : 0,
    total_rent_potential: totalRent,
  };
}
```

`packages/database/src/queries/units.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getUnits(client: Client, propertyId: string) {
  const { data, error } = await client
    .from('units')
    .select('*')
    .eq('property_id', propertyId)
    .order('unit_number');

  if (error) throw error;
  return data ?? [];
}

export async function getUnit(client: Client, unitId: string) {
  const { data, error } = await client
    .from('units')
    .select('*')
    .eq('id', unitId)
    .single();

  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Update database index.ts**

`packages/database/src/index.ts`:
```ts
export { createClient } from './client';
export { createServerSupabaseClient } from './server';
export type { Database } from './types';

// Query helpers
export * from './queries/organizations';
export * from './queries/profiles';
export * from './queries/properties';
export * from './queries/units';
```

- [ ] **Step 5: Create web app Supabase client wrappers**

These thin wrappers in the web app import from `@onereal/database`:

`apps/web/lib/supabase/client.ts`:
```ts
import { createClient } from '@onereal/database';
export { createClient };
```

`apps/web/lib/supabase/server.ts`:
```ts
import { createServerSupabaseClient } from '@onereal/database';
export { createServerSupabaseClient };
```

- [ ] **Step 6: Create seed.sql with dev data**

`supabase/seed.sql`:
```sql
-- Seed data is applied after migrations.
-- For development, register a user through the app UI.
-- The on_auth_user_created trigger auto-creates profile + personal org.
-- Then create properties via the app.
-- This file is intentionally minimal — seed via UI for realistic testing.
```

- [ ] **Step 7: Verify type-check**

Run: `pnpm turbo type-check --filter=@onereal/database`
Expected: No errors. The generated types align with our queries.

Note: `server.ts` imports from `next/headers` which requires Next.js. If type-check fails on this, add `"next": "^15.0.0"` to `packages/database/devDependencies` or mark it as a peer dependency.

- [ ] **Step 8: Commit**

```bash
git add packages/database/ apps/web/lib/ supabase/
git commit -m "feat(database): add Supabase clients, generated types, and query helpers"
```

---

## Chunk 3: Authentication & Onboarding

### Task 11: @onereal/auth — Server Actions

**Files:**
- Create: `packages/auth/src/actions/sign-in.ts`, `sign-up.ts`, `sign-out.ts`, `sign-in-with-google.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write sign-in action**

`packages/auth/src/actions/sign-in.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import { redirect } from 'next/navigation';

export async function signIn(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { success: false as const, error: error.message };
  }

  redirect('/');
}
```

- [ ] **Step 2: Write sign-up action**

`packages/auth/src/actions/sign-up.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import { redirect } from 'next/navigation';

export async function signUp(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  redirect('/onboarding');
}
```

- [ ] **Step 3: Write sign-out and Google OAuth actions**

`packages/auth/src/actions/sign-out.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

`packages/auth/src/actions/sign-in-with-google.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import { redirect } from 'next/navigation';

export async function signInWithGoogle() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  redirect(data.url);
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/actions/
git commit -m "feat(auth): add sign-in, sign-up, sign-out, and Google OAuth server actions"
```

---

### Task 12: @onereal/auth — Hooks & Components

**Files:**
- Create: `packages/auth/src/hooks/use-user.ts`, `use-session.ts`, `use-role.ts`
- Create: `packages/auth/src/components/role-gate.tsx`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write auth hooks**

`packages/auth/src/hooks/use-session.ts`:
```ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@onereal/database';
import type { Session } from '@supabase/supabase-js';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase]);

  return { session, loading };
}
```

`packages/auth/src/hooks/use-user.ts`:
```ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, getProfile, getUserOrganizations } from '@onereal/database';
import type { Profile, Organization } from '@onereal/types';
import { useSession } from './use-session';

interface UserState {
  profile: Profile | null;
  activeOrg: Organization | null;
  organizations: Array<{ org_id: string; role: string; organizations: Organization }>;
  loading: boolean;
}

export function useUser() {
  const { session, loading: sessionLoading } = useSession();
  const [state, setState] = useState<UserState>({
    profile: null,
    activeOrg: null,
    organizations: [],
    loading: true,
  });
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setState({ profile: null, activeOrg: null, organizations: [], loading: false });
      return;
    }

    async function loadUser() {
      try {
        const [profile, orgs] = await Promise.all([
          getProfile(supabase, session!.user.id),
          getUserOrganizations(supabase, session!.user.id),
        ]);

        const activeOrg = profile.default_org_id
          ? (orgs.find((o) => o.org_id === profile.default_org_id)?.organizations as Organization) ?? null
          : null;

        setState({
          profile: profile as Profile,
          activeOrg,
          organizations: orgs as UserState['organizations'],
          loading: false,
        });
      } catch {
        setState((prev) => ({ ...prev, loading: false }));
      }
    }

    loadUser();
  }, [session, sessionLoading, supabase]);

  return state;
}
```

`packages/auth/src/hooks/use-role.ts`:
```ts
'use client';

import { useUser } from './use-user';

export function useRole() {
  const { organizations, activeOrg } = useUser();

  if (!activeOrg) return null;

  const membership = organizations.find((o) => o.org_id === activeOrg.id);
  return membership?.role ?? null;
}
```

- [ ] **Step 2: Write RoleGate component**

`packages/auth/src/components/role-gate.tsx`:
```tsx
'use client';

import { useRole } from '../hooks/use-role';
import type { ReactNode } from 'react';

interface RoleGateProps {
  role: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ role, children, fallback = null }: RoleGateProps) {
  const currentRole = useRole();

  if (!currentRole) return fallback;

  const allowedRoles = Array.isArray(role) ? role : [role];
  if (!allowedRoles.includes(currentRole)) return fallback;

  return <>{children}</>;
}
```

- [ ] **Step 3: Update auth index.ts**

`packages/auth/src/index.ts` — Client-only exports (hooks + components):
```ts
// Hooks (client-only)
export { useSession } from './hooks/use-session';
export { useUser } from './hooks/use-user';
export { useRole } from './hooks/use-role';

// Components (client-only)
export { RoleGate } from './components/role-gate';
```

Note: Server actions are NOT re-exported from the barrel file to avoid mixing `'use client'` and `'use server'` in one module. Import actions directly:
```ts
import { signOut } from '@onereal/auth/actions/sign-out';
```

Update `packages/auth/package.json` exports to support deep imports:
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./actions/*": "./src/actions/*.ts"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/auth/
git commit -m "feat(auth): add hooks (useUser, useSession, useRole), RoleGate, and index exports"
```

---

### Task 13: Auth Pages — Login & Register

**Files:**
- Create: `apps/web/app/(auth)/layout.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`

- [ ] **Step 1: Create auth layout**

`apps/web/app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create login page**

`apps/web/app/(auth)/login/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Button, Input, Label, Separator,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  async function handleGoogleSignIn() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    if (data.url) window.location.href = data.url;
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your OneReal account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-sm text-muted-foreground hover:underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-4">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">OR</span>
          <Separator className="flex-1" />
        </div>
        <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
          Continue with Google
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">Sign up</Link>
        </p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 3: Create register page**

`apps/web/app/(auth)/register/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Button, Input, Label, Separator,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success('Account created! Redirecting...');
    router.push('/onboarding');
    router.refresh();
  }

  async function handleGoogleSignIn() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    if (data.url) window.location.href = data.url;
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>Get started with OneReal</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password" type="password" placeholder="Min 6 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword" type="password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-4">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">OR</span>
          <Separator className="flex-1" />
        </div>
        <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
          Continue with Google
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(auth\)/
git commit -m "feat(auth): add login and register pages with Google OAuth"
```

---

### Task 14: Auth Pages — Forgot/Reset Password + OAuth Callback

**Files:**
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/app/auth/callback/route.ts`

- [ ] **Step 1: Create forgot-password page**

`apps/web/app/(auth)/forgot-password/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Button, Input, Label,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle>Check your email</CardTitle>
          <CardDescription>We sent a password reset link to {email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button variant="outline" className="w-full">Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Forgot password?</CardTitle>
        <CardDescription>Enter your email to receive a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="hover:underline">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create reset-password page**

`apps/web/app/(auth)/reset-password/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Button, Input, Label,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('Password updated!');
    router.push('/login');
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Reset password</CardTitle>
        <CardDescription>Enter your new password</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword" type="password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Updating...' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create OAuth callback route**

`apps/web/app/auth/callback/route.ts`:
```ts
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if onboarding is complete
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, default_org_id')
          .eq('id', user.id)
          .single();

        if (!profile?.first_name) {
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(auth\)/forgot-password/ apps/web/app/\(auth\)/reset-password/ apps/web/app/auth/
git commit -m "feat(auth): add forgot/reset password pages and OAuth callback route"
```

---

### Task 15: Middleware — Auth & Onboarding Guards

**Files:**
- Create: `apps/web/middleware.ts`

- [ ] **Step 1: Write middleware**

`apps/web/middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isOnboarding = pathname.startsWith('/onboarding');

  // Allow auth callback always
  if (isAuthCallback) return supabaseResponse;

  // Unauthenticated user on protected path → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated user on public auth path → dashboard
  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Authenticated user → check onboarding completion
  if (user && !isOnboarding && !isPublicPath) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, default_org_id')
      .eq('id', user.id)
      .single();

    // Onboarding incomplete: first_name is null
    if (!profile?.first_name) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 2: Verify middleware compiles**

Run: `pnpm turbo type-check --filter=@onereal/web`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(auth): add middleware for auth guards and onboarding redirect"
```

---

### Task 16: Onboarding Wizard

**Files:**
- Create: `apps/web/components/onboarding/profile-step.tsx`
- Create: `apps/web/components/onboarding/org-step.tsx`
- Create: `apps/web/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Create profile step component**

`apps/web/components/onboarding/profile-step.tsx`:
```tsx
'use client';

import { Button, Input, Label } from '@onereal/ui';

interface ProfileStepProps {
  firstName: string;
  lastName: string;
  phone: string;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
}

export function ProfileStep({ firstName, lastName, phone, onChange, onNext }: ProfileStepProps) {
  const isValid = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Complete your profile</h2>
        <p className="text-sm text-muted-foreground">Tell us a bit about yourself</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name *</Label>
        <Input
          id="firstName" value={firstName}
          onChange={(e) => onChange('firstName', e.target.value)} required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name *</Label>
        <Input
          id="lastName" value={lastName}
          onChange={(e) => onChange('lastName', e.target.value)} required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone" type="tel" value={phone}
          onChange={(e) => onChange('phone', e.target.value)}
        />
      </div>
      <Button className="w-full" onClick={onNext} disabled={!isValid}>
        Continue
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create org step component**

`apps/web/components/onboarding/org-step.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button, Input, Label, Card, CardContent } from '@onereal/ui';
import { Building2, User } from 'lucide-react';

interface OrgStepProps {
  onSelectPersonal: () => void;
  onCreateCompany: (name: string, slug: string) => void;
  loading: boolean;
}

export function OrgStep({ onSelectPersonal, onCreateCompany, loading }: OrgStepProps) {
  const [mode, setMode] = useState<'choose' | 'company'>('choose');
  const [companyName, setCompanyName] = useState('');

  function generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  if (mode === 'company') {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Create your company</h2>
          <p className="text-sm text-muted-foreground">Set up your property management company</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Company Name</Label>
          <Input
            id="companyName" value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="My Properties LLC"
          />
        </div>
        {companyName && (
          <p className="text-xs text-muted-foreground">
            URL: onereal.app/{generateSlug(companyName)}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setMode('choose')} disabled={loading}>
            Back
          </Button>
          <Button
            className="flex-1"
            onClick={() => onCreateCompany(companyName, generateSlug(companyName))}
            disabled={!companyName.trim() || loading}
          >
            {loading ? 'Creating...' : 'Create company'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">How will you use OneReal?</h2>
        <p className="text-sm text-muted-foreground">You can change this later</p>
      </div>
      <Card className="cursor-pointer hover:border-primary" onClick={onSelectPersonal}>
        <CardContent className="flex items-center gap-4 p-4">
          <User className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Individual Landlord</p>
            <p className="text-sm text-muted-foreground">I manage my own properties</p>
          </div>
        </CardContent>
      </Card>
      <Card className="cursor-pointer hover:border-primary" onClick={() => setMode('company')}>
        <CardContent className="flex items-center gap-4 p-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Property Management Company</p>
            <p className="text-sm text-muted-foreground">I manage properties for others</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create onboarding page**

`apps/web/app/(auth)/onboarding/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@onereal/ui';
import { ProfileStep } from '@/components/onboarding/profile-step';
import { OrgStep } from '@/components/onboarding/org-step';
import { toast } from 'sonner';

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  function handleProfileChange(field: string, value: string) {
    if (field === 'firstName') setFirstName(value);
    if (field === 'lastName') setLastName(value);
    if (field === 'phone') setPhone(value);
  }

  async function saveProfileAndContinue() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ first_name: firstName, last_name: lastName, phone: phone || null })
      .eq('id', user.id);

    if (error) {
      toast.error('Failed to save profile');
      return;
    }

    setStep(2);
  }

  async function handleSelectPersonal() {
    setLoading(true);
    // Personal org already exists from trigger — just redirect
    router.push('/');
    router.refresh();
  }

  async function handleCreateCompany(name: string, slug: string) {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Create company org
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name, slug, type: 'company' })
      .select()
      .single();

    if (orgError) {
      toast.error(orgError.message.includes('duplicate') ? 'That URL is taken. Try a different name.' : orgError.message);
      setLoading(false);
      return;
    }

    // Add as admin
    await supabase.from('org_members').insert({
      org_id: org.id, user_id: user.id, role: 'admin', status: 'active',
    });

    // Set as default org
    await supabase.from('profiles').update({ default_org_id: org.id }).eq('id', user.id);

    router.push('/');
    router.refresh();
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-6">
        <div className="mb-6 flex justify-center gap-2">
          <div className={`h-2 w-16 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-16 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
        </div>
        {step === 1 ? (
          <ProfileStep
            firstName={firstName} lastName={lastName} phone={phone}
            onChange={handleProfileChange} onNext={saveProfileAndContinue}
          />
        ) : (
          <OrgStep
            onSelectPersonal={handleSelectPersonal}
            onCreateCompany={handleCreateCompany}
            loading={loading}
          />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Verify auth flow compiles**

Run: `pnpm turbo type-check --filter=@onereal/web`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/ apps/web/app/\(auth\)/onboarding/
git commit -m "feat(auth): add two-step onboarding wizard (profile + org choice)"
```

---

## Chunk 4: Dashboard Shell

### Task 17: Dashboard Layout Shell

**Files:**
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Create sidebar component**

`apps/web/components/dashboard/sidebar.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@onereal/ui';
import {
  LayoutDashboard, Building2, CreditCard, Users, Wrench,
  Settings, ChevronLeft, ChevronRight, Menu,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, disabled: false },
  { label: 'Properties', href: '/properties', icon: Building2, disabled: false },
  { label: 'Transactions', href: '/transactions', icon: CreditCard, disabled: true, badge: 'Soon' },
  { label: 'Tenants', href: '/tenants', icon: Users, disabled: true, badge: 'Soon' },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, disabled: true, badge: 'Soon' },
];

const bottomItems = [
  { label: 'Settings', href: '/settings', icon: Settings, disabled: false },
];

function NavLink({
  item,
  collapsed,
  pathname,
}: {
  item: (typeof navItems)[0];
  collapsed: boolean;
  pathname: string;
}) {
  const isActive =
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.disabled ? '#' : item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        item.disabled && 'pointer-events-none opacity-50',
        collapsed && 'justify-center px-2'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1">{item.label}</span>
          {item.badge && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarContent({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn('flex items-center gap-2 px-3 py-2', collapsed && 'justify-center')}>
        {!collapsed && <span className="text-lg font-bold">OneReal</span>}
        {collapsed && <span className="text-lg font-bold">O</span>}
        {onToggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('ml-auto h-6 w-6', collapsed && 'ml-0')}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        <TooltipProvider delayDuration={0}>
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </TooltipProvider>
      </nav>

      <nav className="flex flex-col gap-1">
        <TooltipProvider delayDuration={0}>
          {bottomItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </TooltipProvider>
      </nav>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden h-screen border-r bg-card transition-all duration-300 md:block',
          collapsed ? 'w-[60px]' : 'w-[240px]'
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="fixed left-4 top-3 z-40 md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[240px] p-0">
          <SidebarContent collapsed={false} />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 2: Create placeholder topbar (replaced in Task 18)**

`apps/web/components/dashboard/topbar.tsx`:
```tsx
export function Topbar() {
  return (
    <header className="flex h-14 items-center border-b px-6">
      <span className="text-sm text-muted-foreground">Loading...</span>
    </header>
  );
}
```

- [ ] **Step 3: Create dashboard layout**

`apps/web/app/(dashboard)/layout.tsx`:
```tsx
import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(dashboard\)/layout.tsx apps/web/components/dashboard/sidebar.tsx apps/web/components/dashboard/topbar.tsx
git commit -m "feat(dashboard): add sidebar with collapsible nav and mobile sheet"
```

---

### Task 18: Topbar — Breadcrumbs, Org Switcher, User Menu

**Files:**
- Create: `apps/web/components/dashboard/topbar.tsx`
- Create: `apps/web/components/dashboard/breadcrumbs.tsx`
- Create: `apps/web/components/dashboard/org-switcher.tsx`
- Create: `apps/web/components/dashboard/user-menu.tsx`

- [ ] **Step 1: Create breadcrumbs component**

`apps/web/components/dashboard/breadcrumbs.tsx`:
```tsx
'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const labelMap: Record<string, string> = {
  '': 'Dashboard',
  properties: 'Properties',
  new: 'New Property',
  edit: 'Edit',
  transactions: 'Transactions',
  tenants: 'Tenants',
  maintenance: 'Maintenance',
  settings: 'Settings',
  profile: 'Profile',
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Build breadcrumb items
  const items = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = labelMap[segment] || segment;
    const isLast = index === segments.length - 1;
    return { label, href, isLast };
  });

  // Prepend Dashboard if not on root
  if (segments.length > 0) {
    items.unshift({ label: 'Dashboard', href: '/', isLast: false });
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <span key={item.href} className="flex items-center gap-1.5">
          {index > 0 && <span>/</span>}
          {item.isLast ? (
            <span className="font-medium text-foreground">{item.label}</span>
          ) : (
            <Link href={item.href} className="hover:text-foreground">{item.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Create org switcher**

`apps/web/components/dashboard/org-switcher.tsx`:
```tsx
'use client';

import { useUser } from '@onereal/auth';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Button,
} from '@onereal/ui';
import { Building2, ChevronDown, Check } from 'lucide-react';

export function OrgSwitcher() {
  const { activeOrg, organizations, loading } = useUser();
  const router = useRouter();
  const supabase = createClient();

  if (loading || !activeOrg) return null;

  async function switchOrg(orgId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('profiles').update({ default_org_id: orgId }).eq('id', user.id);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Building2 className="h-4 w-4" />
          <span className="max-w-[150px] truncate">{activeOrg.name}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((mem) => (
          <DropdownMenuItem
            key={mem.org_id}
            onClick={() => switchOrg(mem.org_id)}
            className="gap-2"
          >
            {mem.org_id === activeOrg.id && <Check className="h-4 w-4" />}
            {mem.org_id !== activeOrg.id && <div className="w-4" />}
            <span>{(mem.organizations as { name: string }).name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Create user menu**

`apps/web/components/dashboard/user-menu.tsx`:
```tsx
'use client';

import { useUser } from '@onereal/auth';
import { signOut } from '@onereal/auth/actions/sign-out';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Avatar, AvatarFallback, AvatarImage,
} from '@onereal/ui';
import { Settings, User, LogOut } from 'lucide-react';
import Link from 'next/link';

export function UserMenu() {
  const { profile, loading } = useUser();

  if (loading || !profile) return null;

  const initials = [profile.first_name?.[0], profile.last_name?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Avatar className="h-8 w-8 cursor-pointer">
          <AvatarImage src={profile.avatar_url || undefined} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{profile.first_name} {profile.last_name}</p>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile" className="gap-2">
            <User className="h-4 w-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="gap-2">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="gap-2 text-destructive">
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Replace placeholder topbar with full implementation**

Replace the placeholder `apps/web/components/dashboard/topbar.tsx` (from Task 17) with:

`apps/web/components/dashboard/topbar.tsx`:
```tsx
import { Breadcrumbs } from './breadcrumbs';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="pl-10 md:pl-0">
        <Breadcrumbs />
      </div>
      <div className="flex items-center gap-3">
        <OrgSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard/
git commit -m "feat(dashboard): add topbar with breadcrumbs, org switcher, and user menu"
```

---

### Task 19: Dashboard Home Page

**Files:**
- Create: `apps/web/app/(dashboard)/page.tsx`
- Remove: `apps/web/app/page.tsx` (the temporary page from Task 4)

- [ ] **Step 1: Delete temporary root page**

Delete `apps/web/app/page.tsx` (the one that just shows "OneReal" heading). The dashboard layout's `page.tsx` at `(dashboard)/page.tsx` serves as the new root page.

- [ ] **Step 2: Create dashboard home page**

`apps/web/app/(dashboard)/page.tsx`:
```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPortfolioStats } from '@onereal/database';
import { StatCard, Button } from '@onereal/ui';
import { Building2, DoorOpen, Percent, DollarSign, Plus } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('default_org_id')
    .eq('id', user.id)
    .single();

  if (!profile?.default_org_id) return null;

  const stats = await getPortfolioStats(supabase, profile.default_org_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your portfolio</p>
        </div>
        <Link href="/properties/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Add Property
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={stats.total_properties}
          icon={Building2}
          description="Active properties"
        />
        <StatCard
          title="Total Units"
          value={stats.total_units}
          icon={DoorOpen}
          description={`${stats.occupied_units} occupied`}
        />
        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancy_rate}%`}
          icon={Percent}
          description="Across all properties"
        />
        <StatCard
          title="Rent Potential"
          value={`$${stats.total_rent_potential.toLocaleString()}`}
          icon={DollarSign}
          description="Monthly total"
        />
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="mb-2 font-medium">Recent Activity</h3>
        <p className="text-sm text-muted-foreground">
          Activity will appear here as you manage properties.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify dashboard renders**

Run: `pnpm turbo dev --filter=@onereal/web`
Expected: After logging in, dashboard shows stat cards and recent activity placeholder. Press Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(dashboard\)/page.tsx
git rm apps/web/app/page.tsx 2>/dev/null; true
git commit -m "feat(dashboard): add home page with portfolio stat cards and quick actions"
```

---

## Chunk 5: Portfolio Module — Schemas, Actions & Hooks

### Task 20: Portfolio Zod Schemas

**Files:**
- Create: `modules/portfolio/src/schemas/property-schema.ts`
- Create: `modules/portfolio/src/schemas/unit-schema.ts`

- [ ] **Step 1: Write property schema**

`modules/portfolio/src/schemas/property-schema.ts`:
```ts
import { z } from 'zod';

export const propertySchema = z.object({
  name: z.string().min(1, 'Property name is required'),
  type: z.enum(['single_family', 'townhouse', 'apartment_complex', 'condo', 'commercial', 'other']),
  status: z.enum(['active', 'inactive', 'sold']).default('active'),
  address_line1: z.string().optional().default(''),
  address_line2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  zip: z.string().optional().default(''),
  country: z.string().default('US'),
  year_built: z.coerce.number().int().min(1800).max(2100).optional().nullable(),
  purchase_price: z.coerce.number().min(0).optional().nullable(),
  purchase_date: z.string().optional().nullable(),
  market_value: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().optional().default(''),
});

export type PropertyFormValues = z.infer<typeof propertySchema>;
```

- [ ] **Step 2: Write unit schema**

`modules/portfolio/src/schemas/unit-schema.ts`:
```ts
import { z } from 'zod';

export const unitSchema = z.object({
  unit_number: z.string().min(1, 'Unit number is required'),
  type: z.enum(['studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other']).optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).optional().nullable(),
  bathrooms: z.coerce.number().min(0).optional().nullable(),
  square_feet: z.coerce.number().int().min(0).optional().nullable(),
  rent_amount: z.coerce.number().min(0).optional().nullable(),
  deposit_amount: z.coerce.number().min(0).optional().nullable(),
  status: z.enum(['vacant', 'occupied', 'maintenance', 'not_available']).default('vacant'),
  floor: z.coerce.number().int().optional().nullable(),
});

export type UnitFormValues = z.infer<typeof unitSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add modules/portfolio/src/schemas/
git commit -m "feat(portfolio): add Zod schemas for property and unit validation"
```

---

### Task 21: Portfolio Server Actions — Properties

**Files:**
- Create: `modules/portfolio/src/actions/create-property.ts`
- Create: `modules/portfolio/src/actions/update-property.ts`
- Create: `modules/portfolio/src/actions/delete-property.ts`

- [ ] **Step 1: Write create-property action**

`modules/portfolio/src/actions/create-property.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { propertySchema, type PropertyFormValues } from '../schemas/property-schema';

const AUTO_UNIT_TYPES = ['single_family', 'townhouse', 'condo'];

export async function createProperty(
  orgId: string,
  values: PropertyFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = propertySchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();

    const { data: property, error } = await supabase
      .from('properties')
      .insert({ ...parsed.data, org_id: orgId })
      .select('id, type')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Auto-create "Main" unit for SFH, townhouse, condo
    if (AUTO_UNIT_TYPES.includes(property.type)) {
      await supabase.from('units').insert({
        property_id: property.id,
        unit_number: 'Main',
        status: 'vacant',
      });
    }

    return { success: true, data: { id: property.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create property' };
  }
}
```

- [ ] **Step 2: Write update-property action**

`modules/portfolio/src/actions/update-property.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { propertySchema, type PropertyFormValues } from '../schemas/property-schema';

export async function updateProperty(
  propertyId: string,
  values: PropertyFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = propertySchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('properties')
      .update(parsed.data)
      .eq('id', propertyId)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to update property' };
  }
}
```

- [ ] **Step 3: Write delete-property action**

`modules/portfolio/src/actions/delete-property.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

export async function deleteProperty(propertyId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();

    // Get images to delete from storage
    const { data: images } = await supabase
      .from('property_images')
      .select('url')
      .eq('property_id', propertyId);

    // Delete images from Supabase Storage
    if (images && images.length > 0) {
      const paths = images
        .map((img) => {
          const url = new URL(img.url);
          const pathParts = url.pathname.split('/storage/v1/object/public/property-images/');
          return pathParts[1] || '';
        })
        .filter(Boolean);

      if (paths.length > 0) {
        await supabase.storage.from('property-images').remove(paths);
      }
    }

    // Delete property (CASCADE deletes units, images DB records)
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', propertyId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete property' };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add modules/portfolio/src/actions/create-property.ts modules/portfolio/src/actions/update-property.ts modules/portfolio/src/actions/delete-property.ts
git commit -m "feat(portfolio): add property server actions (create, update, delete)"
```

---

### Task 22: Portfolio Server Actions — Units & Images

**Files:**
- Create: `modules/portfolio/src/actions/create-unit.ts`, `update-unit.ts`, `delete-unit.ts`
- Create: `modules/portfolio/src/actions/upload-image.ts`, `delete-image.ts`, `set-primary-image.ts`

- [ ] **Step 1: Write unit actions**

`modules/portfolio/src/actions/create-unit.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { unitSchema, type UnitFormValues } from '../schemas/unit-schema';

export async function createUnit(
  propertyId: string,
  values: UnitFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = unitSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('units')
      .insert({ ...parsed.data, property_id: propertyId })
      .select('id')
      .single();

    if (error) {
      if (error.message.includes('duplicate')) {
        return { success: false, error: 'A unit with that number already exists' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create unit' };
  }
}
```

`modules/portfolio/src/actions/update-unit.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { unitSchema, type UnitFormValues } from '../schemas/unit-schema';

export async function updateUnit(
  unitId: string,
  values: UnitFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = unitSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('units')
      .update(parsed.data)
      .eq('id', unitId)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to update unit' };
  }
}
```

`modules/portfolio/src/actions/delete-unit.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

export async function deleteUnit(unitId: string, propertyId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();

    // Prevent deleting last unit
    const { count } = await supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if ((count ?? 0) <= 1) {
      return { success: false, error: 'Cannot delete the last unit of a property' };
    }

    const { error } = await supabase.from('units').delete().eq('id', unitId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete unit' };
  }
}
```

- [ ] **Step 2: Write image actions**

`modules/portfolio/src/actions/upload-image.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES_PER_PROPERTY = 20;

export async function uploadImage(
  propertyId: string,
  formData: FormData
): Promise<ActionResult<{ id: string; url: string }>> {
  try {
    const file = formData.get('file') as File;
    if (!file) return { success: false, error: 'No file provided' };

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File must be less than 5MB' };
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { success: false, error: 'Only JPEG, PNG, and WebP images are accepted' };
    }

    const supabase = await createServerSupabaseClient();

    // Check image count
    const { count } = await supabase
      .from('property_images')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if ((count ?? 0) >= MAX_IMAGES_PER_PROPERTY) {
      return { success: false, error: `Maximum ${MAX_IMAGES_PER_PROPERTY} images per property` };
    }

    // Upload to storage
    const ext = file.name.split('.').pop();
    const path = `${propertyId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(path, file);

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('property-images')
      .getPublicUrl(path);

    // Check if this is the first image (make it primary)
    const isPrimary = (count ?? 0) === 0;

    // Create DB record
    const { data, error } = await supabase
      .from('property_images')
      .insert({
        property_id: propertyId,
        url: publicUrl,
        is_primary: isPrimary,
        sort_order: (count ?? 0),
      })
      .select('id, url')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id, url: data.url } };
  } catch (err) {
    return { success: false, error: 'Failed to upload image' };
  }
}
```

`modules/portfolio/src/actions/delete-image.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

export async function deleteImage(imageId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();

    // Get image URL to delete from storage
    const { data: image, error: fetchError } = await supabase
      .from('property_images')
      .select('url')
      .eq('id', imageId)
      .single();

    if (fetchError || !image) {
      return { success: false, error: 'Image not found' };
    }

    // Extract storage path from URL
    const url = new URL(image.url);
    const pathParts = url.pathname.split('/storage/v1/object/public/property-images/');
    const storagePath = pathParts[1];

    if (storagePath) {
      await supabase.storage.from('property-images').remove([storagePath]);
    }

    // Delete DB record
    const { error } = await supabase.from('property_images').delete().eq('id', imageId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete image' };
  }
}
```

`modules/portfolio/src/actions/set-primary-image.ts`:
```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

export async function setPrimaryImage(
  imageId: string,
  propertyId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();

    // Unset current primary
    await supabase
      .from('property_images')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
      .eq('is_primary', true);

    // Set new primary
    const { error } = await supabase
      .from('property_images')
      .update({ is_primary: true })
      .eq('id', imageId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to set primary image' };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/portfolio/src/actions/
git commit -m "feat(portfolio): add unit and image server actions"
```

---

### Task 23: Portfolio TanStack Query Hooks

**Files:**
- Create: `modules/portfolio/src/hooks/use-properties.ts`, `use-property.ts`, `use-units.ts`, `use-property-images.ts`
- Modify: `modules/portfolio/src/index.ts`

- [ ] **Step 1: Write portfolio hooks**

`modules/portfolio/src/hooks/use-properties.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getProperties, type PropertyFilters } from '@onereal/database';

export function useProperties(filters: Omit<PropertyFilters, 'orgId'> & { orgId: string | null }) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['properties', filters],
    queryFn: () => getProperties(supabase, filters as PropertyFilters),
    enabled: !!filters.orgId,
  });
}
```

`modules/portfolio/src/hooks/use-property.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getProperty } from '@onereal/database';

export function useProperty(propertyId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => getProperty(supabase, propertyId!),
    enabled: !!propertyId,
  });
}
```

`modules/portfolio/src/hooks/use-units.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getUnits } from '@onereal/database';

export function useUnits(propertyId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['units', propertyId],
    queryFn: () => getUnits(supabase, propertyId!),
    enabled: !!propertyId,
  });
}
```

`modules/portfolio/src/hooks/use-property-images.ts`:
```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function usePropertyImages(propertyId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['property-images', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_images')
        .select('*')
        .eq('property_id', propertyId!)
        .order('sort_order');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });
}
```

- [ ] **Step 2: Update portfolio index.ts**

`modules/portfolio/src/index.ts`:
```ts
// Schemas (pure types + zod — safe for both client and server)
export { propertySchema, type PropertyFormValues } from './schemas/property-schema';
export { unitSchema, type UnitFormValues } from './schemas/unit-schema';

// Hooks (client-only)
export { useProperties } from './hooks/use-properties';
export { useProperty } from './hooks/use-property';
export { useUnits } from './hooks/use-units';
export { usePropertyImages } from './hooks/use-property-images';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createProperty } from '@onereal/portfolio/actions/create-property';
```

- [ ] **Step 3: Verify type-check**

Run: `pnpm turbo type-check --filter=@onereal/portfolio`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add modules/portfolio/
git commit -m "feat(portfolio): add TanStack Query hooks and index exports"
```

---

## Chunk 6: Portfolio UI, Settings & Placeholders

### Task 24: Property Form Component (Shared Create/Edit)

**Files:**
- Create: `apps/web/components/properties/property-form.tsx`

- [ ] **Step 1: Write property form**

`apps/web/components/properties/property-form.tsx`:
```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { propertySchema, type PropertyFormValues } from '@onereal/portfolio';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button, Card, CardContent, CardHeader, CardTitle,
} from '@onereal/ui';

interface PropertyFormProps {
  defaultValues?: Partial<PropertyFormValues>;
  onSubmit: (values: PropertyFormValues) => void;
  loading?: boolean;
  submitLabel?: string;
}

const propertyTypes = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'apartment_complex', label: 'Apartment Complex' },
  { value: 'condo', label: 'Condo' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'sold', label: 'Sold' },
];

export function PropertyForm({
  defaultValues,
  onSubmit,
  loading,
  submitLabel = 'Save Property',
}: PropertyFormProps) {
  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      name: '',
      type: 'single_family',
      status: 'active',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      zip: '',
      country: 'US',
      notes: '',
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Property Name *</FormLabel>
                <FormControl><Input placeholder="123 Main St" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {propertyTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="address_line1" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Address Line 1</FormLabel>
                <FormControl><Input {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="address_line2" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Address Line 2</FormLabel>
                <FormControl><Input {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="state" render={({ field }) => (
              <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="zip" render={({ field }) => (
              <FormItem><FormLabel>ZIP</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="country" render={({ field }) => (
              <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="year_built" render={({ field }) => (
              <FormItem>
                <FormLabel>Year Built</FormLabel>
                <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="purchase_price" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Price</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="purchase_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Date</FormLabel>
                <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="market_value" render={({ field }) => (
              <FormItem>
                <FormLabel>Market Value</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={3} {...field} /></FormControl>
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/properties/property-form.tsx
git commit -m "feat(portfolio): add shared property form component"
```

---

### Task 25: Property List & Create Pages

**Files:**
- Create: `apps/web/components/properties/property-list.tsx`
- Create: `apps/web/components/properties/property-card.tsx`
- Create: `apps/web/app/(dashboard)/properties/page.tsx`
- Create: `apps/web/app/(dashboard)/properties/new/page.tsx`

- [ ] **Step 1: Write property list component**

`apps/web/components/properties/property-list.tsx`:
```tsx
'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, Badge, Button } from '@onereal/ui';
import { MoreHorizontal, Eye, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@onereal/ui';
import Link from 'next/link';
import type { Property, Unit } from '@onereal/types';

type PropertyRow = Property & { units: Pick<Unit, 'id' | 'status' | 'rent_amount'>[] };

const columns: ColumnDef<PropertyRow>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link href={`/properties/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: 'type', header: 'Type', cell: ({ row }) => row.original.type.replace(/_/g, ' ') },
  {
    id: 'address',
    header: 'Address',
    cell: ({ row }) => {
      const p = row.original;
      return [p.city, p.state].filter(Boolean).join(', ') || '—';
    },
  },
  {
    id: 'units',
    header: 'Units',
    cell: ({ row }) => row.original.units?.length ?? 0,
  },
  {
    id: 'occupancy',
    header: 'Occupancy',
    cell: ({ row }) => {
      const units = row.original.units ?? [];
      const occupied = units.filter((u) => u.status === 'occupied').length;
      const total = units.length;
      if (total === 0) return '—';
      return `${Math.round((occupied / total) * 100)}%`;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/properties/${row.original.id}`} className="gap-2">
              <Eye className="h-4 w-4" /> View
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/properties/${row.original.id}/edit`} className="gap-2">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

interface PropertyListProps {
  data: PropertyRow[];
}

export function PropertyList({ data }: PropertyListProps) {
  return <DataTable columns={columns} data={data} />;
}
```

- [ ] **Step 2: Write property card component**

`apps/web/components/properties/property-card.tsx`:
```tsx
import { Card, CardContent, Badge } from '@onereal/ui';
import { Building2, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import type { Property, Unit } from '@onereal/types';

type PropertyRow = Property & { units: Pick<Unit, 'id' | 'status' | 'rent_amount'>[] };

export function PropertyCard({ property }: { property: PropertyRow }) {
  const units = property.units ?? [];
  const occupied = units.filter((u) => u.status === 'occupied').length;

  return (
    <Link href={`/properties/${property.id}`}>
      <Card className="hover:border-primary transition-colors">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium truncate">{property.name}</h3>
            <Badge variant={property.status === 'active' ? 'default' : 'secondary'}>
              {property.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {[property.city, property.state].filter(Boolean).join(', ') || 'No address'}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              {property.type.replace(/_/g, ' ')}
            </span>
            <span className="flex items-center gap-1">
              <DoorOpen className="h-3.5 w-3.5" />
              {units.length} units · {occupied} occupied
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 3: Write property list page**

`apps/web/app/(dashboard)/properties/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import { PropertyList } from '@/components/properties/property-list';
import { PropertyCard } from '@/components/properties/property-card';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { Plus, LayoutGrid, List } from 'lucide-react';

export default function PropertiesPage() {
  const { activeOrg } = useUser();
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data, isLoading } = useProperties({
    orgId: activeOrg?.id ?? null,
    search: search || undefined,
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  });

  const properties = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Properties</h1>
        <Link href="/properties/new">
          <Button className="gap-2"><Plus className="h-4 w-4" /> Add Property</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search properties..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="single_family">Single Family</SelectItem>
            <SelectItem value="townhouse">Townhouse</SelectItem>
            <SelectItem value="apartment_complex">Apartment Complex</SelectItem>
            <SelectItem value="condo">Condo</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1">
          <Button variant={view === 'table' ? 'default' : 'ghost'} size="icon" onClick={() => setView('table')}>
            <List className="h-4 w-4" />
          </Button>
          <Button variant={view === 'grid' ? 'default' : 'ghost'} size="icon" onClick={() => setView('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : properties.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No properties yet</p>
          <Link href="/properties/new"><Button>Add your first property</Button></Link>
        </div>
      ) : view === 'table' ? (
        <PropertyList data={properties as any} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p: any) => <PropertyCard key={p.id} property={p} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write create property page**

`apps/web/app/(dashboard)/properties/new/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@onereal/auth';
import { type PropertyFormValues } from '@onereal/portfolio';
import { createProperty } from '@onereal/portfolio/actions/create-property';
import { PropertyForm } from '@/components/properties/property-form';
import { toast } from 'sonner';

export default function NewPropertyPage() {
  const [loading, setLoading] = useState(false);
  const { activeOrg } = useUser();
  const router = useRouter();

  async function handleSubmit(values: PropertyFormValues) {
    if (!activeOrg) return;
    setLoading(true);

    const result = await createProperty(activeOrg.id, values);

    if (result.success) {
      toast.success('Property created!');
      router.push(`/properties/${result.data.id}`);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">New Property</h1>
      <PropertyForm onSubmit={handleSubmit} loading={loading} submitLabel="Create Property" />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/properties/property-list.tsx apps/web/components/properties/property-card.tsx apps/web/app/\(dashboard\)/properties/
git commit -m "feat(portfolio): add property list (table/grid) and create property pages"
```

---

### Task 26: Property Detail & Edit Pages

**Files:**
- Create: `apps/web/components/properties/property-detail-tabs.tsx`
- Create: `apps/web/components/properties/unit-table.tsx`
- Create: `apps/web/components/properties/unit-dialog.tsx`
- Create: `apps/web/components/properties/image-gallery.tsx`
- Create: `apps/web/components/properties/image-upload.tsx`
- Create: `apps/web/app/(dashboard)/properties/[id]/page.tsx`
- Create: `apps/web/app/(dashboard)/properties/[id]/edit/page.tsx`

- [ ] **Step 1: Write unit table and dialog**

`apps/web/components/properties/unit-table.tsx`:
```tsx
'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, Badge, Button } from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Unit } from '@onereal/types';
import { deleteUnit } from '@onereal/portfolio/actions/delete-unit';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';
import { UnitDialog } from './unit-dialog';

interface UnitTableProps {
  units: Unit[];
  propertyId: string;
}

export function UnitTable({ units, propertyId }: UnitTableProps) {
  const [editUnit, setEditUnit] = useState<Unit | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const queryClient = useQueryClient();

  async function handleDelete(unitId: string) {
    if (!confirm('Delete this unit?')) return;
    const result = await deleteUnit(unitId, propertyId);
    if (result.success) {
      toast.success('Unit deleted');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  const columns: ColumnDef<Unit>[] = [
    { accessorKey: 'unit_number', header: 'Unit #' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => row.original.type?.replace(/_/g, ' ') || '—' },
    { accessorKey: 'bedrooms', header: 'Beds', cell: ({ row }) => row.original.bedrooms ?? '—' },
    { accessorKey: 'bathrooms', header: 'Baths', cell: ({ row }) => row.original.bathrooms ?? '—' },
    { accessorKey: 'square_feet', header: 'Sqft', cell: ({ row }) => row.original.square_feet?.toLocaleString() ?? '—' },
    {
      accessorKey: 'rent_amount',
      header: 'Rent',
      cell: ({ row }) => row.original.rent_amount ? `$${Number(row.original.rent_amount).toLocaleString()}` : '—',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'occupied' ? 'default' : 'secondary'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditUnit(row.original); setShowDialog(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(row.original.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setEditUnit(null); setShowDialog(true); }}>
          <Plus className="h-4 w-4" /> Add Unit
        </Button>
      </div>
      <DataTable columns={columns} data={units} />
      <UnitDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        propertyId={propertyId}
        unit={editUnit}
      />
    </div>
  );
}
```

`apps/web/components/properties/unit-dialog.tsx`:
```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { unitSchema, type UnitFormValues } from '@onereal/portfolio';
import { createUnit } from '@onereal/portfolio/actions/create-unit';
import { updateUnit } from '@onereal/portfolio/actions/update-unit';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Unit } from '@onereal/types';

interface UnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unit: Unit | null;
}

export function UnitDialog({ open, onOpenChange, propertyId, unit }: UnitDialogProps) {
  const queryClient = useQueryClient();
  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: unit ? {
      unit_number: unit.unit_number,
      type: unit.type as UnitFormValues['type'],
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      square_feet: unit.square_feet,
      rent_amount: unit.rent_amount,
      deposit_amount: unit.deposit_amount,
      status: unit.status as UnitFormValues['status'],
      floor: unit.floor,
    } : {
      unit_number: '',
      status: 'vacant',
    },
  });

  async function onSubmit(values: UnitFormValues) {
    const result = unit
      ? await updateUnit(unit.id, values)
      : await createUnit(propertyId, values);

    if (result.success) {
      toast.success(unit ? 'Unit updated' : 'Unit created');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
      onOpenChange(false);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{unit ? 'Edit Unit' : 'Add Unit'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="unit_number" render={({ field }) => (
                <FormItem><FormLabel>Unit Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other'].map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="bedrooms" render={({ field }) => (
                <FormItem><FormLabel>Bedrooms</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bathrooms" render={({ field }) => (
                <FormItem><FormLabel>Bathrooms</FormLabel><FormControl><Input type="number" step="0.5" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="square_feet" render={({ field }) => (
                <FormItem><FormLabel>Square Feet</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="rent_amount" render={({ field }) => (
                <FormItem><FormLabel>Rent Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['vacant', 'occupied', 'maintenance', 'not_available'].map((s) => (
                        <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{unit ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write image gallery and upload components**

`apps/web/components/properties/image-gallery.tsx`:
```tsx
'use client';

import { Badge, Button } from '@onereal/ui';
import { Star, Trash2 } from 'lucide-react';
import { deleteImage } from '@onereal/portfolio/actions/delete-image';
import { setPrimaryImage } from '@onereal/portfolio/actions/set-primary-image';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PropertyImage } from '@onereal/types';
import { ImageUpload } from './image-upload';

interface ImageGalleryProps {
  images: PropertyImage[];
  propertyId: string;
}

export function ImageGallery({ images, propertyId }: ImageGalleryProps) {
  const queryClient = useQueryClient();

  async function handleDelete(imageId: string) {
    if (!confirm('Delete this image?')) return;
    const result = await deleteImage(imageId);
    if (result.success) {
      toast.success('Image deleted');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleSetPrimary(imageId: string) {
    const result = await setPrimaryImage(imageId, propertyId);
    if (result.success) {
      toast.success('Primary image updated');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <ImageUpload propertyId={propertyId} />
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No images uploaded yet</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <div key={image.id} className="group relative overflow-hidden rounded-lg border">
              <img src={image.url} alt={image.caption || 'Property image'} className="aspect-square w-full object-cover" />
              {image.is_primary && (
                <Badge className="absolute left-2 top-2">Primary</Badge>
              )}
              <div className="absolute inset-0 flex items-end justify-end gap-1 bg-black/0 p-2 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                {!image.is_primary && (
                  <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => handleSetPrimary(image.id)}>
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => handleDelete(image.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`apps/web/components/properties/image-upload.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@onereal/ui';
import { Upload } from 'lucide-react';
import { uploadImage } from '@onereal/portfolio/actions/upload-image';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function ImageUpload({ propertyId }: { propertyId: string }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const result = await uploadImage(propertyId, formData);
      if (!result.success) {
        toast.error(`${file.name}: ${result.error}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    setUploading(false);
    toast.success('Images uploaded');
  }

  return (
    <div
      className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:border-primary"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="text-center">
        <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          {uploading ? 'Uploading...' : 'Click or drag images here'}
        </p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · Max 5MB · Max 20 images</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write property detail page**

`apps/web/components/properties/property-detail-tabs.tsx`:
```tsx
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger, Card, CardContent, Badge, StatCard } from '@onereal/ui';
import { DoorOpen, Percent, DollarSign, MapPin } from 'lucide-react';
import type { Property, Unit, PropertyImage } from '@onereal/types';
import { UnitTable } from './unit-table';
import { ImageGallery } from './image-gallery';

interface PropertyDetailTabsProps {
  property: Property;
  units: Unit[];
  images: PropertyImage[];
}

export function PropertyDetailTabs({ property, units, images }: PropertyDetailTabsProps) {
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const totalRent = units.reduce((sum, u) => sum + (Number(u.rent_amount) || 0), 0);
  const occupancyRate = units.length > 0 ? Math.round((occupied / units.length) * 100) : 0;

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="units">Units ({units.length})</TabsTrigger>
        <TabsTrigger value="images">Images ({images.length})</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Units" value={units.length} icon={DoorOpen} description={`${occupied} occupied`} />
          <StatCard title="Occupancy" value={`${occupancyRate}%`} icon={Percent} />
          <StatCard title="Rent Potential" value={`$${totalRent.toLocaleString()}`} icon={DollarSign} description="Monthly" />
        </div>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                {property.address_line1 && <p>{property.address_line1}</p>}
                {property.address_line2 && <p>{property.address_line2}</p>}
                <p>{[property.city, property.state, property.zip].filter(Boolean).join(', ')}</p>
              </div>
            </div>
            {property.notes && <p className="text-sm text-muted-foreground">{property.notes}</p>}
            <div className="flex gap-2 flex-wrap text-sm">
              <Badge variant="outline">{property.type.replace(/_/g, ' ')}</Badge>
              {property.year_built && <Badge variant="outline">Built {property.year_built}</Badge>}
              {property.purchase_price && <Badge variant="outline">Purchased ${Number(property.purchase_price).toLocaleString()}</Badge>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="units">
        <UnitTable units={units} propertyId={property.id} />
      </TabsContent>

      <TabsContent value="images">
        <ImageGallery images={images} propertyId={property.id} />
      </TabsContent>

      <TabsContent value="activity">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Lease and transaction history will appear here in a future update.
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
```

`apps/web/app/(dashboard)/properties/[id]/page.tsx`:
```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProperty } from '@onereal/database';
import { PropertyDetailTabs } from '@/components/properties/property-detail-tabs';
import { Button } from '@onereal/ui';
import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  let property;
  try {
    property = await getProperty(supabase, id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <div className="flex gap-2">
          <Link href={`/properties/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Link>
        </div>
      </div>
      <PropertyDetailTabs
        property={property as any}
        units={(property.units ?? []) as any}
        images={(property.property_images ?? []) as any}
      />
    </div>
  );
}
```

- [ ] **Step 4: Write edit property page**

`apps/web/app/(dashboard)/properties/[id]/edit/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useProperty, type PropertyFormValues } from '@onereal/portfolio';
import { updateProperty } from '@onereal/portfolio/actions/update-property';
import { PropertyForm } from '@/components/properties/property-form';
import { toast } from 'sonner';

export default function EditPropertyPage() {
  const { id } = useParams<{ id: string }>();
  const { data: property, isLoading } = useProperty(id);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!property) return <p className="text-destructive">Property not found</p>;

  async function handleSubmit(values: PropertyFormValues) {
    setLoading(true);
    const result = await updateProperty(id, values);
    if (result.success) {
      toast.success('Property updated!');
      router.push(`/properties/${id}`);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Edit Property</h1>
      <PropertyForm
        defaultValues={property as any}
        onSubmit={handleSubmit}
        loading={loading}
        submitLabel="Save Changes"
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/properties/ apps/web/app/\(dashboard\)/properties/
git commit -m "feat(portfolio): add property detail with units, images, and edit page"
```

---

### Task 27: Settings Pages

**Files:**
- Create: `apps/web/app/(dashboard)/settings/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/profile/page.tsx`

- [ ] **Step 1: Write org settings page**

`apps/web/app/(dashboard)/settings/page.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@onereal/auth';
import { createClient, updateOrganization, getOrgMembers } from '@onereal/database';
import {
  Card, CardContent, CardHeader, CardTitle,
  Input, Label, Button, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function OrgSettingsPage() {
  const { activeOrg, profile } = useUser();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (activeOrg) {
      setName(activeOrg.name);
      getOrgMembers(supabase, activeOrg.id).then(setMembers).catch(() => {});
    }
  }, [activeOrg, supabase]);

  async function handleSave() {
    if (!activeOrg) return;
    setSaving(true);
    try {
      await updateOrganization(supabase, activeOrg.id, { name });
      toast.success('Organization updated');
    } catch {
      toast.error('Failed to update organization');
    }
    setSaving(false);
  }

  if (!activeOrg) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Organization Settings</h1>

      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={activeOrg.slug} disabled />
            <p className="text-xs text-muted-foreground">Cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Badge variant="outline">{activeOrg.type}</Badge>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {activeOrg.type === 'company' && (
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {m.profiles?.first_name} {m.profiles?.last_name}
                    </TableCell>
                    <TableCell>{m.profiles?.email}</TableCell>
                    <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-muted-foreground">
              Invite members by email coming in Phase 2.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write profile settings page**

`apps/web/app/(dashboard)/settings/profile/page.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@onereal/auth';
import { createClient, updateProfile } from '@onereal/database';
import {
  Card, CardContent, CardHeader, CardTitle,
  Input, Label, Button,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function ProfileSettingsPage() {
  const { profile } = useUser();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setPhone(profile.phone || '');
    }
  }, [profile]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    try {
      await updateProfile(supabase, profile.id, {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
      });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    }
    setSaving(false);
  }

  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Profile Settings</h1>

      <Card>
        <CardHeader><CardTitle>Personal Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile.email || ''} disabled />
            <p className="text-xs text-muted-foreground">Cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Security</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            To change your password, use the &quot;Forgot password&quot; flow from the login page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(dashboard\)/settings/
git commit -m "feat(settings): add org settings and profile settings pages"
```

---

### Task 28: Coming Soon Placeholders

**Files:**
- Create: `apps/web/components/dashboard/coming-soon.tsx`
- Create: `apps/web/app/(dashboard)/transactions/page.tsx`
- Create: `apps/web/app/(dashboard)/tenants/page.tsx`
- Create: `apps/web/app/(dashboard)/maintenance/page.tsx`

- [ ] **Step 1: Write coming-soon component**

`apps/web/components/dashboard/coming-soon.tsx`:
```tsx
import { type LucideIcon } from 'lucide-react';
import { Badge } from '@onereal/ui';

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  features: string[];
}

export function ComingSoon({ icon: Icon, title, description, features }: ComingSoonProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Icon className="mb-4 h-16 w-16 text-muted-foreground/50" />
      <h2 className="mb-2 text-2xl font-bold">{title}</h2>
      <p className="mb-4 text-muted-foreground">{description}</p>
      <Badge variant="secondary" className="mb-6">In Development</Badge>
      <div className="text-left">
        <p className="mb-2 text-sm font-medium">Planned features:</p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {features.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write placeholder pages**

`apps/web/app/(dashboard)/transactions/page.tsx`:
```tsx
import { ComingSoon } from '@/components/dashboard/coming-soon';
import { CreditCard } from 'lucide-react';

export default function TransactionsPage() {
  return (
    <ComingSoon
      icon={CreditCard}
      title="Transactions"
      description="Track income, expenses, and payments across all properties."
      features={[
        'Record rent payments and expenses',
        'Generate financial reports',
        'Categorize transactions',
        'Export to CSV/PDF',
      ]}
    />
  );
}
```

`apps/web/app/(dashboard)/tenants/page.tsx`:
```tsx
import { ComingSoon } from '@/components/dashboard/coming-soon';
import { Users } from 'lucide-react';

export default function TenantsPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Tenants"
      description="Manage tenant profiles, leases, and communications."
      features={[
        'Tenant onboarding and profiles',
        'Lease management and renewals',
        'Tenant portal access',
        'Communication history',
      ]}
    />
  );
}
```

`apps/web/app/(dashboard)/maintenance/page.tsx`:
```tsx
import { ComingSoon } from '@/components/dashboard/coming-soon';
import { Wrench } from 'lucide-react';

export default function MaintenancePage() {
  return (
    <ComingSoon
      icon={Wrench}
      title="Maintenance"
      description="Handle maintenance requests and track work orders."
      features={[
        'Submit and track maintenance requests',
        'Assign contractors',
        'Priority and status tracking',
        'Photo documentation',
      ]}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/dashboard/coming-soon.tsx apps/web/app/\(dashboard\)/transactions/ apps/web/app/\(dashboard\)/tenants/ apps/web/app/\(dashboard\)/maintenance/
git commit -m "feat: add Coming Soon placeholder pages for transactions, tenants, maintenance"
```

---

### Task 29: Final Verification & Cleanup

- [ ] **Step 1: Run full type-check**

Run: `pnpm turbo type-check`
Expected: All packages pass. Fix any remaining type errors.

- [ ] **Step 2: Run build**

Run: `pnpm turbo build`
Expected: Web app builds successfully. No build errors.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm turbo dev --filter=@onereal/web`

Verify manually:
1. Navigate to http://localhost:3000 → redirected to /login
2. Register a new account → redirected to /onboarding
3. Complete profile → choose org type → redirected to dashboard
4. Dashboard shows stat cards (all zeros)
5. Sidebar navigation works: Properties, Coming Soon pages, Settings
6. Create a property → redirected to detail page
7. Add units via dialog, upload images
8. Property list shows table and grid view
9. Edit property, update info
10. Org switcher shows orgs
11. Settings pages work
12. Sign out → redirected to login

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 MVP complete — final verification and cleanup"
```

---

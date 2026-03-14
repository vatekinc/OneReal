# OneReal — Master Roadmap

> **Status:** Approved
> **Date:** 2026-03-14
> **Vision:** PropLedger 2.0 — a professional, modular rental property management platform
> **Reference:** PropLedger (github.com/abhiagri15/PropLedger) — the Streamlit prototype this project evolves from

---

## Vision

OneReal is the modular, production-grade evolution of PropLedger. It carries forward all proven PropLedger features (property management, income/expense tracking, financial dashboards, budgets, AI insights) and adds professional-grade enhancements: normalized data model (properties → units), image management, lease tracking, tenant portal, maintenance workflows, and public rental listings.

Built with Next.js 15, TypeScript, Supabase, and Turborepo — every feature area is an independent module that can be developed, tested, and deployed incrementally.

---

## Enhancements Over PropLedger

| Area | PropLedger (Streamlit) | OneReal (Next.js) |
|------|----------------------|-------------------|
| **Architecture** | Single `app_auth.py` (~2000 lines) | Turborepo monorepo, independent modules |
| **UI Framework** | Streamlit widgets | shadcn/ui + Tailwind CSS (professional dashboard) |
| **Rendering** | Client-only | SSR/SSG (SEO for listings), Server Actions |
| **Data Model** | Flat properties | Properties → Units (normalized, every property has units) |
| **Images** | None | Drag-drop upload, gallery, primary image per property |
| **Charts** | Plotly (Python) | Recharts (React-native, SSR-compatible) |
| **Auth** | Basic Supabase email/pwd | Google OAuth + onboarding wizard + role-based access |
| **Multi-tenancy** | Basic org filtering | Full PostgreSQL RLS + org roles (admin, landlord, PM, tenant, contractor) |
| **Maps** | Google Maps embed | Mapbox GL JS (interactive, clickable pins) |
| **Mobile** | Not responsive | Fully responsive dashboard (sidebar collapse, sheet overlays) |
| **AI** | GPT-3.5 via OpenAI | Claude API (or OpenAI) with richer context |
| **Leases** | Not supported | Full lease lifecycle (draft → active → expired) |
| **Tenants** | Not supported | Tenant portal, onboarding, invite flow |
| **Maintenance** | Not supported | Request → assignment → tracking → completion |
| **Listings** | Not supported | Public SSR pages with SEO, application forms |
| **Payments** | Not supported | Stripe (online rent collection, recurring) |
| **Type Safety** | Python (runtime) | TypeScript strict + Zod schemas (compile-time) |

---

## Module Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        OneReal Platform                          │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│Portfolio │Accounting│ Budgets  │ Tenants  │Maintenan.│ Listings │
│(Phase 1) │(Phase 2) │(Phase 3) │(Phase 4) │(Phase 5) │(Phase 6) │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────┤
│  Insights (Phase 5)  │  Reminders (Phase 5)  │  Reports (Ph 3)  │
├──────────────────────────────────────────────────────────────────┤
│           Core (Auth, Orgs, Roles, Dashboard Shell, UI)          │
├──────────────────────────────────────────────────────────────────┤
│         Supabase (PostgreSQL + Auth + Storage + Realtime)         │
└──────────────────────────────────────────────────────────────────┘
```

Each module follows the same structure:
```
modules/<name>/
├── components/     # React components
├── hooks/          # TanStack Query hooks
├── actions/        # Next.js Server Actions
├── schemas/        # Zod validation schemas
├── package.json    # Module metadata + dependencies
└── index.ts        # Public exports
```

---

## Phase 1: Foundation + Portfolio

> **Detailed spec:** `docs/superpowers/specs/2026-03-14-phase1-mvp-design.md`
> **Status:** Spec approved, ready for implementation planning

### Scope
- Turborepo + pnpm + Next.js 15 scaffolding
- Supabase Cloud: all tables (core + portfolio + placeholders for future)
- Full auth: email/pwd + Google OAuth + onboarding wizard
- Dashboard shell: classic sidebar, topbar, breadcrumbs, org switcher
- Property portfolio: CRUD properties, units, images, list/grid views
- Dashboard stats: total properties, units, occupancy %, rent potential
- Settings: org settings, profile settings
- Module placeholders: Coming Soon pages for future modules

### Database Tables Created
Core: `organizations`, `profiles`, `org_members`
Portfolio: `properties`, `units`, `property_images`
Placeholders: `leases`, `transactions`, `maintenance_requests`

### Verification
Register → onboarding → add 3 properties → manage units/images → verify stats → test multi-tenancy isolation

---

## Phase 2: Financial Management

> **Module:** `modules/accounting/`
> **Sidebar items:** Accounting (replaces Transactions placeholder)
> **PropLedger parity:** Income CRUD, Expense CRUD, Financial Dashboard

### New Database Tables

**`income`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| property_id | UUID FK → properties | |
| unit_id | UUID FK → units, nullable | Nullable — income can be at property level |
| amount | DECIMAL(10,2) NOT NULL | |
| income_type | TEXT NOT NULL | rent, deposit, late_fee, other |
| description | TEXT NOT NULL | |
| transaction_date | DATE NOT NULL | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`expenses`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| property_id | UUID FK → properties | |
| unit_id | UUID FK → units, nullable | |
| amount | DECIMAL(10,2) NOT NULL | |
| expense_type | TEXT NOT NULL | mortgage, maintenance, repairs, utilities, insurance, taxes, management, advertising, legal, hoa, home_warranty, other |
| description | TEXT NOT NULL | |
| transaction_date | DATE NOT NULL | |
| receipt_url | TEXT | Supabase Storage URL |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`categories`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| name | TEXT NOT NULL | |
| type | TEXT NOT NULL | income, expense |
| description | TEXT | |
| created_at | TIMESTAMPTZ | |

### Routes

| Route | Page |
|-------|------|
| `/accounting` | Financial overview dashboard |
| `/accounting/income` | Income list + add form |
| `/accounting/expenses` | Expense list + add form |
| `/accounting/income/[id]` | Income detail/edit |
| `/accounting/expenses/[id]` | Expense detail/edit |

### Features

**Income Tracking:**
- CRUD income records linked to properties/units
- Income types: rent, deposit, late_fee, other (+ custom categories)
- Date-based filtering and search
- Bulk actions (mark multiple as received)

**Expense Tracking:**
- CRUD expense records with 12+ categories (from PropLedger)
- Receipt upload to Supabase Storage
- Expense categorization with custom categories
- Date-based filtering and search

**Financial Dashboard (upgraded from Phase 1 stat cards):**
- P&L summary per property and per organization
- ROI calculation per property: `(total_income - total_expenses) / purchase_price * 100`
- Income breakdown by category (Recharts pie chart)
- Expense breakdown by category (Recharts pie chart)
- Monthly income vs expense trend (Recharts line chart)
- Date range filtering: Current Month, Current Year, 3yr, 5yr, All Time, Custom Range
- Recent transactions feed (replaces Phase 1 placeholder)
- Property financial comparison table

**Dashboard Home Upgrade:**
- Replace basic stat cards with financial summary cards (total income, total expenses, net income, ROI)
- Add income/expense trend mini-charts
- Recent transactions list (last 10)

### PropLedger Feature Mapping

| PropLedger | OneReal Phase 2 |
|------------|----------------|
| `income` table (flat) | `income` table with `unit_id` (normalized) |
| `expenses` table (flat) | `expenses` table with `unit_id` + receipt upload |
| `categories` table | `categories` table (scoped to org) |
| Dashboard tab (Plotly) | `/accounting` dashboard (Recharts) |
| `property_financial_summary` view | Computed in TanStack Query hooks |

---

## Phase 3: Advanced Financial

> **Module:** `modules/budgets/` (new) + `modules/accounting/` (extensions)
> **Sidebar items:** Budgets (new), Reports (new)
> **PropLedger parity:** Budgets, Recurring Transactions, Pending Transactions, Reports

### New Database Tables

**`budgets`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| property_id | UUID FK → properties, nullable | null = org-level budget |
| name | TEXT NOT NULL | |
| description | TEXT | |
| budget_amount | DECIMAL(12,2) NOT NULL | |
| period | TEXT NOT NULL | monthly, yearly, custom |
| scope | TEXT NOT NULL | property, organization |
| start_date | DATE NOT NULL | |
| end_date | DATE | |
| is_active | BOOLEAN | default true |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`budget_lines`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| budget_id | UUID FK → budgets | |
| category_id | UUID FK → categories | |
| budgeted_amount | DECIMAL(10,2) NOT NULL | |
| actual_amount | DECIMAL(10,2) | Computed or manually updated |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`recurring_transactions`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| property_id | UUID FK → properties | |
| transaction_type | TEXT NOT NULL | income, expense |
| income_type | TEXT | |
| expense_type | TEXT | |
| amount | DECIMAL(10,2) NOT NULL | |
| description | TEXT NOT NULL | |
| interval | TEXT NOT NULL | weekly, monthly, quarterly, yearly |
| start_date | DATE NOT NULL | |
| end_date | DATE | null = indefinite |
| is_active | BOOLEAN | default true |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`pending_transactions`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| property_id | UUID FK → properties | |
| transaction_type | TEXT NOT NULL | income, expense |
| income_type | TEXT | |
| expense_type | TEXT | |
| amount | DECIMAL(10,2) NOT NULL | |
| description | TEXT NOT NULL | |
| transaction_date | DATE NOT NULL | |
| recurring_transaction_id | UUID FK → recurring_transactions, nullable | |
| is_confirmed | BOOLEAN | default false |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### Features

**Budget Planner (`/budgets`):**
- Create budgets per property or per organization
- Add budget line items by category
- Actual vs budgeted variance analysis with visual indicators (green/red)
- Budget period support: monthly, yearly, custom date range
- Budget dashboard with overall spending vs budget progress bars

**Recurring Transactions (`/accounting/recurring`):**
- Create recurring income/expense schedules
- Intervals: weekly, monthly, quarterly, yearly
- Auto-generate pending transactions on schedule
- Enable/disable recurring schedules
- View history of generated transactions

**Pending Transactions (`/accounting/pending`):**
- List of auto-generated or manually created pending transactions
- Confirm workflow: pending → confirmed → moved to income/expense table
- Bulk confirm/reject
- Visual distinction from confirmed transactions

**Reports (`/reports`):**
- P&L report per property, per org, or portfolio-wide
- Cash flow report (monthly/quarterly/yearly)
- Expense breakdown by category
- Income sources report
- Export to PDF/CSV
- Date range filtering

---

## Phase 4: Tenant Management + Leases

> **Module:** `modules/tenants/`
> **Sidebar items:** Tenants (active), Leases (sub-nav)
> **New features beyond PropLedger**

### Features

**Tenant Onboarding:**
- Invite tenants by email → creates `org_members` row (tenant role)
- Tenant profile: contact info, emergency contact, move-in date
- Document upload (ID, proof of income)

**Lease Management:**
- Lease creation: select unit, tenant, dates, rent amount, deposit, payment due day
- Lease lifecycle: draft → active → expiring → expired → terminated
- Lease renewal workflow
- Lease document upload (Supabase Storage)
- Lease terms in JSONB (pet policy, late fees, etc.)

**Tenant Portal:**
- Tenants see only their unit, lease, payment history
- Submit maintenance requests
- View lease terms and documents
- Make rent payments (Phase 6 — Stripe)

**Org Settings Enhancement:**
- Full invite-by-email flow (deferred from Phase 1)
- Invite acceptance workflow
- "Join existing org" onboarding option (deferred from Phase 1)

---

## Phase 5: Maintenance + AI + Reminders

> **Modules:** `modules/maintenance/`, `modules/insights/`, `modules/reminders/`
> **Sidebar items:** Maintenance (active), AI Insights (new)

### Features

**Maintenance Requests (`/maintenance`):**
- Tenants submit requests with title, description, category, priority, photos
- Landlord/PM reviews, assigns to contractor
- Status tracking: open → in_progress → waiting_parts → completed → closed
- Cost tracking: estimated vs actual
- Photo documentation (before/after)
- Communication thread (comments on request)
- Maintenance history per unit

**AI Insights (`/insights`):**
- Financial health analysis per property and portfolio
- Spending pattern detection and anomalies
- Rent pricing recommendations based on market data
- ROI optimization suggestions
- Cash flow forecasting
- Natural language queries: "How is property X performing?"
- Uses Claude API (preferred) or OpenAI
- Context: all financial data, property details, market trends

**Reminders (`/reminders`):**
- Rent due reminders (configurable days before due date)
- Lease expiry alerts (30/60/90 days before)
- Maintenance follow-up reminders
- Custom reminders
- Notification bell in topbar (deferred from Phase 1)
- Email notifications (optional)

---

## Phase 6: Listings + Payments

> **Modules:** `modules/listings/`
> **New routes:** `/listings` (public-facing, SSR)

### Features

**Rental Listings (`/listings`):**
- Public-facing property listing pages (SSR for SEO)
- Search by location, price range, bedrooms, property type
- Map-based search (Mapbox GL)
- Property detail pages with image gallery
- Online application forms
- Application review workflow (landlord approves/rejects)
- Listing syndication APIs (future: Zillow, Apartments.com)

**Stripe Payments:**
- Online rent collection (one-time + recurring)
- Stripe Connect for multi-tenant payouts
- Payment confirmation and receipt generation
- Auto-record in income table
- Late fee automation
- Deposit management
- Webhook handler (`/api/webhooks/stripe`)

**Dashboard Enhancements:**
- Dark/light theme toggle
- Real-time updates via Supabase Realtime (new transactions, maintenance status changes)
- Advanced analytics with interactive drill-down charts

---

## Database Schema Evolution

| Phase | New Tables | Modified Tables |
|-------|-----------|----------------|
| 1 | organizations, profiles, org_members, properties, units, property_images, leases*, transactions*, maintenance_requests* | — |
| 2 | income, expenses, categories | Dashboard queries |
| 3 | budgets, budget_lines, recurring_transactions, pending_transactions | — |
| 4 | — | leases (full UI), org_members (invite flow), profiles (tenant fields) |
| 5 | reminders (new), insight_logs (new) | maintenance_requests (full UI) |
| 6 | listings (new), applications (new) | transactions (Stripe fields) |

*Created in Phase 1 as placeholders, activated with UI in later phases.

---

## Sidebar Navigation Evolution

| Phase | Nav Items |
|-------|-----------|
| 1 | Dashboard, Properties, ~~Transactions~~, ~~Tenants~~, ~~Maintenance~~, Settings |
| 2 | Dashboard, Properties, **Accounting**, ~~Tenants~~, ~~Maintenance~~, Settings |
| 3 | Dashboard, Properties, Accounting, **Budgets**, **Reports**, ~~Tenants~~, ~~Maintenance~~, Settings |
| 4 | Dashboard, Properties, Accounting, Budgets, Reports, **Tenants**, ~~Maintenance~~, Settings |
| 5 | Dashboard, Properties, Accounting, Budgets, Reports, Tenants, **Maintenance**, **AI Insights**, Settings |
| 6 | Dashboard, Properties, Accounting, Budgets, Reports, Tenants, Maintenance, AI Insights, **Listings**, Settings |

~~Strikethrough~~ = Coming Soon badge

---

## Implementation Approach

Each phase follows the superpowers workflow:
1. **Brainstorm** — Detailed design for the phase
2. **Write spec** — Detailed spec document per phase
3. **Write plan** — Atomic task breakdown
4. **Execute** — TDD, sub-agent driven development
5. **Review** — Code review before merge
6. **Verify** — End-to-end smoke test

Phase 1 is ready for implementation planning. Subsequent phases will each get their own brainstorming session and detailed spec when the previous phase is complete.

---

## Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 15 (App Router) | SSR, Server Actions, API routes |
| Language | TypeScript (strict) | Type safety |
| Database | Supabase (PostgreSQL) | RLS, Auth, Storage, Realtime |
| Monorepo | Turborepo + pnpm | Module isolation |
| UI | Tailwind CSS + shadcn/ui | Design system |
| Forms | React Hook Form + Zod | Validation |
| Server State | TanStack Query v5 | Caching, optimistic updates |
| Charts | Recharts | Financial visualizations |
| Maps | Mapbox GL JS | Property locations |
| AI | Claude API (or OpenAI) | Financial insights |
| Payments | Stripe | Online rent collection |
| Hosting | Vercel | Deployment |

---

*Document created: 2026-03-14*
*Reference: PropLedger (github.com/abhiagri15/PropLedger)*

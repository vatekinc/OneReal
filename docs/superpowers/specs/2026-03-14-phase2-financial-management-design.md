# Phase 2: Financial Management — Design Spec

> **Status:** Approved
> **Date:** 2026-03-14
> **Module:** `modules/accounting/`
> **Depends on:** Phase 1 (Foundation + Portfolio) — completed
> **Reference:** Master Roadmap (`docs/superpowers/specs/2026-03-14-onereal-master-roadmap.md`)

---

## Goal

Add income and expense tracking with a financial dashboard to the OneReal platform. Users can record income (rent, deposits, fees) and expenses (mortgage, utilities, repairs, etc.) per property, view P&L summaries, trend charts, category breakdowns, and compare financial performance across properties.

---

## Scope

### In Scope
- `income` and `expenses` database tables with RLS
- Income CRUD (create, read, update, delete)
- Expense CRUD (create, read, update, delete)
- Financial dashboard at `/accounting` with:
  - P&L summary stat cards (Total Income, Total Expenses, Net Income, ROI)
  - Monthly income vs expenses bar chart (Recharts)
  - Expense breakdown donut chart (Recharts)
  - Property performance comparison table
  - Income breakdown donut chart (Recharts)
  - Date range filtering (This Month, This Year, 3yr, 5yr, All Time, Custom)
- Dashboard home (`/`) upgrade with financial summary cards + recent transactions
- Sidebar: Replace "Transactions" (Coming Soon) with "Accounting" (active)
- Recharts library installation

### Out of Scope (Deferred)
- Receipt upload (deferred to future iteration)
- Custom categories table (hardcoded types only). Note: The `categories` table defined in the roadmap will need to be created before Phase 3, as `budget_lines` depends on it via FK.
- Recurring transactions (Phase 3)
- Pending transactions (Phase 3)
- Bulk actions
- CSV/PDF export

---

## Architecture

### Data Fetching Strategy: Hybrid

- **`/accounting` dashboard** — Server component. Financial stats computed via SQL queries in `@onereal/database` query helpers, passed as props to client chart components.
- **`/accounting/income` and `/accounting/expenses`** — Client components. TanStack Query hooks fetch filtered lists. Server actions handle mutations.
- **Dashboard home (`/`)** — Server component. New `getFinancialStats()` query added alongside existing `getPortfolioStats()`.

This matches the Phase 1 pattern where the dashboard is a server component and list pages use TanStack Query.

### Date Range Filtering

Date range on the accounting dashboard uses URL search params (`?range=current_month`, `?range=current_year`, `?range=3yr`, `?range=5yr`, `?range=all`, `?from=2024-01-01&to=2024-12-31`). This makes date-filtered views shareable/bookmarkable. Initial page load fetches data server-side. When the user changes the date range, the URL updates, triggering a full page navigation that re-fetches server-side.

---

## Database Schema

### `income` Table

```sql
CREATE TABLE income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  income_type TEXT NOT NULL CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'other')),
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Migration file:** `supabase/migrations/20260314000006_financial_tables.sql`

### `expenses` Table

```sql
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  expense_type TEXT NOT NULL CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other'
  )),
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  receipt_url TEXT, -- upload UI deferred to future iteration
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Row Level Security

Both tables use the same RLS pattern as `properties`:

```sql
-- Uses existing SECURITY DEFINER helpers to avoid RLS recursion
-- get_user_org_ids() = all orgs user belongs to (for SELECT)
-- get_user_managed_org_ids() = orgs where user is admin/landlord/property_manager (for writes)
ALTER TABLE income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view income in their orgs"
  ON income FOR SELECT
  USING (org_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Managers can insert income in their orgs"
  ON income FOR INSERT
  WITH CHECK (org_id IN (SELECT get_user_managed_org_ids()));

CREATE POLICY "Managers can update income in their orgs"
  ON income FOR UPDATE
  USING (org_id IN (SELECT get_user_managed_org_ids()));

CREATE POLICY "Managers can delete income in their orgs"
  ON income FOR DELETE
  USING (org_id IN (SELECT get_user_managed_org_ids()));

-- Same 4 policies for expenses table (SELECT uses get_user_org_ids,
-- INSERT/UPDATE/DELETE use get_user_managed_org_ids)
```

### Indexes

```sql
CREATE INDEX idx_income_org_date ON income(org_id, transaction_date);
CREATE INDEX idx_income_property ON income(property_id);
CREATE INDEX idx_expenses_org_date ON expenses(org_id, transaction_date);
CREATE INDEX idx_expenses_property ON expenses(property_id);
```

### Updated Trigger

Both tables get an `updated_at` trigger (same pattern as existing tables using `moddatetime` extension):

```sql
CREATE TRIGGER set_income_updated_at
  BEFORE UPDATE ON income
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

---

## Module Structure

### `modules/accounting/`

Follows the exact pattern established by `modules/portfolio/`:

```
modules/accounting/
├── package.json              # @onereal/accounting
├── tsconfig.json
└── src/
    ├── index.ts              # Barrel exports: schemas + hooks only
    ├── schemas/
    │   ├── income-schema.ts  # incomeSchema + IncomeFormValues
    │   └── expense-schema.ts # expenseSchema + ExpenseFormValues
    ├── actions/
    │   ├── create-income.ts
    │   ├── update-income.ts
    │   ├── delete-income.ts
    │   ├── create-expense.ts
    │   ├── update-expense.ts
    │   └── delete-expense.ts
    └── hooks/
        ├── use-income.ts         # List with filters (property, type, date range, search)
        ├── use-expenses.ts       # List with filters
        └── use-financial-stats.ts # Client-side stats hook (for date range changes)
```

### Package Exports Pattern

```json
{
  "name": "@onereal/accounting",
  "exports": {
    ".": "./src/index.ts",
    "./actions/*": "./src/actions/*.ts"
  }
}
```

Server actions imported via deep paths: `import { createIncome } from '@onereal/accounting/actions/create-income'`

---

## Zod Schemas

### `income-schema.ts`

```typescript
import { z } from 'zod';

export const incomeSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  income_type: z.enum(['rent', 'deposit', 'late_fee', 'other']),
  description: z.string().min(1, 'Description is required'),
  transaction_date: z.string().min(1, 'Date is required'),
});

export type IncomeFormValues = z.infer<typeof incomeSchema>;
```

### `expense-schema.ts`

```typescript
import { z } from 'zod';

export const expenseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  expense_type: z.enum([
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other',
  ]),
  description: z.string().min(1, 'Description is required'),
  transaction_date: z.string().min(1, 'Date is required'),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
```

---

## Server Actions

All actions follow the established pattern:

1. `'use server'` directive
2. Zod `safeParse()` validation
3. `createServerSupabaseClient()` + auth check
4. Database operation with `supabase as any`
5. Return `ActionResult<T>`

### Action Signatures

```typescript
// create-income.ts
export async function createIncome(orgId: string, values: IncomeFormValues): Promise<ActionResult<{ id: string }>>

// update-income.ts
export async function updateIncome(incomeId: string, values: IncomeFormValues): Promise<ActionResult>

// delete-income.ts
export async function deleteIncome(incomeId: string): Promise<ActionResult>

// create-expense.ts
export async function createExpense(orgId: string, values: ExpenseFormValues): Promise<ActionResult<{ id: string }>>

// update-expense.ts
export async function updateExpense(expenseId: string, values: ExpenseFormValues): Promise<ActionResult>

// delete-expense.ts
export async function deleteExpense(expenseId: string): Promise<ActionResult>
```

---

## Database Query Helpers

Added to `packages/database/src/queries/`:

### `financial.ts`

```typescript
// Get financial stats for dashboard (server-side)
export async function getFinancialStats(
  supabase: SupabaseClient,
  orgId: string,
  dateRange?: { from: string; to: string }
): Promise<FinancialStats>

// Get monthly trend data for charts
export async function getMonthlyTrend(
  supabase: SupabaseClient,
  orgId: string,
  dateRange?: { from: string; to: string }
): Promise<MonthlyTrendPoint[]>

// Get category breakdown
export async function getCategoryBreakdown(
  supabase: SupabaseClient,
  orgId: string,
  type: 'income' | 'expense',
  dateRange?: { from: string; to: string }
): Promise<CategoryBreakdown[]>

// Get per-property financial comparison
export async function getPropertyFinancials(
  supabase: SupabaseClient,
  orgId: string,
  dateRange?: { from: string; to: string }
): Promise<PropertyFinancial[]>

// Get recent transactions (combined income + expenses)
export async function getRecentTransactions(
  supabase: SupabaseClient,
  orgId: string,
  limit: number
): Promise<RecentTransaction[]>
```

---

## Type Definitions

Added to `packages/types/src/models.ts`:

```typescript
export interface Income {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  amount: number;
  income_type: string;
  description: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  amount: number;
  expense_type: string;
  description: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export interface FinancialStats {
  total_income: number;
  total_expenses: number;
  net_income: number;
  roi: number; // percentage — see ROI formula below
  income_change: number; // % change from previous period
  expense_change: number;
}

export interface MonthlyTrendPoint {
  month: string; // "2026-01", "2026-02", etc.
  income: number;
  expenses: number;
}

export interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
}

export interface PropertyFinancial {
  property_id: string;
  property_name: string;
  income: number;
  expenses: number;
  net: number;
  roi: number;
}

export interface RecentTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string; // income_type or expense_type
  description: string;
  property_name: string;
  transaction_date: string;
}
```

### ROI Formula

```
Per-property ROI = ((total_income - total_expenses) / purchase_price) * 100
Portfolio ROI = (sum(all income) - sum(all expenses)) / sum(all purchase_prices) * 100
If purchase_price is null, the property is excluded from ROI calculation.
ROI is calculated over the selected date range (not annualized).
```

---

## TanStack Query Hooks

### `use-income.ts`

```typescript
interface IncomeFilters {
  orgId: string | null;
  propertyId?: string;
  incomeType?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useIncome(filters: IncomeFilters) {
  return useQuery({
    queryKey: ['income', filters],
    queryFn: async () => { /* fetch from supabase with filters */ },
    enabled: !!filters.orgId,
  });
}
```

### `use-expenses.ts`

Same pattern with `ExpenseFilters` (propertyId, expenseType, search, date range).

### `use-financial-stats.ts`

Available as a client-side alternative, but the primary `/accounting` dashboard uses server-side data fetching. This hook is not used in the initial implementation but is provided for future client-side date range switching if needed.

```typescript
export function useFinancialStats(orgId: string | null, dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: ['financial-stats', orgId, dateRange],
    queryFn: async () => { /* fetch aggregated stats */ },
    enabled: !!orgId,
  });
}
```

---

## Routes & Pages

### `/accounting` — Financial Dashboard

Server component. Fetches all dashboard data server-side, passes to client chart components.

```
Layout:
┌──────────────────────────────────────────────────┐
│  Financial Overview           [date range pills]  │
├──────────┬──────────┬──────────┬──────────────────┤
│ Income   │ Expenses │Net Income│ Portfolio ROI    │
│ $12,450  │ $4,280   │ $8,170   │ 7.2%            │
├──────────┴──────────┴──────────┴──────────────────┤
│ Income vs Expenses (bar chart)  │ Income Breakdown │
│ Recharts BarChart (2/3 width)   │ + Expense Brkdown│
│                                 │ PieCharts (1/3)  │
├─────────────────────────────────┴──────────────────┤
│ Property Performance Table                         │
│ Property | Income | Expenses | Net | ROI           │
│ ...      | ...    | ...      | ... | ...           │
│ Total    | ...    | ...      | ... | ...           │
└────────────────────────────────────────────────────┘
```

**Date range filtering:** URL search params `?range=current_month`. A client component (`DateRangeFilter`) manages the pills and updates the URL. The server component reads `searchParams` and passes date range to query helpers.

### `/accounting/income` — Income List

Client component with TanStack Query.

- Filter bar: property dropdown, type dropdown, search input
- DataTable with columns: Date, Property, Unit, Type (badge), Description, Amount, Actions (edit/delete)
- Default sort: `transaction_date DESC` (newest first). Sortable columns: Date, Amount, Type, Property.
- Pagination: client-side via TanStack Query (fetch all for org, paginate in DataTable)
- "Add Income" button opens `IncomeDialog`
- Edit button opens `IncomeDialog` with pre-filled values
- Delete button shows confirm dialog

Note: The roadmap's `/accounting/income/[id]` and `/accounting/expenses/[id]` routes are replaced by inline edit dialogs on the list pages. No separate detail pages are needed.

### `/accounting/expenses` — Expense List

Same pattern as income list with expense-specific types, columns, sorting, and pagination.

---

## Components

### New Components in `apps/web/components/accounting/`

```
accounting/
├── income-dialog.tsx        # Add/edit income dialog (React Hook Form + Zod)
├── expense-dialog.tsx       # Add/edit expense dialog
├── income-table.tsx         # Income DataTable with columns, filters, actions
├── expense-table.tsx        # Expense DataTable
├── date-range-filter.tsx    # Date range pill selector (client component)
├── income-expense-chart.tsx # Recharts BarChart — income vs expenses trend
├── category-donut.tsx       # Recharts PieChart — category breakdown
├── property-financials.tsx  # Property comparison table
└── recent-transactions.tsx  # Combined income/expense feed for dashboard home
```

### Dialog Form Fields

**IncomeDialog:**
- Property (select, required) — from `useProperties` hook
- Unit (select, optional) — populates based on selected property, hidden for single-unit types
- Amount (number, required, step=0.01)
- Type (select, required) — rent, deposit, late_fee, other
- Description (text, required)
- Date (date input, required, defaults to today)

**ExpenseDialog:**
- Same fields but Type options: mortgage, maintenance, repairs, utilities, insurance, taxes, management, advertising, legal, hoa, home_warranty, other

---

## Sidebar Update

In `apps/web/components/dashboard/sidebar.tsx`:

Replace:
```typescript
{ label: 'Transactions', href: '/transactions', icon: CreditCard, disabled: true, badge: 'Soon' }
```

With:
```typescript
{ label: 'Accounting', href: '/accounting', icon: Calculator, disabled: false }
```

Import `Calculator` from `lucide-react`.

---

## Dashboard Home Upgrade

In `apps/web/app/(dashboard)/page.tsx`:

**Row 1** (existing): Portfolio stat cards — Total Properties, Total Units, Occupancy Rate, Rent Potential

**Row 2** (new): Financial stat cards — Total Income, Total Expenses, Net Income, ROI
- Uses new `getFinancialStats(supabase, orgId)` query
- Current month by default
- Green/red trend indicators vs previous month

**Row 3** (new, replaces placeholder): Recent Transactions feed
- Last 10 combined income + expense records
- Each row shows: date, property name, type badge, +/- amount (green for income, red for expense)
- "View All" link to `/accounting`

---

## Recharts Setup

Install `recharts` in the web app:

```bash
pnpm add recharts --filter @onereal/web
```

Chart components are `'use client'` components that receive pre-aggregated data as props. They do NOT fetch data themselves.

### Chart Components

**`income-expense-chart.tsx`** — Recharts `BarChart` with two bars per month (income green, expenses red). Responsive container. Tooltip with formatted currency.

**`category-donut.tsx`** — Recharts `PieChart` with inner radius for donut effect. Legend with category names and percentages. Tooltip with amounts. Generic component that accepts `type: 'income' | 'expense'` prop — rendered twice on the dashboard (once for income breakdown, once for expense breakdown), stacked vertically in the 1/3 width column.

---

## Error Handling

All server actions return `ActionResult<T>`. Client components show:
- `toast.success()` on successful create/update/delete
- `toast.error(result.error)` on failure
- Form validation errors via React Hook Form + Zod (inline field errors)

Financial dashboard shows empty states when no data exists:
- "No income recorded yet. Add your first income entry." with link to `/accounting/income`
- Charts show placeholder message instead of empty chart

---

## Testing

Playwright e2e tests covering:
- Navigate to `/accounting` — verify dashboard renders
- Add income via dialog — verify it appears in list
- Edit income — verify changes saved
- Delete income — verify removed from list
- Same for expenses
- Verify dashboard stats update after adding income/expense
- Verify date range filtering changes displayed data
- Verify dashboard home shows financial summary cards

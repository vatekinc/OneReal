# Phase 2: Financial Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add income/expense tracking with a financial dashboard to OneReal, enabling landlords to record transactions, view P&L summaries, trend charts, category breakdowns, and compare financial performance across properties.

**Architecture:** Hybrid data fetching — server components for dashboard stats (SQL queries passed as props), TanStack Query for filtered list pages, server actions for mutations. Follows the exact patterns established in Phase 1 (portfolio module).

**Tech Stack:** Next.js 15 (App Router), Supabase (PostgreSQL + RLS), TanStack Query, React Hook Form + Zod, Recharts, shadcn/ui, Sonner toasts

**Spec:** `docs/superpowers/specs/2026-03-14-phase2-financial-management-design.md`

---

## Chunk 1: Database Migration + Types + Module Scaffolding

### Task 1: Database Migration — Financial Tables

**Files:**
- Create: `supabase/migrations/20260314000006_financial_tables.sql`

- [ ] **Step 1: Write the migration SQL file**

```sql
-- ============================================================
-- Migration 006: Financial Tables (income + expenses)
--
-- Phase 2: Financial Management
-- Depends on: organizations, properties, units tables (Phase 1)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)
-- ============================================================

-- -----------------------------------------------------------
-- income table
-- -----------------------------------------------------------
CREATE TABLE public.income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  income_type TEXT NOT NULL CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'other')),
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- expenses table
-- -----------------------------------------------------------
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
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

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------
CREATE INDEX idx_income_org_date ON public.income(org_id, transaction_date);
CREATE INDEX idx_income_property ON public.income(property_id);
CREATE INDEX idx_expenses_org_date ON public.expenses(org_id, transaction_date);
CREATE INDEX idx_expenses_property ON public.expenses(property_id);

-- -----------------------------------------------------------
-- RLS Policies — income
-- -----------------------------------------------------------
ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view income in their orgs"
  ON public.income FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert income in their orgs"
  ON public.income FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update income in their orgs"
  ON public.income FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete income in their orgs"
  ON public.income FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- RLS Policies — expenses
-- -----------------------------------------------------------
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expenses in their orgs"
  ON public.expenses FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert expenses in their orgs"
  ON public.expenses FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update expenses in their orgs"
  ON public.expenses FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete expenses in their orgs"
  ON public.expenses FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- -----------------------------------------------------------
-- Updated-at triggers (moddatetime)
-- -----------------------------------------------------------
CREATE TRIGGER set_income_updated_at
  BEFORE UPDATE ON public.income
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && npx supabase db push`

If using Supabase Cloud dashboard instead, paste the SQL into the SQL Editor and execute.

- [ ] **Step 3: Verify tables exist**

Run the following in Supabase SQL Editor or via CLI:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('income', 'expenses');
```
Expected: Both `income` and `expenses` rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260314000006_financial_tables.sql
git commit -m "feat(db): add income and expenses tables with RLS and indexes"
```

---

### Task 2: Type Definitions — Income, Expense, Financial Stats

**Files:**
- Modify: `packages/types/src/models.ts`
- Modify: `packages/types/src/enums.ts`

- [ ] **Step 1: Add financial type enums to `enums.ts`**

Append to end of `packages/types/src/enums.ts`:

```typescript
export const IncomeType = {
  RENT: 'rent',
  DEPOSIT: 'deposit',
  LATE_FEE: 'late_fee',
  OTHER: 'other',
} as const;
export type IncomeType = (typeof IncomeType)[keyof typeof IncomeType];

export const ExpenseType = {
  MORTGAGE: 'mortgage',
  MAINTENANCE: 'maintenance',
  REPAIRS: 'repairs',
  UTILITIES: 'utilities',
  INSURANCE: 'insurance',
  TAXES: 'taxes',
  MANAGEMENT: 'management',
  ADVERTISING: 'advertising',
  LEGAL: 'legal',
  HOA: 'hoa',
  HOME_WARRANTY: 'home_warranty',
  OTHER: 'other',
} as const;
export type ExpenseType = (typeof ExpenseType)[keyof typeof ExpenseType];
```

- [ ] **Step 2: Add financial model interfaces to `models.ts`**

Append to end of `packages/types/src/models.ts`:

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
  receipt_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialStats {
  total_income: number;
  total_expenses: number;
  net_income: number;
  roi: number;
  income_change: number;
  expense_change: number;
}

export interface MonthlyTrendPoint {
  month: string;
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
  category: string;
  description: string;
  property_name: string;
  transaction_date: string;
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/types type-check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/models.ts packages/types/src/enums.ts
git commit -m "feat(types): add Income, Expense, FinancialStats types and enums"
```

---

### Task 3: Accounting Module Scaffolding

**Files:**
- Create: `modules/accounting/package.json`
- Create: `modules/accounting/tsconfig.json`
- Create: `modules/accounting/src/index.ts`
- Create: `modules/accounting/src/schemas/income-schema.ts`
- Create: `modules/accounting/src/schemas/expense-schema.ts`

- [ ] **Step 1: Create `modules/accounting/package.json`**

```json
{
  "name": "@onereal/accounting",
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

- [ ] **Step 2: Create `modules/accounting/tsconfig.json`**

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

- [ ] **Step 3: Create `modules/accounting/src/schemas/income-schema.ts`**

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

- [ ] **Step 4: Create `modules/accounting/src/schemas/expense-schema.ts`**

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

- [ ] **Step 5: Create `modules/accounting/src/index.ts`**

```typescript
// Schemas (pure types + zod — safe for both client and server)
export { incomeSchema, type IncomeFormValues } from './schemas/income-schema';
export { expenseSchema, type ExpenseFormValues } from './schemas/expense-schema';

// Hooks (client-only)
export { useIncome } from './hooks/use-income';
export { useExpenses } from './hooks/use-expenses';
export { useFinancialStats } from './hooks/use-financial-stats';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createIncome } from '@onereal/accounting/actions/create-income';
```

Note: The hooks referenced here will be created in Task 7. The barrel export is written now so the module structure is complete. Type-checking will fail until hooks exist — that's expected.

- [ ] **Step 6: Add `@onereal/accounting` dependency to web app**

Modify `apps/web/package.json` — add to `dependencies`:
```json
"@onereal/accounting": "workspace:*"
```

- [ ] **Step 7: Install dependencies**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm install`
Expected: Resolves workspace dependencies without errors.

- [ ] **Step 8: Commit**

```bash
git add modules/accounting/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(accounting): scaffold accounting module with Zod schemas"
```

---

## Chunk 2: Server Actions + Database Query Helpers + Hooks

### Task 4: Server Actions — Income CRUD

**Files:**
- Create: `modules/accounting/src/actions/create-income.ts`
- Create: `modules/accounting/src/actions/update-income.ts`
- Create: `modules/accounting/src/actions/delete-income.ts`

- [ ] **Step 1: Create `create-income.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { incomeSchema, type IncomeFormValues } from '../schemas/income-schema';

export async function createIncome(
  orgId: string,
  values: IncomeFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = incomeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db
      .from('income')
      .insert({
        ...parsed.data,
        org_id: orgId,
        unit_id: parsed.data.unit_id || null,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create income entry' };
  }
}
```

- [ ] **Step 2: Create `update-income.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { incomeSchema, type IncomeFormValues } from '../schemas/income-schema';

export async function updateIncome(
  incomeId: string,
  values: IncomeFormValues
): Promise<ActionResult> {
  try {
    const parsed = incomeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('income')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
      })
      .eq('id', incomeId);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to update income entry' };
  }
}
```

- [ ] **Step 3: Create `delete-income.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteIncome(
  incomeId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('income')
      .delete()
      .eq('id', incomeId);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete income entry' };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add modules/accounting/src/actions/create-income.ts modules/accounting/src/actions/update-income.ts modules/accounting/src/actions/delete-income.ts
git commit -m "feat(accounting): add income server actions (create, update, delete)"
```

---

### Task 5: Server Actions — Expense CRUD

**Files:**
- Create: `modules/accounting/src/actions/create-expense.ts`
- Create: `modules/accounting/src/actions/update-expense.ts`
- Create: `modules/accounting/src/actions/delete-expense.ts`

- [ ] **Step 1: Create `create-expense.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { expenseSchema, type ExpenseFormValues } from '../schemas/expense-schema';

export async function createExpense(
  orgId: string,
  values: ExpenseFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = expenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db
      .from('expenses')
      .insert({
        ...parsed.data,
        org_id: orgId,
        unit_id: parsed.data.unit_id || null,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create expense entry' };
  }
}
```

- [ ] **Step 2: Create `update-expense.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { expenseSchema, type ExpenseFormValues } from '../schemas/expense-schema';

export async function updateExpense(
  expenseId: string,
  values: ExpenseFormValues
): Promise<ActionResult> {
  try {
    const parsed = expenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('expenses')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
      })
      .eq('id', expenseId);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to update expense entry' };
  }
}
```

- [ ] **Step 3: Create `delete-expense.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteExpense(
  expenseId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('expenses')
      .delete()
      .eq('id', expenseId);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete expense entry' };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add modules/accounting/src/actions/create-expense.ts modules/accounting/src/actions/update-expense.ts modules/accounting/src/actions/delete-expense.ts
git commit -m "feat(accounting): add expense server actions (create, update, delete)"
```

---

### Task 6: Database Query Helpers — Financial Queries

**Files:**
- Create: `packages/database/src/queries/financial.ts`
- Modify: `packages/database/src/index.ts` (add export)

- [ ] **Step 1: Create `packages/database/src/queries/financial.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';
import type {
  FinancialStats,
  MonthlyTrendPoint,
  CategoryBreakdown,
  PropertyFinancial,
  RecentTransaction,
} from '@onereal/types';

type Client = SupabaseClient<Database>;

interface DateRange {
  from: string;
  to: string;
}

function applyDateFilter(
  query: any,
  dateRange: DateRange | undefined,
  dateColumn: string = 'transaction_date'
) {
  if (!dateRange) return query;
  return query.gte(dateColumn, dateRange.from).lte(dateColumn, dateRange.to);
}

export async function getFinancialStats(
  client: Client,
  orgId: string,
  dateRange?: DateRange
): Promise<FinancialStats> {
  // Current period income
  let incomeQuery = (client as any)
    .from('income')
    .select('amount')
    .eq('org_id', orgId);
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeData } = await incomeQuery;

  // Current period expenses
  let expenseQuery = (client as any)
    .from('expenses')
    .select('amount')
    .eq('org_id', orgId);
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseData } = await expenseQuery;

  const totalIncome = (incomeData ?? []).reduce(
    (sum: number, r: { amount: number }) => sum + Number(r.amount),
    0
  );
  const totalExpenses = (expenseData ?? []).reduce(
    (sum: number, r: { amount: number }) => sum + Number(r.amount),
    0
  );
  const netIncome = totalIncome - totalExpenses;

  // ROI: (net / sum of purchase prices) * 100
  const { data: properties } = await (client as any)
    .from('properties')
    .select('purchase_price')
    .eq('org_id', orgId)
    .not('purchase_price', 'is', null);

  const totalPurchasePrice = (properties ?? []).reduce(
    (sum: number, p: { purchase_price: number }) => sum + Number(p.purchase_price),
    0
  );
  const roi = totalPurchasePrice > 0
    ? (netIncome / totalPurchasePrice) * 100
    : 0;

  // Previous period for % change (same duration, shifted back)
  let incomeChange = 0;
  let expenseChange = 0;
  if (dateRange) {
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - durationMs - 86400000)
      .toISOString().split('T')[0];
    const prevTo = new Date(fromDate.getTime() - 86400000)
      .toISOString().split('T')[0];
    const prevRange = { from: prevFrom, to: prevTo };

    let prevIncomeQ = (client as any)
      .from('income')
      .select('amount')
      .eq('org_id', orgId);
    prevIncomeQ = applyDateFilter(prevIncomeQ, prevRange);
    const { data: prevIncomeData } = await prevIncomeQ;

    let prevExpenseQ = (client as any)
      .from('expenses')
      .select('amount')
      .eq('org_id', orgId);
    prevExpenseQ = applyDateFilter(prevExpenseQ, prevRange);
    const { data: prevExpenseData } = await prevExpenseQ;

    const prevIncome = (prevIncomeData ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + Number(r.amount), 0
    );
    const prevExpenses = (prevExpenseData ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + Number(r.amount), 0
    );

    incomeChange = prevIncome > 0
      ? ((totalIncome - prevIncome) / prevIncome) * 100
      : 0;
    expenseChange = prevExpenses > 0
      ? ((totalExpenses - prevExpenses) / prevExpenses) * 100
      : 0;
  }

  return {
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net_income: netIncome,
    roi: Math.round(roi * 10) / 10,
    income_change: Math.round(incomeChange * 10) / 10,
    expense_change: Math.round(expenseChange * 10) / 10,
  };
}

export async function getMonthlyTrend(
  client: Client,
  orgId: string,
  dateRange?: DateRange
): Promise<MonthlyTrendPoint[]> {
  let incomeQuery = (client as any)
    .from('income')
    .select('amount, transaction_date')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: true });
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeData } = await incomeQuery;

  let expenseQuery = (client as any)
    .from('expenses')
    .select('amount, transaction_date')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: true });
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseData } = await expenseQuery;

  const monthMap = new Map<string, { income: number; expenses: number }>();

  for (const row of incomeData ?? []) {
    const month = row.transaction_date.substring(0, 7); // "2026-03"
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };
    entry.income += Number(row.amount);
    monthMap.set(month, entry);
  }

  for (const row of expenseData ?? []) {
    const month = row.transaction_date.substring(0, 7);
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };
    entry.expenses += Number(row.amount);
    monthMap.set(month, entry);
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      income: data.income,
      expenses: data.expenses,
    }));
}

export async function getCategoryBreakdown(
  client: Client,
  orgId: string,
  type: 'income' | 'expense',
  dateRange?: DateRange
): Promise<CategoryBreakdown[]> {
  const table = type === 'income' ? 'income' : 'expenses';
  const typeColumn = type === 'income' ? 'income_type' : 'expense_type';

  let query = (client as any)
    .from(table)
    .select(`amount, ${typeColumn}`)
    .eq('org_id', orgId);
  query = applyDateFilter(query, dateRange);
  const { data } = await query;

  const categoryMap = new Map<string, number>();
  let total = 0;

  for (const row of data ?? []) {
    const cat = row[typeColumn];
    const amount = Number(row.amount);
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + amount);
    total += amount;
  }

  return Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export async function getPropertyFinancials(
  client: Client,
  orgId: string,
  dateRange?: DateRange
): Promise<PropertyFinancial[]> {
  // Get properties with purchase_price
  const { data: properties } = await (client as any)
    .from('properties')
    .select('id, name, purchase_price')
    .eq('org_id', orgId)
    .order('name');

  if (!properties || properties.length === 0) return [];

  const propertyIds = properties.map((p: any) => p.id);

  // Get income grouped by property
  let incomeQuery = (client as any)
    .from('income')
    .select('property_id, amount')
    .in('property_id', propertyIds);
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeData } = await incomeQuery;

  // Get expenses grouped by property
  let expenseQuery = (client as any)
    .from('expenses')
    .select('property_id, amount')
    .in('property_id', propertyIds);
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseData } = await expenseQuery;

  const incomeMap = new Map<string, number>();
  for (const row of incomeData ?? []) {
    incomeMap.set(row.property_id, (incomeMap.get(row.property_id) ?? 0) + Number(row.amount));
  }

  const expenseMap = new Map<string, number>();
  for (const row of expenseData ?? []) {
    expenseMap.set(row.property_id, (expenseMap.get(row.property_id) ?? 0) + Number(row.amount));
  }

  return properties.map((p: any) => {
    const income = incomeMap.get(p.id) ?? 0;
    const expenses = expenseMap.get(p.id) ?? 0;
    const net = income - expenses;
    const purchasePrice = Number(p.purchase_price) || 0;
    const roi = purchasePrice > 0 ? Math.round((net / purchasePrice) * 1000) / 10 : 0;

    return {
      property_id: p.id,
      property_name: p.name,
      income,
      expenses,
      net,
      roi,
    };
  });
}

export async function getRecentTransactions(
  client: Client,
  orgId: string,
  limit: number = 10
): Promise<RecentTransaction[]> {
  // Fetch recent income
  const { data: incomeData } = await (client as any)
    .from('income')
    .select('id, amount, income_type, description, transaction_date, properties(name)')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: false })
    .limit(limit);

  // Fetch recent expenses
  const { data: expenseData } = await (client as any)
    .from('expenses')
    .select('id, amount, expense_type, description, transaction_date, properties(name)')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: false })
    .limit(limit);

  const transactions: RecentTransaction[] = [];

  for (const row of incomeData ?? []) {
    transactions.push({
      id: row.id,
      type: 'income',
      amount: Number(row.amount),
      category: row.income_type,
      description: row.description,
      property_name: row.properties?.name ?? 'Unknown',
      transaction_date: row.transaction_date,
    });
  }

  for (const row of expenseData ?? []) {
    transactions.push({
      id: row.id,
      type: 'expense',
      amount: Number(row.amount),
      category: row.expense_type,
      description: row.description,
      property_name: row.properties?.name ?? 'Unknown',
      transaction_date: row.transaction_date,
    });
  }

  return transactions
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, limit);
}
```

- [ ] **Step 2: Export financial queries from database index**

Add to the end of `packages/database/src/index.ts`:

```typescript
export * from './queries/financial';
```

- [ ] **Step 3: Verify type-check passes**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/database type-check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/queries/financial.ts packages/database/src/index.ts
git commit -m "feat(database): add financial query helpers (stats, trends, breakdown, property financials)"
```

---

### Task 7: TanStack Query Hooks — Income & Expenses

**Files:**
- Create: `modules/accounting/src/hooks/use-income.ts`
- Create: `modules/accounting/src/hooks/use-expenses.ts`
- Create: `modules/accounting/src/hooks/use-financial-stats.ts`

- [ ] **Step 1: Create `use-income.ts`**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface IncomeFilters {
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
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('income')
        .select('*, properties(name), units(unit_number)')
        .eq('org_id', filters.orgId)
        .order('transaction_date', { ascending: false });

      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.incomeType) {
        query = query.eq('income_type', filters.incomeType);
      }
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`);
      }
      if (filters.from) {
        query = query.gte('transaction_date', filters.from);
      }
      if (filters.to) {
        query = query.lte('transaction_date', filters.to);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}
```

- [ ] **Step 2: Create `use-expenses.ts`**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface ExpenseFilters {
  orgId: string | null;
  propertyId?: string;
  expenseType?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useExpenses(filters: ExpenseFilters) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('expenses')
        .select('*, properties(name), units(unit_number)')
        .eq('org_id', filters.orgId)
        .order('transaction_date', { ascending: false });

      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.expenseType) {
        query = query.eq('expense_type', filters.expenseType);
      }
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`);
      }
      if (filters.from) {
        query = query.gte('transaction_date', filters.from);
      }
      if (filters.to) {
        query = query.lte('transaction_date', filters.to);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}
```

- [ ] **Step 3: Create `use-financial-stats.ts`**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getFinancialStats } from '@onereal/database';

export function useFinancialStats(
  orgId: string | null,
  dateRange?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ['financial-stats', orgId, dateRange],
    queryFn: () => {
      const supabase = createClient();
      return getFinancialStats(supabase as any, orgId!, dateRange);
    },
    enabled: !!orgId,
  });
}
```

- [ ] **Step 4: Verify type-check passes on accounting module**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/accounting type-check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add modules/accounting/src/hooks/
git commit -m "feat(accounting): add TanStack Query hooks for income, expenses, financial stats"
```

---

## Chunk 3: Income & Expense UI Components + Pages

### Task 8: Install Recharts + Sidebar Update

**Files:**
- Modify: `apps/web/package.json` (add recharts)
- Modify: `apps/web/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Install recharts**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm add recharts --filter @onereal/web`
Expected: `recharts` added to `apps/web/package.json` dependencies.

- [ ] **Step 2: Update sidebar — replace Transactions with Accounting**

In `apps/web/components/dashboard/sidebar.tsx`:

Change the import line to add `Calculator`:
```typescript
import {
  LayoutDashboard, Building2, Calculator, Users, Wrench,
  Settings, ChevronLeft, ChevronRight, Menu,
} from 'lucide-react';
```

Replace the `Transactions` navItem:
```typescript
{ label: 'Accounting', href: '/accounting', icon: Calculator, disabled: false },
```

(Remove `CreditCard` from imports since it's no longer used.)

- [ ] **Step 3: Verify the app compiles**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/web build`
Expected: Build succeeds (or at least no import errors — full build may warn about missing routes).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/components/dashboard/sidebar.tsx pnpm-lock.yaml
git commit -m "feat(ui): install recharts, update sidebar Transactions -> Accounting"
```

---

### Task 9: Income Dialog Component

**Files:**
- Create: `apps/web/components/accounting/income-dialog.tsx`

- [ ] **Step 1: Create the income dialog**

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { incomeSchema, type IncomeFormValues } from '@onereal/accounting';
import { createIncome } from '@onereal/accounting/actions/create-income';
import { updateIncome } from '@onereal/accounting/actions/update-income';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import type { Income } from '@onereal/types';

interface IncomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
}

const INCOME_TYPES = [
  { value: 'rent', label: 'Rent' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'late_fee', label: 'Late Fee' },
  { value: 'other', label: 'Other' },
];

export function IncomeDialog({ open, onOpenChange, income }: IncomeDialogProps) {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = propertiesData?.data ?? [];

  const form = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeSchema),
    defaultValues: income
      ? {
          property_id: income.property_id,
          unit_id: income.unit_id,
          amount: income.amount,
          income_type: income.income_type as IncomeFormValues['income_type'],
          description: income.description,
          transaction_date: income.transaction_date,
        }
      : {
          income_type: 'rent',
          description: '',
          transaction_date: new Date().toISOString().split('T')[0],
        },
  });

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = properties.find((p: any) => p.id === selectedPropertyId);
  const units = (selectedProperty as any)?.units ?? [];

  async function onSubmit(values: IncomeFormValues) {
    if (!activeOrg) return;

    const result = income
      ? await updateIncome(income.id, values)
      : await createIncome(activeOrg.id, values);

    if (result.success) {
      toast.success(income ? 'Income updated' : 'Income added');
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
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
          <DialogTitle>{income ? 'Edit Income' : 'Add Income'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="property_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Property *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {properties.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {units.length > 1 && (
                <FormField control={form.control} name="unit_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {units.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>{u.unit_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="income_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {INCOME_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="transaction_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description *</FormLabel>
                <FormControl><Input placeholder="e.g. March rent" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{income ? 'Update' : 'Add Income'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/income-dialog.tsx
git commit -m "feat(ui): add IncomeDialog component"
```

---

### Task 10: Expense Dialog Component

**Files:**
- Create: `apps/web/components/accounting/expense-dialog.tsx`

- [ ] **Step 1: Create the expense dialog**

Same pattern as `IncomeDialog` but with expense types. Key differences:
- Uses `expenseSchema` / `ExpenseFormValues` from `@onereal/accounting`
- Uses `createExpense` / `updateExpense` actions
- EXPENSE_TYPES array: mortgage, maintenance, repairs, utilities, insurance, taxes, management, advertising, legal, hoa, home_warranty, other
- Invalidates `['expenses']` query key
- Takes `expense: Expense | null` prop

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { expenseSchema, type ExpenseFormValues } from '@onereal/accounting';
import { createExpense } from '@onereal/accounting/actions/create-expense';
import { updateExpense } from '@onereal/accounting/actions/update-expense';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import type { Expense } from '@onereal/types';

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
}

const EXPENSE_TYPES = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'management', label: 'Management' },
  { value: 'advertising', label: 'Advertising' },
  { value: 'legal', label: 'Legal' },
  { value: 'hoa', label: 'HOA' },
  { value: 'home_warranty', label: 'Home Warranty' },
  { value: 'other', label: 'Other' },
];

export function ExpenseDialog({ open, onOpenChange, expense }: ExpenseDialogProps) {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = propertiesData?.data ?? [];

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense
      ? {
          property_id: expense.property_id,
          unit_id: expense.unit_id,
          amount: expense.amount,
          expense_type: expense.expense_type as ExpenseFormValues['expense_type'],
          description: expense.description,
          transaction_date: expense.transaction_date,
        }
      : {
          expense_type: 'mortgage',
          description: '',
          transaction_date: new Date().toISOString().split('T')[0],
        },
  });

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = properties.find((p: any) => p.id === selectedPropertyId);
  const units = (selectedProperty as any)?.units ?? [];

  async function onSubmit(values: ExpenseFormValues) {
    if (!activeOrg) return;

    const result = expense
      ? await updateExpense(expense.id, values)
      : await createExpense(activeOrg.id, values);

    if (result.success) {
      toast.success(expense ? 'Expense updated' : 'Expense added');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
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
          <DialogTitle>{expense ? 'Edit Expense' : 'Add Expense'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="property_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Property *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {properties.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {units.length > 1 && (
                <FormField control={form.control} name="unit_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {units.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>{u.unit_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="expense_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {EXPENSE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="transaction_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description *</FormLabel>
                <FormControl><Input placeholder="e.g. March mortgage payment" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{expense ? 'Update' : 'Add Expense'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/expense-dialog.tsx
git commit -m "feat(ui): add ExpenseDialog component"
```

---

### Task 11: Income List Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/income/page.tsx`

- [ ] **Step 1: Create the income list page**

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useIncome } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { deleteIncome } from '@onereal/accounting/actions/delete-income';
import { IncomeDialog } from '@/components/accounting/income-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Income } from '@onereal/types';

const INCOME_TYPES = [
  { value: 'rent', label: 'Rent' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'late_fee', label: 'Late Fee' },
  { value: 'other', label: 'Other' },
];

export default function IncomePage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = propertiesData?.data ?? [];

  const { data: incomeList, isLoading } = useIncome({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    incomeType: typeFilter || undefined,
    search: search || undefined,
  });

  async function handleDelete(id: string) {
    if (!confirm('Delete this income entry?')) return;
    const result = await deleteIncome(id);
    if (result.success) {
      toast.success('Income deleted');
      queryClient.invalidateQueries({ queryKey: ['income'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(income: Income) {
    setEditingIncome(income);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingIncome(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Income
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {INCOME_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !incomeList || incomeList.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No income recorded yet</p>
          <Button onClick={handleAdd}>Add your first income entry</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incomeList.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(item.transaction_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{item.properties?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{item.units?.unit_number ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.income_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.description}</TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    ${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      Note: The spec calls for sortable columns (Date, Amount, Type, Property). The bare `<Table>` component is used here for simplicity. If the `DataTable` component from `@onereal/ui` supports column sorting, swap to that instead. Column sorting can also be added as a follow-up enhancement.

      <IncomeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        income={editingIncome}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/income/page.tsx
git commit -m "feat(ui): add income list page with CRUD"
```

---

### Task 12: Expense List Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/expenses/page.tsx`

- [ ] **Step 1: Create the expense list page**

Same pattern as income list page. Key differences:
- Uses `useExpenses` hook with `ExpenseFilters`
- Uses `deleteExpense` action
- EXPENSE_TYPES array (12 types)
- Amount displayed in red (`text-red-600`)
- Edit opens `ExpenseDialog`

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { deleteExpense } from '@onereal/accounting/actions/delete-expense';
import { ExpenseDialog } from '@/components/accounting/expense-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Expense } from '@onereal/types';

const EXPENSE_TYPES = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'management', label: 'Management' },
  { value: 'advertising', label: 'Advertising' },
  { value: 'legal', label: 'Legal' },
  { value: 'hoa', label: 'HOA' },
  { value: 'home_warranty', label: 'Home Warranty' },
  { value: 'other', label: 'Other' },
];

export default function ExpensesPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = propertiesData?.data ?? [];

  const { data: expenseList, isLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    expenseType: typeFilter || undefined,
    search: search || undefined,
  });

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense entry?')) return;
    const result = await deleteExpense(id);
    if (result.success) {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(expense: Expense) {
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingExpense(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Expense
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EXPENSE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !expenseList || expenseList.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No expenses recorded yet</p>
          <Button onClick={handleAdd}>Add your first expense</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenseList.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(item.transaction_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{item.properties?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{item.units?.unit_number ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.expense_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.description}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    ${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      Note: Same as income page — sortable columns (Date, Amount, Type, Property) can be added via `DataTable` or as a follow-up.

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editingExpense}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/expenses/page.tsx
git commit -m "feat(ui): add expense list page with CRUD"
```

---

## Chunk 4: Financial Dashboard + Recharts Charts

### Task 13: Date Range Filter Component

**Files:**
- Create: `apps/web/components/accounting/date-range-filter.tsx`

- [ ] **Step 1: Create the date range filter**

```typescript
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { cn, Button } from '@onereal/ui';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

export function DateRangeFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRange = searchParams.get('range') ?? 'current_month';

  function handleRangeChange(range: string) {
    const params = new URLSearchParams(searchParams.toString());
    // Clear custom date params when using preset
    params.delete('from');
    params.delete('to');
    params.set('range', range);
    router.push(`/accounting?${params.toString()}`);
  }

  return (
    <div className="flex gap-1.5">
      {DATE_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={activeRange === r.value ? 'default' : 'secondary'}
          size="sm"
          onClick={() => handleRangeChange(r.value)}
          className={cn('text-xs', activeRange !== r.value && 'text-muted-foreground')}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create date range resolver utility**

Create `apps/web/lib/date-range.ts`:

```typescript
export interface DateRange {
  from: string;
  to: string;
}

export function resolveDateRange(
  range?: string | null,
  from?: string | null,
  to?: string | null
): DateRange | undefined {
  if (from && to) return { from, to };

  const now = new Date();
  const toDate = now.toISOString().split('T')[0];

  switch (range ?? 'current_month') {
    case 'current_month': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString().split('T')[0], to: toDate };
    }
    case 'current_year': {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      return { from: firstOfYear.toISOString().split('T')[0], to: toDate };
    }
    case '3yr': {
      const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      return { from: threeYearsAgo.toISOString().split('T')[0], to: toDate };
    }
    case '5yr': {
      const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      return { from: fiveYearsAgo.toISOString().split('T')[0], to: toDate };
    }
    case 'all':
      return undefined; // No date filter
    default:
      return undefined;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/accounting/date-range-filter.tsx apps/web/lib/date-range.ts
git commit -m "feat(ui): add DateRangeFilter component and date range resolver"
```

---

### Task 14: Recharts Chart Components

**Files:**
- Create: `apps/web/components/accounting/income-expense-chart.tsx`
- Create: `apps/web/components/accounting/category-donut.tsx`
- Create: `apps/web/components/accounting/property-financials.tsx`

- [ ] **Step 1: Create `income-expense-chart.tsx`**

```typescript
'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { MonthlyTrendPoint } from '@onereal/types';

interface IncomeExpenseChartProps {
  data: MonthlyTrendPoint[];
}

function formatMonth(month: string): string {
  const [, m] = month.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(m, 10) - 1] ?? m;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function IncomeExpenseChart({ data }: IncomeExpenseChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No transaction data for the selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tickFormatter={formatMonth} stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis tickFormatter={formatCurrency} stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip formatter={(value: number) => formatCurrency(value)} />
        <Legend />
        <Bar dataKey="income" name="Income" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Create `category-donut.tsx`**

```typescript
'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { CategoryBreakdown } from '@onereal/types';

interface CategoryDonutProps {
  data: CategoryBreakdown[];
  title: string;
}

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#e11d48'];

function formatLabel(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CategoryDonut({ data, title }: CategoryDonutProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No data
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={70}
            dataKey="amount"
            nameKey="category"
          >
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [
              `$${value.toLocaleString()}`,
              formatLabel(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 space-y-1">
        {data.map((item, i) => (
          <div key={item.category} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              {formatLabel(item.category)}
            </span>
            <span className="text-muted-foreground">{item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `property-financials.tsx`**

```typescript
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import type { PropertyFinancial } from '@onereal/types';

interface PropertyFinancialsProps {
  data: PropertyFinancial[];
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}

export function PropertyFinancialsTable({ data }: PropertyFinancialsProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No property financial data available
      </div>
    );
  }

  const totals = data.reduce(
    (acc, p) => ({
      income: acc.income + p.income,
      expenses: acc.expenses + p.expenses,
      net: acc.net + p.net,
    }),
    { income: 0, expenses: 0, net: 0 }
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">ROI</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((p) => (
          <TableRow key={p.property_id}>
            <TableCell>{p.property_name}</TableCell>
            <TableCell className="text-right text-green-600">{fmt(p.income)}</TableCell>
            <TableCell className="text-right text-red-600">{fmt(p.expenses)}</TableCell>
            <TableCell className="text-right font-medium">{fmt(p.net)}</TableCell>
            <TableCell className="text-right text-amber-600">{p.roi}%</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 font-bold">
          <TableCell>Portfolio Total</TableCell>
          <TableCell className="text-right text-green-600">{fmt(totals.income)}</TableCell>
          <TableCell className="text-right text-red-600">{fmt(totals.expenses)}</TableCell>
          <TableCell className="text-right">{fmt(totals.net)}</TableCell>
          <TableCell className="text-right text-amber-600">—</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/accounting/income-expense-chart.tsx apps/web/components/accounting/category-donut.tsx apps/web/components/accounting/property-financials.tsx
git commit -m "feat(ui): add Recharts chart components (bar chart, donut, property table)"
```

---

### Task 15: Accounting Dashboard Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/page.tsx`

- [ ] **Step 1: Create the accounting dashboard server component**

```typescript
import { Suspense } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getProfile, getFinancialStats, getMonthlyTrend,
  getCategoryBreakdown, getPropertyFinancials,
} from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { StatCard, Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { DollarSign, TrendingDown, TrendingUp, Percent } from 'lucide-react';
import Link from 'next/link';
import { DateRangeFilter } from '@/components/accounting/date-range-filter';
import { IncomeExpenseChart } from '@/components/accounting/income-expense-chart';
import { CategoryDonut } from '@/components/accounting/category-donut';
import { PropertyFinancialsTable } from '@/components/accounting/property-financials';
import { resolveDateRange } from '@/lib/date-range';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AccountingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;
  const dateRange = resolveDateRange(params.range, params.from, params.to);

  const [stats, trend, incomeBreakdown, expenseBreakdown, propertyFinancials] = await Promise.all([
    getFinancialStats(supabase, orgId, dateRange),
    getMonthlyTrend(supabase, orgId, dateRange),
    getCategoryBreakdown(supabase, orgId, 'income', dateRange),
    getCategoryBreakdown(supabase, orgId, 'expense', dateRange),
    getPropertyFinancials(supabase, orgId, dateRange),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Financial Overview</h1>
          <p className="text-sm text-muted-foreground">
            <Link href="/accounting/income" className="hover:underline">Income</Link>
            {' / '}
            <Link href="/accounting/expenses" className="hover:underline">Expenses</Link>
          </p>
        </div>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {/* Row 1: Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Income"
          value={`$${stats.total_income.toLocaleString()}`}
          icon={TrendingUp}
          trend={dateRange ? { value: stats.income_change, positive: stats.income_change >= 0 } : undefined}
        />
        <StatCard
          title="Total Expenses"
          value={`$${stats.total_expenses.toLocaleString()}`}
          icon={TrendingDown}
          trend={dateRange ? { value: stats.expense_change, positive: stats.expense_change <= 0 } : undefined}
        />
        <StatCard
          title="Net Income"
          value={`$${stats.net_income.toLocaleString()}`}
          icon={DollarSign}
          description={stats.net_income >= 0 ? 'Profitable' : 'Net loss'}
        />
        <StatCard
          title="Portfolio ROI"
          value={`${stats.roi}%`}
          icon={Percent}
          description="Based on purchase prices"
        />
      </div>

      {/* Row 2: Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Income vs Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <CategoryDonut data={incomeBreakdown} title="Income" />
            <CategoryDonut data={expenseBreakdown} title="Expenses" />
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Property Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Property Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyFinancialsTable data={propertyFinancials} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/web build`
Expected: Build succeeds. If there are import issues, fix them.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/page.tsx
git commit -m "feat(ui): add accounting dashboard with stats, charts, and property comparison"
```

---

## Chunk 5: Dashboard Home Upgrade + Playwright Tests

### Task 16: Recent Transactions Component

**Files:**
- Create: `apps/web/components/accounting/recent-transactions.tsx`

- [ ] **Step 1: Create the recent transactions component**

```typescript
import { Badge } from '@onereal/ui';
import type { RecentTransaction } from '@onereal/types';
import Link from 'next/link';

interface RecentTransactionsProps {
  transactions: RecentTransaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions recorded yet.{' '}
        <Link href="/accounting/income" className="text-primary hover:underline">
          Add your first income entry
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {transactions.map((t) => (
        <div key={`${t.type}-${t.id}`} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{t.description}</span>
              <span className="text-xs text-muted-foreground">
                {t.property_name} &middot; {new Date(t.transaction_date).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {t.category.replace(/_/g, ' ')}
            </Badge>
            <span
              className={`text-sm font-medium ${
                t.type === 'income' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {t.type === 'income' ? '+' : '-'}${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/recent-transactions.tsx
git commit -m "feat(ui): add RecentTransactions component"
```

---

### Task 17: Dashboard Home Upgrade

**Files:**
- Modify: `apps/web/app/(dashboard)/page.tsx`

- [ ] **Step 1: Update the dashboard page**

Replace the entire content of `apps/web/app/(dashboard)/page.tsx` with:

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProfile, getPortfolioStats, getFinancialStats, getRecentTransactions } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { StatCard, Button, Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { Building2, DoorOpen, Percent, DollarSign, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { RecentTransactions } from '@/components/accounting/recent-transactions';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default async function DashboardPage() {
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;

  // Compute current month date range
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const dateRange = {
    from: firstOfMonth.toISOString().split('T')[0],
    to: now.toISOString().split('T')[0],
  };

  const [portfolioStats, financialStats, recentTransactions] = await Promise.all([
    getPortfolioStats(supabase, orgId),
    getFinancialStats(supabase, orgId, dateRange),
    getRecentTransactions(supabase, orgId, 10),
  ]);

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

      {/* Row 1: Portfolio Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={portfolioStats.total_properties}
          icon={Building2}
          description="Active properties"
        />
        <StatCard
          title="Total Units"
          value={portfolioStats.total_units}
          icon={DoorOpen}
          description={`${portfolioStats.occupied_units} occupied`}
        />
        <StatCard
          title="Occupancy Rate"
          value={`${portfolioStats.occupancy_rate}%`}
          icon={Percent}
          description="Across all properties"
        />
        <StatCard
          title="Rent Potential"
          value={`$${portfolioStats.total_rent_potential.toLocaleString()}`}
          icon={DollarSign}
          description="Monthly total"
        />
      </div>

      {/* Row 2: Financial Stats (current month) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly Income"
          value={`$${financialStats.total_income.toLocaleString()}`}
          icon={TrendingUp}
          trend={{ value: financialStats.income_change, positive: financialStats.income_change >= 0 }}
        />
        <StatCard
          title="Monthly Expenses"
          value={`$${financialStats.total_expenses.toLocaleString()}`}
          icon={TrendingDown}
          trend={{ value: financialStats.expense_change, positive: financialStats.expense_change <= 0 }}
        />
        <StatCard
          title="Net Income"
          value={`$${financialStats.net_income.toLocaleString()}`}
          icon={DollarSign}
          description="This month"
        />
        <StatCard
          title="Portfolio ROI"
          value={`${financialStats.roi}%`}
          icon={Percent}
          description="This month"
        />
      </div>

      {/* Row 3: Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Link href="/accounting" className="text-sm text-primary hover:underline">
            View All
          </Link>
        </CardHeader>
        <CardContent>
          <RecentTransactions transactions={recentTransactions} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/web build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/page.tsx
git commit -m "feat(dashboard): upgrade home page with financial stats and recent transactions"
```

---

### Task 18: Playwright E2E Tests

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`

- [ ] **Step 1: Update existing sidebar test**

In the `Sidebar Navigation` test section, update the "disabled nav items show Soon badge" test. Since we replaced Transactions with Accounting (which is enabled), there are now fewer "Soon" badges. The test should still pass because Tenants and Maintenance still have "Soon" badges.

No change needed if test just checks `soonBadges.first()` — there are still 2 remaining.

- [ ] **Step 2: Update existing "Coming Soon" test for transactions page**

The `transactions page shows in development` test at line ~607 will still work because the `/transactions` route still exists as a placeholder page. No change needed.

- [ ] **Step 3: Add accounting dashboard tests**

Append the following test sections to `apps/web/e2e/smoke.spec.ts`:

```typescript
// ---------------------------------------------------------------------------
// 16. ACCOUNTING DASHBOARD
// ---------------------------------------------------------------------------
test.describe('Accounting Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('accounting dashboard renders without errors', async ({ page }) => {
    await page.goto('/accounting');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Financial Overview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
  });

  test('accounting dashboard shows stat cards', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByText('Total Income')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Expenses')).toBeVisible();
    await expect(page.getByText('Net Income')).toBeVisible();
    await expect(page.getByText('Portfolio ROI')).toBeVisible();
  });

  test('accounting dashboard has date range filter', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'This Year' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
  });

  test('accounting dashboard shows chart sections', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByText('Income vs Expenses')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Breakdown')).toBeVisible();
    await expect(page.getByText('Property Performance')).toBeVisible();
  });

  test('accounting dashboard has navigation links', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('link', { name: /income/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /expenses/i })).toBeVisible();
  });

  test('date range filter changes URL', async ({ page }) => {
    await page.goto('/accounting');
    await page.getByRole('button', { name: 'This Year' }).click();
    await page.waitForURL(/range=current_year/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 17. ACCOUNTING — SIDEBAR
// ---------------------------------------------------------------------------
test.describe('Accounting Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
  });

  test('sidebar shows Accounting link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /accounting/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('navigate to accounting via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /accounting/i }).first().click();
    await page.waitForURL('/accounting', { timeout: 10000 });
    await expect(page.getByText('Financial Overview')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 18. INCOME LIST PAGE
// ---------------------------------------------------------------------------
test.describe('Income List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/accounting/income');
    await page.waitForLoadState('networkidle');
  });

  test('income page renders without errors', async ({ page }) => {
    await expect(page.getByText('Income').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('income page has Add Income button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add income/i })).toBeVisible({ timeout: 10000 });
  });

  test('income page has filter controls', async ({ page }) => {
    await expect(page.getByText('All Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByPlaceholder('Search...')).toBeVisible();
  });

  test('Add Income button opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add income/i }).click();
    await expect(page.getByText('Add Income')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Property *')).toBeVisible();
    await expect(page.getByText('Amount *')).toBeVisible();
    await expect(page.getByText('Type *')).toBeVisible();
    await expect(page.getByText('Description *')).toBeVisible();
    await expect(page.getByText('Date *')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 19. EXPENSE LIST PAGE
// ---------------------------------------------------------------------------
test.describe('Expense List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/accounting/expenses');
    await page.waitForLoadState('networkidle');
  });

  test('expenses page renders without errors', async ({ page }) => {
    await expect(page.getByText('Expenses').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('expenses page has Add Expense button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add expense/i })).toBeVisible({ timeout: 10000 });
  });

  test('expenses page has filter controls', async ({ page }) => {
    await expect(page.getByText('All Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByPlaceholder('Search...')).toBeVisible();
  });

  test('Add Expense button opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    await expect(page.getByText('Add Expense')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Property *')).toBeVisible();
    await expect(page.getByText('Amount *')).toBeVisible();
    await expect(page.getByText('Type *')).toBeVisible();
    await expect(page.getByText('Description *')).toBeVisible();
    await expect(page.getByText('Date *')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 20. DASHBOARD HOME — Financial Stats
// ---------------------------------------------------------------------------
test.describe('Dashboard Financial Stats', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows financial stat cards', async ({ page }) => {
    await expect(page.getByText('Monthly Income')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Monthly Expenses')).toBeVisible();
    await expect(page.getByText('Net Income')).toBeVisible();
    await expect(page.getByText('Portfolio ROI')).toBeVisible();
  });

  test('dashboard shows recent transactions section', async ({ page }) => {
    await expect(page.getByText('Recent Transactions')).toBeVisible({ timeout: 10000 });
  });

  test('dashboard has View All link to accounting', async ({ page }) => {
    await expect(page.getByRole('link', { name: /view all/i })).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 21. ACCOUNTING PAGES — No Console Errors
// ---------------------------------------------------------------------------
test.describe('Accounting No Console Errors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('accounting dashboard has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('income page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting/income');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('expenses page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting/expenses');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });
});
```

- [ ] **Step 4: Also add accounting pages to the "No Server Errors (5xx)" test**

In the existing `No Server Errors (5xx)` test block, add `/accounting`, `/accounting/income`, `/accounting/expenses` to the pages array:

```typescript
const pages = ['/', '/properties', '/properties/new', '/settings', '/settings/profile', '/accounting', '/accounting/income', '/accounting/expenses'];
```

- [ ] **Step 5: Run Playwright tests**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal/apps/web && npx playwright test`
Expected: All new tests pass (assuming the migration has been applied to Supabase Cloud).

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts
git commit -m "test: add Playwright e2e tests for accounting pages"
```

---

### Task 19: Final Verification

- [ ] **Step 1: Run full build**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm build`
Expected: All packages build successfully.

- [ ] **Step 2: Run type checks**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm --filter @onereal/types type-check && pnpm --filter @onereal/database type-check && pnpm --filter @onereal/accounting type-check`
Expected: No type errors.

- [ ] **Step 3: Run all Playwright tests**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal/apps/web && npx playwright test`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test**

1. Open `http://localhost:3000` — verify dashboard shows financial stat cards + recent transactions
2. Click "Accounting" in sidebar — verify dashboard loads with charts
3. Click "Income" link — verify list page loads with Add Income button
4. Click "Add Income" — fill form, submit, verify entry appears
5. Click edit icon — verify dialog pre-fills, update works
6. Click delete icon — verify entry removed
7. Repeat for expenses
8. Return to accounting dashboard — verify stats updated
9. Change date range — verify URL changes, data updates

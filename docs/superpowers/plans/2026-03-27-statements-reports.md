# Statements & Rent Roll Reports — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tenant Statement, Property Statement, and Rent Roll reports on a new Statements page under Reports.

**Architecture:** Three PostgreSQL RPC functions aggregate data server-side. TypeScript query wrappers call RPCs via Supabase client. React Query hooks provide cached data to table components. A new `/reports/statements` page with 3 tabs hosts the UI.

**Tech Stack:** PostgreSQL RPCs, Supabase JS client, React Query, Next.js App Router, @onereal/ui components, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-27-statements-reports-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260327000001_statement_rpcs.sql` | Create | Three RPC functions: `get_tenant_statement`, `get_property_statement`, `get_rent_roll` |
| `packages/types/src/models.ts` | Modify | Add `TenantStatementRow`, `PropertyStatementRow`, `RentRollRow` interfaces |
| `packages/database/src/queries/statements.ts` | Create | Query wrappers calling RPCs |
| `packages/database/src/index.ts` | Modify | Re-export statements queries |
| `modules/accounting/src/hooks/use-statements.ts` | Create | Three React Query hooks |
| `modules/accounting/src/index.ts` | Modify | Re-export statement hooks |
| `apps/web/components/reports/tenant-statement-table.tsx` | Create | Tenant statement table component |
| `apps/web/components/reports/property-statement-table.tsx` | Create | Property statement table component |
| `apps/web/components/reports/rent-roll-table.tsx` | Create | Rent roll table component |
| `apps/web/app/(dashboard)/reports/statements/page.tsx` | Create | Statements page with 3 tabs |
| `apps/web/components/dashboard/sidebar.tsx` | Modify | Add Reports children (Financial Reports + Statements) |

---

## Chunk 1: Database & Data Layer

### Task 1: Create RPC Migration File

**Files:**
- Create: `supabase/migrations/20260327000001_statement_rpcs.sql`

- [ ] **Step 1: Create the migration file with `get_tenant_statement` RPC**

```sql
-- ==========================================================
-- Statements & Rent Roll RPC Functions
-- ==========================================================

-- 1. Tenant Statement
-- Returns chronological ledger of all financial activity for a tenant at a specific property.
CREATE OR REPLACE FUNCTION public.get_tenant_statement(
  p_org_id UUID,
  p_tenant_id UUID,
  p_property_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  txn_date DATE,
  sort_key BIGINT,
  txn_type TEXT,
  description TEXT,
  reference TEXT,
  charge_amount NUMERIC,
  payment_amount NUMERIC,
  running_balance NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    -- Charges (receivable invoices, excluding late fees)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'charge'::TEXT AS txn_type,
      i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NULL
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Late fees
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'late_fee'::TEXT AS txn_type,
      'Late fee: ' || i.description,
      i.invoice_number AS reference,
      i.amount AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM invoices i
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND i.late_fee_for_invoice_id IS NOT NULL
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Payments (join through invoices to scope by tenant + property)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'payment'::TEXT AS txn_type,
      COALESCE(p.payment_method, '') || CASE WHEN p.reference_number IS NOT NULL AND p.reference_number <> '' THEN ' #' || p.reference_number ELSE '' END,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      p.amount AS payment_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.org_id = p_org_id
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Credits issued (informational — $0 payment so no balance impact)
    SELECT
      cr.created_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM cr.created_at)::BIGINT AS sort_key,
      'credit'::TEXT AS txn_type,
      cr.reason AS description,
      LEFT(cr.id::TEXT, 8) AS reference,
      0::NUMERIC AS charge_amount,
      0::NUMERIC AS payment_amount
    FROM credits cr
    WHERE cr.org_id = p_org_id
      AND cr.tenant_id = p_tenant_id
      AND (cr.property_id = p_property_id OR cr.property_id IS NULL)
      AND (p_from IS NULL OR cr.created_at::DATE >= p_from)
      AND (p_to IS NULL OR cr.created_at::DATE <= p_to)

    UNION ALL

    -- Credit applications (reduces balance)
    SELECT
      ca.applied_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM ca.applied_at)::BIGINT AS sort_key,
      'credit_applied'::TEXT AS txn_type,
      'Credit applied: ' || cr.reason AS description,
      i.invoice_number AS reference,
      0::NUMERIC AS charge_amount,
      ca.amount AS payment_amount
    FROM credit_applications ca
    JOIN credits cr ON cr.id = ca.credit_id
    JOIN invoices i ON i.id = ca.invoice_id
    WHERE ca.org_id = p_org_id
      AND ca.status = 'active'
      AND i.tenant_id = p_tenant_id
      AND i.property_id = p_property_id
      AND (p_from IS NULL OR ca.applied_at::DATE >= p_from)
      AND (p_to IS NULL OR ca.applied_at::DATE <= p_to)
  )
  SELECT
    l.txn_date,
    l.sort_key,
    l.txn_type,
    l.description,
    l.reference,
    l.charge_amount,
    l.payment_amount,
    SUM(l.charge_amount - l.payment_amount) OVER (ORDER BY l.txn_date, l.sort_key) AS running_balance
  FROM ledger l
  ORDER BY l.txn_date, l.sort_key;
$$;
```

- [ ] **Step 2: Add `get_property_statement` RPC to the same file**

```sql
-- 2. Property Statement
-- Returns chronological ledger of all financial activity for a property (cash basis).
CREATE OR REPLACE FUNCTION public.get_property_statement(
  p_org_id UUID,
  p_property_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  txn_date DATE,
  sort_key BIGINT,
  txn_type TEXT,
  tenant_or_vendor TEXT,
  description TEXT,
  income_amount NUMERIC,
  expense_amount NUMERIC,
  running_balance NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    -- Rent charges (informational — $0 income/expense)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'rent_charge'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      i.description,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM invoices i
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND i.status NOT IN ('void', 'draft')
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Rent payments (cash in)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'rent_payment'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      COALESCE(p.payment_method, '') || ' payment for ' || i.invoice_number,
      p.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'receivable'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Credits issued (informational)
    SELECT
      cr.created_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM cr.created_at)::BIGINT AS sort_key,
      'credit_issued'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      'Credit: ' || cr.reason,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM credits cr
    LEFT JOIN tenants t ON t.id = cr.tenant_id
    WHERE cr.org_id = p_org_id
      AND cr.property_id = p_property_id
      AND (p_from IS NULL OR cr.created_at::DATE >= p_from)
      AND (p_to IS NULL OR cr.created_at::DATE <= p_to)

    UNION ALL

    -- Credit applications (virtual income)
    SELECT
      ca.applied_at::DATE AS txn_date,
      EXTRACT(EPOCH FROM ca.applied_at)::BIGINT AS sort_key,
      'credit_applied'::TEXT AS txn_type,
      t.first_name || ' ' || t.last_name AS tenant_or_vendor,
      'Credit applied: ' || cr.reason || ' to ' || i.invoice_number,
      ca.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM credit_applications ca
    JOIN credits cr ON cr.id = ca.credit_id
    JOIN invoices i ON i.id = ca.invoice_id
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE ca.org_id = p_org_id
      AND ca.status = 'active'
      AND i.property_id = p_property_id
      AND (p_from IS NULL OR ca.applied_at::DATE >= p_from)
      AND (p_to IS NULL OR ca.applied_at::DATE <= p_to)

    UNION ALL

    -- Expense bills (informational)
    SELECT
      i.due_date AS txn_date,
      EXTRACT(EPOCH FROM i.created_at)::BIGINT AS sort_key,
      'expense_bill'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      i.description,
      0::NUMERIC AS income_amount,
      0::NUMERIC AS expense_amount
    FROM invoices i
    LEFT JOIN service_providers sp ON sp.id = i.provider_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'payable'
      AND i.status NOT IN ('void', 'draft')
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to IS NULL OR i.due_date <= p_to)

    UNION ALL

    -- Expense payments (cash out)
    SELECT
      p.payment_date AS txn_date,
      EXTRACT(EPOCH FROM p.created_at)::BIGINT AS sort_key,
      'expense_payment'::TEXT AS txn_type,
      sp.name AS tenant_or_vendor,
      COALESCE(p.payment_method, '') || ' payment for ' || i.invoice_number,
      0::NUMERIC AS income_amount,
      p.amount AS expense_amount
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN service_providers sp ON sp.id = i.provider_id
    WHERE i.org_id = p_org_id
      AND i.property_id = p_property_id
      AND i.direction = 'payable'
      AND (p_from IS NULL OR p.payment_date >= p_from)
      AND (p_to IS NULL OR p.payment_date <= p_to)

    UNION ALL

    -- Direct income (manual entries only — exclude payment-generated)
    SELECT
      inc.transaction_date AS txn_date,
      EXTRACT(EPOCH FROM inc.created_at)::BIGINT AS sort_key,
      'income'::TEXT AS txn_type,
      NULL::TEXT AS tenant_or_vendor,
      inc.description,
      inc.amount AS income_amount,
      0::NUMERIC AS expense_amount
    FROM income inc
    WHERE inc.org_id = p_org_id
      AND inc.property_id = p_property_id
      AND (p_from IS NULL OR inc.transaction_date >= p_from)
      AND (p_to IS NULL OR inc.transaction_date <= p_to)
      AND NOT EXISTS (
        SELECT 1 FROM payments px WHERE px.income_id = inc.id
      )

    UNION ALL

    -- Direct expenses (manual entries only — exclude payment-generated)
    SELECT
      exp.transaction_date AS txn_date,
      EXTRACT(EPOCH FROM exp.created_at)::BIGINT AS sort_key,
      'expense'::TEXT AS txn_type,
      NULL::TEXT AS tenant_or_vendor,
      exp.description,
      0::NUMERIC AS income_amount,
      exp.amount AS expense_amount
    FROM expenses exp
    WHERE exp.org_id = p_org_id
      AND exp.property_id = p_property_id
      AND (p_from IS NULL OR exp.transaction_date >= p_from)
      AND (p_to IS NULL OR exp.transaction_date <= p_to)
      AND NOT EXISTS (
        SELECT 1 FROM payments px WHERE px.expense_id = exp.id
      )
  )
  SELECT
    l.txn_date,
    l.sort_key,
    l.txn_type,
    l.tenant_or_vendor,
    l.description,
    l.income_amount,
    l.expense_amount,
    SUM(l.income_amount - l.expense_amount) OVER (ORDER BY l.txn_date, l.sort_key) AS running_balance
  FROM ledger l
  ORDER BY l.txn_date, l.sort_key;
$$;
```

- [ ] **Step 3: Add `get_rent_roll` RPC to the same file**

```sql
-- 3. Rent Roll
-- Returns current rent roll snapshot grouped by tenant.
CREATE OR REPLACE FUNCTION public.get_rent_roll(
  p_org_id UUID,
  p_lease_status TEXT DEFAULT 'active',
  p_property_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tenant_id UUID,
  first_name TEXT,
  last_name TEXT,
  lease_count BIGINT,
  total_monthly_rent NUMERIC,
  balance_due NUMERIC,
  credit_balance NUMERIC,
  net_due NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    t.id AS tenant_id,
    t.first_name,
    t.last_name,
    COUNT(DISTINCT l.id) AS lease_count,
    COALESCE(SUM(l.rent_amount), 0) AS total_monthly_rent,
    COALESCE((
      SELECT SUM(inv.amount - inv.amount_paid)
      FROM invoices inv
      WHERE inv.tenant_id = t.id AND inv.org_id = p_org_id
        AND inv.direction = 'receivable'
        AND inv.status IN ('open', 'partially_paid')
    ), 0) AS balance_due,
    COALESCE((
      SELECT SUM(cr.amount - cr.amount_used)
      FROM credits cr
      WHERE cr.tenant_id = t.id AND cr.org_id = p_org_id
        AND cr.status = 'active'
    ), 0) AS credit_balance,
    COALESCE((
      SELECT SUM(inv.amount - inv.amount_paid)
      FROM invoices inv
      WHERE inv.tenant_id = t.id AND inv.org_id = p_org_id
        AND inv.direction = 'receivable'
        AND inv.status IN ('open', 'partially_paid')
    ), 0) - COALESCE((
      SELECT SUM(cr.amount - cr.amount_used)
      FROM credits cr
      WHERE cr.tenant_id = t.id AND cr.org_id = p_org_id
        AND cr.status = 'active'
    ), 0) AS net_due
  FROM tenants t
  JOIN lease_tenants lt ON lt.tenant_id = t.id
  JOIN leases l ON l.id = lt.lease_id AND l.org_id = p_org_id
  JOIN units u ON u.id = l.unit_id
  WHERE t.org_id = p_org_id
    AND (
      (p_lease_status = 'active' AND l.status IN ('active', 'month_to_month'))
      OR (p_lease_status = 'inactive' AND l.status IN ('expired', 'terminated'))
    )
    AND (p_property_id IS NULL OR u.property_id = p_property_id)
  GROUP BY t.id, t.first_name, t.last_name
  ORDER BY t.last_name, t.first_name;
$$;
```

- [ ] **Step 4: Verify migration file is syntactically valid**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && cat supabase/migrations/20260327000001_statement_rpcs.sql | head -5`
Expected: First lines of the migration file visible.

- [ ] **Step 5: Commit migration**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal
git add supabase/migrations/20260327000001_statement_rpcs.sql
git commit -m "feat(db): add statement and rent roll RPC functions"
```

---

### Task 2: Add TypeScript Types

**Files:**
- Modify: `packages/types/src/models.ts` (append after existing financial types, ~line 468)

- [ ] **Step 1: Add the three statement interfaces to models.ts**

Append after the last existing interface (around line 468):

```typescript
// ── Statements & Rent Roll ──────────────────────────────────

export interface TenantStatementRow {
  txn_date: string;
  sort_key: number;
  txn_type: 'charge' | 'late_fee' | 'payment' | 'credit' | 'credit_applied';
  description: string;
  reference: string;
  charge_amount: number;
  payment_amount: number;
  running_balance: number;
}

export interface PropertyStatementRow {
  txn_date: string;
  sort_key: number;
  txn_type: 'rent_charge' | 'rent_payment' | 'credit_issued' | 'credit_applied' | 'expense_bill' | 'expense_payment' | 'income' | 'expense';
  tenant_or_vendor: string | null;
  description: string;
  income_amount: number;
  expense_amount: number;
  running_balance: number;
}

export interface RentRollRow {
  tenant_id: string;
  first_name: string;
  last_name: string;
  lease_count: number;
  total_monthly_rent: number;
  balance_due: number;
  credit_balance: number;
  net_due: number;
}
```

These are already re-exported via `packages/types/src/index.ts` which does `export * from './models'`.

- [ ] **Step 2: Commit types**

```bash
git add packages/types/src/models.ts
git commit -m "feat(types): add statement and rent roll row interfaces"
```

---

### Task 3: Create Query Wrappers

**Files:**
- Create: `packages/database/src/queries/statements.ts`
- Modify: `packages/database/src/index.ts` (add re-export)

- [ ] **Step 1: Create the statements query wrapper file**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantStatementRow, PropertyStatementRow, RentRollRow } from '@onereal/types';

type Client = SupabaseClient;

interface DateRange {
  from: string;
  to: string;
}

function dateParams(dateRange?: DateRange): { p_from: string | null; p_to: string | null } {
  return {
    p_from: dateRange?.from ?? null,
    p_to: dateRange?.to ?? null,
  };
}

export async function getTenantStatement(
  client: Client,
  orgId: string,
  tenantId: string,
  propertyId: string,
  dateRange?: DateRange,
): Promise<TenantStatementRow[]> {
  const { data, error } = await (client as any).rpc('get_tenant_statement', {
    p_org_id: orgId,
    p_tenant_id: tenantId,
    p_property_id: propertyId,
    ...dateParams(dateRange),
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    txn_date: row.txn_date,
    sort_key: Number(row.sort_key),
    txn_type: row.txn_type,
    description: row.description ?? '',
    reference: row.reference ?? '',
    charge_amount: Number(row.charge_amount) || 0,
    payment_amount: Number(row.payment_amount) || 0,
    running_balance: Number(row.running_balance) || 0,
  }));
}

export async function getPropertyStatement(
  client: Client,
  orgId: string,
  propertyId: string,
  dateRange?: DateRange,
): Promise<PropertyStatementRow[]> {
  const { data, error } = await (client as any).rpc('get_property_statement', {
    p_org_id: orgId,
    p_property_id: propertyId,
    ...dateParams(dateRange),
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    txn_date: row.txn_date,
    sort_key: Number(row.sort_key),
    txn_type: row.txn_type,
    tenant_or_vendor: row.tenant_or_vendor ?? null,
    description: row.description ?? '',
    income_amount: Number(row.income_amount) || 0,
    expense_amount: Number(row.expense_amount) || 0,
    running_balance: Number(row.running_balance) || 0,
  }));
}

export async function getRentRoll(
  client: Client,
  orgId: string,
  leaseStatus: string = 'active',
  propertyId?: string,
): Promise<RentRollRow[]> {
  const params: Record<string, any> = {
    p_org_id: orgId,
    p_lease_status: leaseStatus,
  };
  if (propertyId) params.p_property_id = propertyId;

  const { data, error } = await (client as any).rpc('get_rent_roll', params);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    tenant_id: row.tenant_id,
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    lease_count: Number(row.lease_count) || 0,
    total_monthly_rent: Number(row.total_monthly_rent) || 0,
    balance_due: Number(row.balance_due) || 0,
    credit_balance: Number(row.credit_balance) || 0,
    net_due: Number(row.net_due) || 0,
  }));
}
```

- [ ] **Step 2: Add re-export to packages/database/src/index.ts**

Add this line after the existing `export * from './queries/financial';` line:

```typescript
export * from './queries/statements';
```

- [ ] **Step 3: Verify build**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/database build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit query wrappers**

```bash
git add packages/database/src/queries/statements.ts packages/database/src/index.ts
git commit -m "feat(database): add statement and rent roll query wrappers"
```

---

### Task 4: Create React Query Hooks

**Files:**
- Create: `modules/accounting/src/hooks/use-statements.ts`
- Modify: `modules/accounting/src/index.ts` (add re-exports)

- [ ] **Step 1: Create the hooks file**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getTenantStatement, getPropertyStatement, getRentRoll } from '@onereal/database';

interface DateRange {
  from: string;
  to: string;
}

export function useTenantStatement(
  orgId: string | null,
  tenantId: string | null,
  propertyId: string | null,
  dateRange?: DateRange,
) {
  return useQuery({
    queryKey: ['tenant-statement', orgId, tenantId, propertyId, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const supabase = createClient();
      return getTenantStatement(supabase as any, orgId!, tenantId!, propertyId!, dateRange);
    },
    enabled: !!orgId && !!tenantId && !!propertyId,
  });
}

export function usePropertyStatement(
  orgId: string | null,
  propertyId: string | null,
  dateRange?: DateRange,
) {
  return useQuery({
    queryKey: ['property-statement', orgId, propertyId, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const supabase = createClient();
      return getPropertyStatement(supabase as any, orgId!, propertyId!, dateRange);
    },
    enabled: !!orgId && !!propertyId,
  });
}

export function useRentRoll(
  orgId: string | null,
  leaseStatus: string = 'active',
  propertyId?: string,
) {
  return useQuery({
    queryKey: ['rent-roll', orgId, leaseStatus, propertyId],
    queryFn: () => {
      const supabase = createClient();
      return getRentRoll(supabase as any, orgId!, leaseStatus, propertyId);
    },
    enabled: !!orgId,
  });
}
```

- [ ] **Step 2: Add re-exports to modules/accounting/src/index.ts**

Add these lines after the existing hook exports:

```typescript
export { useTenantStatement, usePropertyStatement, useRentRoll } from './hooks/use-statements';
```

- [ ] **Step 3: Verify build**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/accounting build`
Expected: Build succeeds.

- [ ] **Step 4: Commit hooks**

```bash
git add modules/accounting/src/hooks/use-statements.ts modules/accounting/src/index.ts
git commit -m "feat(accounting): add statement and rent roll React Query hooks"
```

---

## Chunk 2: UI Components

### Task 5: Create Tenant Statement Table

**Files:**
- Create: `apps/web/components/reports/tenant-statement-table.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@onereal/ui';
import type { TenantStatementRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const typeBadge: Record<string, { label: string; className: string }> = {
  charge: { label: 'Charge', className: 'bg-yellow-100 text-yellow-800' },
  late_fee: { label: 'Late Fee', className: 'bg-red-100 text-red-800' },
  payment: { label: 'Payment', className: 'bg-green-100 text-green-800' },
  credit: { label: 'Credit', className: 'bg-blue-100 text-blue-800' },
  credit_applied: { label: 'Credit Applied', className: 'bg-purple-100 text-purple-800' },
};

export function TenantStatementTable({ data }: { data: TenantStatementRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No transactions found for this period.
      </div>
    );
  }

  const totalCharges = data.reduce((sum, r) => sum + r.charge_amount, 0);
  const totalPayments = data.reduce((sum, r) => sum + r.payment_amount, 0);
  const endingBalance = data[data.length - 1].running_balance;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Charges</TableHead>
          <TableHead className="text-right">Payments/Credits</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const badge = typeBadge[row.txn_type] ?? { label: row.txn_type, className: '' };
          return (
            <TableRow key={`${row.txn_date}-${row.sort_key}-${i}`}>
              <TableCell className="whitespace-nowrap">{formatDate(row.txn_date)}</TableCell>
              <TableCell><Badge className={badge.className}>{badge.label}</Badge></TableCell>
              <TableCell className="max-w-[200px] truncate">{row.description}</TableCell>
              <TableCell>{row.reference}</TableCell>
              <TableCell className="text-right">{row.charge_amount > 0 ? formatCurrency(row.charge_amount) : '—'}</TableCell>
              <TableCell className="text-right">{row.payment_amount > 0 ? formatCurrency(row.payment_amount) : '—'}</TableCell>
              <TableCell className="text-right">{formatCurrency(row.running_balance)}</TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-t-2 font-bold">
          <TableCell colSpan={4} className="font-bold">Totals</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCharges)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalPayments)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(endingBalance)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/reports/tenant-statement-table.tsx
git commit -m "feat(ui): add tenant statement table component"
```

---

### Task 6: Create Property Statement Table

**Files:**
- Create: `apps/web/components/reports/property-statement-table.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@onereal/ui';
import type { PropertyStatementRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const typeBadge: Record<string, { label: string; className: string }> = {
  rent_charge: { label: 'Rent Charge', className: 'bg-green-100 text-green-800' },
  rent_payment: { label: 'Rent Payment', className: 'bg-emerald-100 text-emerald-800' },
  credit_issued: { label: 'Credit Issued', className: 'bg-blue-100 text-blue-800' },
  credit_applied: { label: 'Credit Applied', className: 'bg-purple-100 text-purple-800' },
  expense_bill: { label: 'Expense Bill', className: 'bg-red-100 text-red-800' },
  expense_payment: { label: 'Expense Payment', className: 'bg-orange-100 text-orange-800' },
  income: { label: 'Income', className: 'bg-gray-100 text-gray-800' },
  expense: { label: 'Expense', className: 'bg-gray-100 text-gray-800' },
};

export function PropertyStatementTable({ data }: { data: PropertyStatementRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No transactions found for this period.
      </div>
    );
  }

  const totalIncome = data.reduce((sum, r) => sum + r.income_amount, 0);
  const totalExpenses = data.reduce((sum, r) => sum + r.expense_amount, 0);
  const net = totalIncome - totalExpenses;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Tenant/Vendor</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expense</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const badge = typeBadge[row.txn_type] ?? { label: row.txn_type, className: '' };
          return (
            <TableRow key={`${row.txn_date}-${row.sort_key}-${i}`}>
              <TableCell className="whitespace-nowrap">{formatDate(row.txn_date)}</TableCell>
              <TableCell><Badge className={badge.className}>{badge.label}</Badge></TableCell>
              <TableCell>{row.tenant_or_vendor ?? '—'}</TableCell>
              <TableCell className="max-w-[200px] truncate">{row.description}</TableCell>
              <TableCell className="text-right">{row.income_amount > 0 ? formatCurrency(row.income_amount) : '—'}</TableCell>
              <TableCell className="text-right">{row.expense_amount > 0 ? formatCurrency(row.expense_amount) : '—'}</TableCell>
              <TableCell className="text-right">{formatCurrency(row.running_balance)}</TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-t-2 font-bold">
          <TableCell colSpan={4} className="font-bold">Totals</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalIncome)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalExpenses)}</TableCell>
          <TableCell className={`text-right font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(net)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/reports/property-statement-table.tsx
git commit -m "feat(ui): add property statement table component"
```

---

### Task 7: Create Rent Roll Table

**Files:**
- Create: `apps/web/components/reports/rent-roll-table.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@onereal/ui';
import type { RentRollRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function netDueColor(n: number): string {
  if (n > 0) return 'text-red-600';
  if (n < 0) return 'text-green-600';
  return '';
}

export function RentRollTable({ data, leaseStatus = 'active' }: { data: RentRollRow[]; leaseStatus?: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No {leaseStatus === 'active' ? 'active' : 'inactive'} leases found.
      </div>
    );
  }

  const totalLeases = data.reduce((sum, r) => sum + r.lease_count, 0);
  const totalRent = data.reduce((sum, r) => sum + r.total_monthly_rent, 0);
  const totalBalance = data.reduce((sum, r) => sum + r.balance_due, 0);
  const totalCredit = data.reduce((sum, r) => sum + r.credit_balance, 0);
  const totalNet = data.reduce((sum, r) => sum + r.net_due, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant</TableHead>
          <TableHead className="text-right">Leases</TableHead>
          <TableHead className="text-right">Monthly Rent</TableHead>
          <TableHead className="text-right">Balance Due</TableHead>
          <TableHead className="text-right">Credit Balance</TableHead>
          <TableHead className="text-right">Net Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.tenant_id}>
            <TableCell>{row.last_name}, {row.first_name}</TableCell>
            <TableCell className="text-right">{row.lease_count}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.total_monthly_rent)}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.balance_due)}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.credit_balance)}</TableCell>
            <TableCell className={`text-right ${netDueColor(row.net_due)}`}>{formatCurrency(row.net_due)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 font-bold">
          <TableCell className="font-bold">Total</TableCell>
          <TableCell className="text-right font-bold">{totalLeases}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalRent)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalBalance)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCredit)}</TableCell>
          <TableCell className={`text-right font-bold ${netDueColor(totalNet)}`}>{formatCurrency(totalNet)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/reports/rent-roll-table.tsx
git commit -m "feat(ui): add rent roll table component"
```

---

## Chunk 3: Page, Navigation & CSV Export

### Task 8: Create Statements Page

**Files:**
- Create: `apps/web/app/(dashboard)/reports/statements/page.tsx`

**Reference patterns:**
- Reports page at `apps/web/app/(dashboard)/reports/page.tsx` (tabs, date range, CSV export)
- `useTenants` from `@onereal/contacts` (loads tenants with lease/property data)
- `useProperties` from `@onereal/portfolio`
- `DateRangeFilterClient` from `@/components/accounting/date-range-filter-client`
- `downloadCsv` from `@/lib/csv-export`

- [ ] **Step 1: Create the statements page file**

```typescript
'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useTenantStatement, usePropertyStatement, useRentRoll } from '@onereal/accounting';
import { useTenants } from '@onereal/contacts';
import { useProperties } from '@onereal/portfolio';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
  Card, CardContent, CardHeader, CardTitle,
  Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { Download } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DateRangeFilterClient, type DateRangeValue } from '@/components/accounting/date-range-filter-client';
import { downloadCsv } from '@/lib/csv-export';

const TenantStatementTable = dynamic(
  () => import('@/components/reports/tenant-statement-table').then((m) => ({ default: m.TenantStatementTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const PropertyStatementTable = dynamic(
  () => import('@/components/reports/property-statement-table').then((m) => ({ default: m.PropertyStatementTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const RentRollTable = dynamic(
  () => import('@/components/reports/rent-roll-table').then((m) => ({ default: m.RentRollTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);

export default function StatementsPage() {
  const { activeOrg } = useUser();
  const orgId = activeOrg?.id ?? null;

  // ── Tenant Statement state ──
  const [tenantId, setTenantId] = useState('');
  const [tenantPropertyId, setTenantPropertyId] = useState('');
  const [tenantDateRange, setTenantDateRange] = useState<DateRangeValue>({});

  // ── Property Statement state ──
  const [propertyId, setPropertyId] = useState('');
  const [propertyDateRange, setPropertyDateRange] = useState<DateRangeValue>({});

  // ── Rent Roll state ──
  const [leaseStatus, setLeaseStatus] = useState('active');
  const [rentRollPropertyId, setRentRollPropertyId] = useState('');

  // ── Data fetching ──
  const { data: tenants } = useTenants({ orgId });
  const { data: allProperties } = useProperties({ orgId });

  const tenantDateRangeEffective = tenantDateRange.from && tenantDateRange.to
    ? { from: tenantDateRange.from, to: tenantDateRange.to }
    : undefined;
  const propertyDateRangeEffective = propertyDateRange.from && propertyDateRange.to
    ? { from: propertyDateRange.from, to: propertyDateRange.to }
    : undefined;

  const { data: tenantStatementData, isLoading: tsLoading } = useTenantStatement(
    orgId, tenantId || null, tenantPropertyId || null, tenantDateRangeEffective,
  );
  const { data: propertyStatementData, isLoading: psLoading } = usePropertyStatement(
    orgId, propertyId || null, propertyDateRangeEffective,
  );
  const { data: rentRollData, isLoading: rrLoading } = useRentRoll(
    orgId, leaseStatus, rentRollPropertyId || undefined,
  );

  // ── Tenant's properties (derived from tenant data) ──
  const tenantProperties = useMemo(() => {
    if (!tenantId || !tenants) return [];
    const tenant = tenants.find((t: any) => t.id === tenantId);
    if (!tenant?.lease_tenants) return [];
    const props = new Map<string, string>();
    for (const lt of tenant.lease_tenants) {
      const prop = lt.leases?.units?.properties;
      if (prop) props.set(prop.id, prop.name);
    }
    return Array.from(props, ([id, name]) => ({ id, name }));
  }, [tenantId, tenants]);

  // Reset property when tenant changes
  function handleTenantChange(id: string) {
    setTenantId(id);
    setTenantPropertyId('');
  }

  // ── CSV exports ──
  function exportTenantStatement() {
    if (!tenantStatementData) return;
    const headers = ['Date', 'Type', 'Description', 'Reference', 'Charges', 'Payments/Credits', 'Balance'];
    const rows = tenantStatementData.map((r) => [
      r.txn_date, r.txn_type, r.description, r.reference,
      r.charge_amount.toFixed(2), r.payment_amount.toFixed(2), r.running_balance.toFixed(2),
    ]);
    downloadCsv('tenant-statement.csv', headers, rows);
  }

  function exportPropertyStatement() {
    if (!propertyStatementData) return;
    const headers = ['Date', 'Type', 'Tenant/Vendor', 'Description', 'Income', 'Expense', 'Balance'];
    const rows = propertyStatementData.map((r) => [
      r.txn_date, r.txn_type, r.tenant_or_vendor ?? '', r.description,
      r.income_amount.toFixed(2), r.expense_amount.toFixed(2), r.running_balance.toFixed(2),
    ]);
    downloadCsv('property-statement.csv', headers, rows);
  }

  function exportRentRoll() {
    if (!rentRollData) return;
    const headers = ['Tenant', 'Leases', 'Monthly Rent', 'Balance Due', 'Credit Balance', 'Net Due'];
    const rows = rentRollData.map((r) => [
      `${r.last_name}, ${r.first_name}`, String(r.lease_count),
      r.total_monthly_rent.toFixed(2), r.balance_due.toFixed(2),
      r.credit_balance.toFixed(2), r.net_due.toFixed(2),
    ]);
    downloadCsv('rent-roll.csv', headers, rows);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Statements</h1>

      <Tabs defaultValue="tenant">
        <TabsList>
          <TabsTrigger value="tenant">Tenant Statement</TabsTrigger>
          <TabsTrigger value="property">Property Statement</TabsTrigger>
          <TabsTrigger value="rent-roll">Rent Roll</TabsTrigger>
        </TabsList>

        {/* ── Tenant Statement ── */}
        <TabsContent value="tenant" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Tenant Statement</CardTitle>
              <Button variant="outline" size="sm" onClick={exportTenantStatement} disabled={!tenantStatementData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={tenantId} onValueChange={handleTenantChange}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Tenant" /></SelectTrigger>
                  <SelectContent>
                    {(tenants ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.last_name}, {t.first_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={tenantPropertyId} onValueChange={setTenantPropertyId} disabled={!tenantId}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Property" /></SelectTrigger>
                  <SelectContent>
                    {tenantProperties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangeFilterClient onChange={setTenantDateRange} />
              </div>
              {tsLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : tenantStatementData ? (
                <TenantStatementTable data={tenantStatementData} />
              ) : tenantId && tenantPropertyId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Select a tenant and property to view statement.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Property Statement ── */}
        <TabsContent value="property" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Property Statement</CardTitle>
              <Button variant="outline" size="sm" onClick={exportPropertyStatement} disabled={!propertyStatementData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Property" /></SelectTrigger>
                  <SelectContent>
                    {(allProperties ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangeFilterClient onChange={setPropertyDateRange} />
              </div>
              {psLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : propertyStatementData ? (
                <PropertyStatementTable data={propertyStatementData} />
              ) : propertyId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Select a property to view statement.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Rent Roll ── */}
        <TabsContent value="rent-roll" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Rent Roll</CardTitle>
              <Button variant="outline" size="sm" onClick={exportRentRoll} disabled={!rentRollData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={leaseStatus} onValueChange={setLeaseStatus}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={rentRollPropertyId || 'all'} onValueChange={(v) => setRentRollPropertyId(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    {(allProperties ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rrLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : rentRollData ? (
                <RentRollTable data={rentRollData} leaseStatus={leaseStatus} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit page**

```bash
git add apps/web/app/\(dashboard\)/reports/statements/page.tsx
git commit -m "feat(ui): add Statements page with 3 report tabs"
```

---

### Task 9: Update Sidebar Navigation

**Files:**
- Modify: `apps/web/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Update the Reports nav item to include children**

Find this line in the `navItems` array (around line 46):

```typescript
  { label: 'Reports', href: '/reports', icon: BarChart3 },
```

Replace it with:

```typescript
  {
    label: 'Reports', href: '/reports', icon: BarChart3,
    children: [
      { label: 'Financial Reports', href: '/reports' },
      { label: 'Statements', href: '/reports/statements' },
    ],
  },
```

- [ ] **Step 2: Commit sidebar change**

```bash
git add apps/web/components/dashboard/sidebar.tsx
git commit -m "feat(nav): add Reports submenu with Financial Reports and Statements"
```

---

### Task 10: Push Migration & Verify End-to-End

- [ ] **Step 1: Build the full app to check for type/import errors**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm build`
Expected: Build succeeds with no errors. If there are type errors, fix them.

- [ ] **Step 2: Push migration to Supabase**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && npx supabase db push --linked`
Expected: Migration applied successfully.

- [ ] **Step 3: Start dev server and manually verify**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal/apps/web && pnpm dev`

Verify:
1. Navigate to `/reports/statements` — page loads with 3 tabs
2. Sidebar shows Reports with submenu (Financial Reports + Statements)
3. Tenant Statement: select tenant → select property → table loads
4. Property Statement: select property → table loads
5. Rent Roll: shows active leases by default, toggle to inactive works
6. CSV export downloads file for each tab

- [ ] **Step 4: Push all changes to remote**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal
git push origin main
```

# Phase 4A: Invoice System & Accounting Restructure — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified invoice system (receivable + payable) with partial payments that auto-create income/expense records, and restructure the Accounting sidebar into Financial Overview / Incoming / Outgoing sub-pages.

**Architecture:** New `modules/billing/` module with schemas, server actions, and React Query hooks. Two new database tables (`invoices`, `payments`) with RLS. Two new pages (`/accounting/incoming`, `/accounting/outgoing`) replace the old standalone income/expenses pages. Sidebar gets collapsible Accounting menu.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL + RLS), React Hook Form + Zod, TanStack Query, Radix UI, Turborepo monorepo with pnpm.

**Spec:** `docs/superpowers/specs/2026-03-15-phase4a-invoice-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260315000008_billing_tables.sql` | invoices + payments tables, RLS, indexes, invoice number function, moddatetime trigger |
| `packages/types/src/models.ts` (modify) | Add `Invoice` and `Payment` interfaces |
| `modules/billing/package.json` | Module package config |
| `modules/billing/tsconfig.json` | TypeScript config |
| `modules/billing/src/index.ts` | Barrel exports (schemas + hooks) |
| `modules/billing/src/schemas/invoice-schema.ts` | Zod schema for invoice create/edit |
| `modules/billing/src/schemas/payment-schema.ts` | Zod schema for recording payments |
| `modules/billing/src/actions/create-invoice.ts` | Create a single manual invoice |
| `modules/billing/src/actions/generate-invoices.ts` | Batch-generate invoices for a month |
| `modules/billing/src/actions/update-invoice.ts` | Edit invoice details |
| `modules/billing/src/actions/void-invoice.ts` | Mark invoice as void |
| `modules/billing/src/actions/record-payment.ts` | Record payment, update invoice, auto-create income/expense |
| `modules/billing/src/hooks/use-invoices.ts` | Fetch invoices with filters + computed displayStatus |
| `modules/billing/src/hooks/use-payments.ts` | Fetch payments for an invoice |
| `modules/billing/src/hooks/use-invoice-generation-preview.ts` | Preview count for generation dialog |
| `apps/web/components/billing/invoice-dialog.tsx` | Create/edit invoice dialog |
| `apps/web/components/billing/payment-dialog.tsx` | Record payment dialog |
| `apps/web/components/billing/generate-invoices-dialog.tsx` | Batch generation dialog |
| `apps/web/components/billing/invoice-table.tsx` | Reusable invoice table with status badges + actions |
| `apps/web/app/(dashboard)/accounting/incoming/page.tsx` | Incoming invoices page (tabs: Open, Paid, All) |
| `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` | Outgoing page (tabs: Open Bills, Paid Bills, Expenses) |

### Modified Files

| File | Change |
|------|--------|
| `packages/types/src/models.ts` | Add Invoice + Payment interfaces |
| `apps/web/components/dashboard/sidebar.tsx` | Accounting becomes collapsible with 3 children |
| `apps/web/app/(dashboard)/accounting/page.tsx` | Update link buttons to `/accounting/incoming` and `/accounting/outgoing` |

### Removed Files

| File | Reason |
|------|--------|
| `apps/web/app/(dashboard)/accounting/income/page.tsx` | Replaced by Incoming page |
| `apps/web/app/(dashboard)/accounting/expenses/page.tsx` | Replaced by Outgoing page Expenses tab |

---

## Chunk 1: Database, Types, and Module Scaffold

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260315000008_billing_tables.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- Migration 008: Billing tables (invoices + payments)
-- Phase 4A: Invoice System & Accounting Restructure
-- ============================================================

-- Depends on: organizations, properties, units, leases, tenants, service_providers (Migrations 001-007)
-- Depends on: income, expenses tables (Migration 006)
-- Uses: get_user_org_ids(), get_user_managed_org_ids() (Migration 005)
-- Uses: extensions.moddatetime() (Migration 004)

-- ============================================================
-- Invoice number sequence function
-- Per-org, per-year, auto-incrementing: INV-2026-0001
-- Uses FOR UPDATE to prevent race conditions
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  max_seq INTEGER;
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(invoice_number FROM 'INV-' || current_year || '-(\d+)$')
        AS INTEGER
      )
    ),
    0
  )
  INTO max_seq
  FROM public.invoices
  WHERE org_id = p_org_id
    AND invoice_number LIKE 'INV-' || current_year || '-%'
  FOR UPDATE;

  next_seq := max_seq + 1;
  RETURN 'INV-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- Invoices table
-- ============================================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'partially_paid', 'paid', 'void')),
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique invoice number per org
CREATE UNIQUE INDEX idx_invoices_org_number ON public.invoices(org_id, invoice_number);

-- Filtered listing (direction + status)
CREATE INDEX idx_invoices_org_direction_status ON public.invoices(org_id, direction, status);

-- Idempotent generation check (lease + due_date month)
CREATE INDEX idx_invoices_lease_due ON public.invoices(lease_id, due_date);

-- moddatetime trigger for updated_at
CREATE TRIGGER handle_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Payments table
-- ============================================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'online', 'other')),
  reference_number TEXT,
  notes TEXT,
  income_id UUID REFERENCES public.income(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_org ON public.payments(org_id);

-- ============================================================
-- RLS Policies — Invoices
-- ============================================================
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices in their orgs"
  ON public.invoices FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update invoices"
  ON public.invoices FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete invoices"
  ON public.invoices FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RLS Policies — Payments
-- ============================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payments in their orgs"
  ON public.payments FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert payments"
  ON public.payments FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update payments"
  ON public.payments FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete payments"
  ON public.payments FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));
```

- [ ] **Step 2: Apply the migration**

Run: `cd apps/web && npx supabase db push`
Expected: Migration applies successfully, tables created.

- [ ] **Step 3: Verify tables exist**

Run: `cd apps/web && npx supabase db reset --dry-run` or check Supabase dashboard.
Expected: `invoices` and `payments` tables visible with correct columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260315000008_billing_tables.sql
git commit -m "feat(billing): add invoices and payments tables with RLS"
```

---

### Task 2: TypeScript Interfaces

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add Invoice and Payment interfaces**

Append after the existing `LeaseDocument` interface (around line 133):

```typescript
export interface Invoice {
  id: string;
  org_id: string;
  invoice_number: string;
  direction: 'receivable' | 'payable';
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'void';
  lease_id: string | null;
  tenant_id: string | null;
  provider_id: string | null;
  property_id: string;
  unit_id: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  issued_date: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  org_id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'online' | 'other';
  reference_number: string | null;
  notes: string | null;
  income_id: string | null;
  expense_id: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/types && pnpm type-check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat(types): add Invoice and Payment interfaces"
```

---

### Task 3: Billing Module Scaffold

**Files:**
- Create: `modules/billing/package.json`
- Create: `modules/billing/tsconfig.json`
- Create: `modules/billing/src/index.ts`
- Create: `modules/billing/src/schemas/invoice-schema.ts`
- Create: `modules/billing/src/schemas/payment-schema.ts`

- [ ] **Step 1: Create package.json**

Create `modules/billing/package.json`:

```json
{
  "name": "@onereal/billing",
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

- [ ] **Step 2: Create tsconfig.json**

Create `modules/billing/tsconfig.json`:

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

- [ ] **Step 3: Create invoice-schema.ts**

Create `modules/billing/src/schemas/invoice-schema.ts`:

```typescript
import { z } from 'zod';

export const invoiceSchema = z.object({
  direction: z.enum(['receivable', 'payable']),
  tenant_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  due_date: z.string().min(1, 'Due date is required'),
  issued_date: z.string().optional(),
});

export type InvoiceFormValues = z.infer<typeof invoiceSchema>;
```

- [ ] **Step 4: Create payment-schema.ts**

Create `modules/billing/src/schemas/payment-schema.ts`:

```typescript
import { z } from 'zod';

export const paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be positive'),
  payment_date: z.string().min(1, 'Payment date is required'),
  payment_method: z.enum(['cash', 'check', 'bank_transfer', 'online', 'other']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type PaymentFormValues = z.infer<typeof paymentSchema>;
```

- [ ] **Step 5: Create barrel index.ts (schemas only for now, hooks added later)**

Create `modules/billing/src/index.ts`:

```typescript
// Schemas (pure types + zod — safe for both client and server)
export { invoiceSchema, type InvoiceFormValues } from './schemas/invoice-schema';
export { paymentSchema, type PaymentFormValues } from './schemas/payment-schema';

// Hooks (client-only) — added as they are implemented
// export { useInvoices } from './hooks/use-invoices';
// export { usePayments } from './hooks/use-payments';
// export { useInvoiceGenerationPreview } from './hooks/use-invoice-generation-preview';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createInvoice } from '@onereal/billing/actions/create-invoice';
```

- [ ] **Step 6: Install dependencies**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm install`
Expected: `@onereal/billing` workspace package resolves, no errors.

- [ ] **Step 7: Commit**

```bash
git add modules/billing/
git commit -m "feat(billing): scaffold billing module with schemas"
```

---

## Chunk 2: Server Actions and Hooks

### Task 4: Create Invoice Action

**Files:**
- Create: `modules/billing/src/actions/create-invoice.ts`

- [ ] **Step 1: Write the create-invoice action**

Create `modules/billing/src/actions/create-invoice.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { invoiceSchema, type InvoiceFormValues } from '../schemas/invoice-schema';

export async function createInvoice(
  orgId: string,
  values: InvoiceFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get next invoice number
    const { data: seqData, error: seqError } = await db.rpc('next_invoice_number', {
      p_org_id: orgId,
    });
    if (seqError) return { success: false, error: seqError.message };

    const { data, error } = await db
      .from('invoices')
      .insert({
        ...parsed.data,
        org_id: orgId,
        invoice_number: seqData,
        unit_id: parsed.data.unit_id || null,
        tenant_id: parsed.data.tenant_id || null,
        provider_id: parsed.data.provider_id || null,
        issued_date: parsed.data.issued_date || new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create invoice' };
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd modules/billing && pnpm type-check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add modules/billing/src/actions/create-invoice.ts
git commit -m "feat(billing): add create-invoice server action"
```

---

### Task 5: Generate Invoices Action

**Files:**
- Create: `modules/billing/src/actions/generate-invoices.ts`

- [ ] **Step 1: Write the generate-invoices action**

Create `modules/billing/src/actions/generate-invoices.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface GenerateResult {
  created: number;
  skipped: number;
}

export async function generateInvoices(
  orgId: string,
  month: number, // 1-12
  year: number
): Promise<ActionResult<GenerateResult>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // 1. Fetch active leases with unit → property join
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, units(property_id)')
      .eq('org_id', orgId)
      .eq('status', 'active');

    if (leaseError) return { success: false, error: leaseError.message };
    if (!leases || leases.length === 0) {
      return { success: true, data: { created: 0, skipped: 0 } };
    }

    // 2. Check which leases already have invoices for this month
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0]; // last day

    const leaseIds = leases.map((l: any) => l.id);
    const { data: existing, error: existError } = await db
      .from('invoices')
      .select('lease_id')
      .in('lease_id', leaseIds)
      .gte('due_date', startOfMonth)
      .lte('due_date', endOfMonth);

    if (existError) return { success: false, error: existError.message };

    const existingLeaseIds = new Set((existing ?? []).map((e: any) => e.lease_id));

    // 3. Generate invoices for qualifying leases
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = monthNames[month - 1];

    let created = 0;
    let skipped = 0;

    for (const lease of leases) {
      if (existingLeaseIds.has(lease.id)) {
        skipped++;
        continue;
      }

      const dueDay = lease.payment_due_day ?? 1;
      const maxDay = new Date(year, month, 0).getDate();
      const safeDay = Math.min(dueDay, maxDay);
      const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
      const propertyId = lease.units?.property_id;

      if (!propertyId || !lease.rent_amount) {
        skipped++;
        continue;
      }

      // Get next invoice number
      const { data: invoiceNumber, error: seqError } = await db.rpc('next_invoice_number', {
        p_org_id: orgId,
      });
      if (seqError) {
        skipped++;
        continue;
      }

      const { error: insertError } = await db.from('invoices').insert({
        org_id: orgId,
        invoice_number: invoiceNumber,
        direction: 'receivable',
        status: 'open',
        lease_id: lease.id,
        tenant_id: lease.tenant_id,
        property_id: propertyId,
        unit_id: lease.unit_id,
        amount: lease.rent_amount,
        due_date: dueDate,
        description: `Rent - ${monthName} ${year}`,
      });

      if (insertError) {
        skipped++;
      } else {
        created++;
      }
    }

    return { success: true, data: { created, skipped } };
  } catch {
    return { success: false, error: 'Failed to generate invoices' };
  }
}

export async function getGenerationPreview(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number; existing: number }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active');

    if (leaseError) return { success: false, error: leaseError.message };

    const total = leases?.length ?? 0;
    if (total === 0) return { success: true, data: { eligible: 0, existing: 0 } };

    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

    const leaseIds = leases.map((l: any) => l.id);
    const { data: existing } = await db
      .from('invoices')
      .select('lease_id')
      .in('lease_id', leaseIds)
      .gte('due_date', startOfMonth)
      .lte('due_date', endOfMonth);

    const existingCount = existing?.length ?? 0;

    return { success: true, data: { eligible: total - existingCount, existing: existingCount } };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/generate-invoices.ts
git commit -m "feat(billing): add generate-invoices and preview actions"
```

---

### Task 6: Update Invoice and Void Invoice Actions

**Files:**
- Create: `modules/billing/src/actions/update-invoice.ts`
- Create: `modules/billing/src/actions/void-invoice.ts`

- [ ] **Step 1: Write update-invoice action**

Create `modules/billing/src/actions/update-invoice.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { invoiceSchema, type InvoiceFormValues } from '../schemas/invoice-schema';

export async function updateInvoice(
  id: string,
  values: InvoiceFormValues
): Promise<ActionResult> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check if amount is being reduced below amount_paid
    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (parsed.data.amount < Number(invoice.amount_paid)) {
      return { success: false, error: 'Cannot reduce amount below what has already been paid' };
    }

    // Exclude direction from update — cannot change after creation
    const { direction: _, ...updateData } = parsed.data;
    const { error } = await db
      .from('invoices')
      .update({
        ...updateData,
        unit_id: updateData.unit_id || null,
        tenant_id: updateData.tenant_id || null,
        provider_id: updateData.provider_id || null,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update invoice' };
  }
}
```

- [ ] **Step 2: Write void-invoice action**

Create `modules/billing/src/actions/void-invoice.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function voidInvoice(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check if invoice has payments
    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid, status')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (Number(invoice.amount_paid) > 0) {
      return { success: false, error: 'Cannot void an invoice that has payments' };
    }

    if (invoice.status === 'void') {
      return { success: false, error: 'Invoice is already void' };
    }

    const { error } = await db
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to void invoice' };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/billing/src/actions/update-invoice.ts modules/billing/src/actions/void-invoice.ts
git commit -m "feat(billing): add update-invoice and void-invoice actions"
```

---

### Task 7: Record Payment Action

**Files:**
- Create: `modules/billing/src/actions/record-payment.ts`

This is the most complex action — it creates a payment, updates the invoice, and auto-creates an income or expense record.

- [ ] **Step 1: Write the record-payment action**

Create `modules/billing/src/actions/record-payment.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { paymentSchema, type PaymentFormValues } from '../schemas/payment-schema';

export async function recordPayment(
  orgId: string,
  values: PaymentFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = paymentSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // 1. Fetch invoice
    const { data: invoice, error: invoiceError } = await db
      .from('invoices')
      .select('*')
      .eq('id', parsed.data.invoice_id)
      .single();

    if (invoiceError) return { success: false, error: invoiceError.message };

    // 2. Validate payment amount
    const remaining = Number(invoice.amount) - Number(invoice.amount_paid);
    if (parsed.data.amount > remaining) {
      return { success: false, error: `Payment exceeds remaining balance of $${remaining.toFixed(2)}` };
    }

    if (invoice.status === 'void' || invoice.status === 'paid') {
      return { success: false, error: `Cannot pay a ${invoice.status} invoice` };
    }

    // 3. Auto-create income or expense record
    let incomeId: string | null = null;
    let expenseId: string | null = null;

    if (invoice.direction === 'receivable') {
      // Map description to income_type
      const desc = (invoice.description || '').toLowerCase();
      let incomeType = 'other';
      if (desc.includes('rent')) incomeType = 'rent';
      else if (desc.includes('deposit')) incomeType = 'deposit';

      const { data: incomeRow, error: incomeError } = await db
        .from('income')
        .insert({
          org_id: orgId,
          property_id: invoice.property_id,
          unit_id: invoice.unit_id || null,
          amount: parsed.data.amount,
          income_type: incomeType,
          description: `Payment for ${invoice.invoice_number}`,
          transaction_date: parsed.data.payment_date,
        })
        .select('id')
        .single();

      if (incomeError) return { success: false, error: incomeError.message };
      incomeId = incomeRow.id;
    } else {
      // payable → create expense
      const { data: expenseRow, error: expenseError } = await db
        .from('expenses')
        .insert({
          org_id: orgId,
          property_id: invoice.property_id,
          unit_id: invoice.unit_id || null,
          amount: parsed.data.amount,
          expense_type: 'maintenance',
          description: `Payment for ${invoice.invoice_number}`,
          transaction_date: parsed.data.payment_date,
          provider_id: invoice.provider_id || null,
        })
        .select('id')
        .single();

      if (expenseError) return { success: false, error: expenseError.message };
      expenseId = expenseRow.id;
    }

    // 4. Create payment row
    const { data: payment, error: paymentError } = await db
      .from('payments')
      .insert({
        org_id: orgId,
        invoice_id: parsed.data.invoice_id,
        amount: parsed.data.amount,
        payment_date: parsed.data.payment_date,
        payment_method: parsed.data.payment_method,
        reference_number: parsed.data.reference_number || null,
        notes: parsed.data.notes || null,
        income_id: incomeId,
        expense_id: expenseId,
      })
      .select('id')
      .single();

    if (paymentError) return { success: false, error: paymentError.message };

    // 5. Update invoice amount_paid and status
    const newAmountPaid = Number(invoice.amount_paid) + parsed.data.amount;
    const newStatus = newAmountPaid >= Number(invoice.amount) ? 'paid' : 'partially_paid';

    const { error: updateError } = await db
      .from('invoices')
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
      })
      .eq('id', parsed.data.invoice_id);

    if (updateError) return { success: false, error: updateError.message };

    return { success: true, data: { id: payment.id } };
  } catch {
    return { success: false, error: 'Failed to record payment' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/record-payment.ts
git commit -m "feat(billing): add record-payment action with auto income/expense creation"
```

---

### Task 8: React Query Hooks

**Files:**
- Create: `modules/billing/src/hooks/use-invoices.ts`
- Create: `modules/billing/src/hooks/use-payments.ts`
- Create: `modules/billing/src/hooks/use-invoice-generation-preview.ts`
- Modify: `modules/billing/src/index.ts`

- [ ] **Step 1: Write use-invoices hook**

Create `modules/billing/src/hooks/use-invoices.ts`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface InvoiceFilters {
  orgId: string | null;
  direction?: 'receivable' | 'payable';
  status?: string; // 'open' | 'paid' | 'all' etc.
  propertyId?: string;
  tenantId?: string;
  providerId?: string;
  search?: string;
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('invoices')
        .select('*, tenants(first_name, last_name), service_providers(name, company_name), properties(name), units(unit_number)')
        .eq('org_id', filters.orgId)
        .order('due_date', { ascending: false });

      if (filters.direction) {
        query = query.eq('direction', filters.direction);
      }
      if (filters.status && filters.status !== 'all') {
        if (filters.status === 'open') {
          // "Open" tab shows both open and partially_paid invoices
          query = query.in('status', ['open', 'partially_paid']);
        } else {
          query = query.eq('status', filters.status);
        }
      }
      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.tenantId) {
        query = query.eq('tenant_id', filters.tenantId);
      }
      if (filters.providerId) {
        query = query.eq('provider_id', filters.providerId);
      }
      if (filters.search) {
        query = query.or(`description.ilike.%${filters.search}%,invoice_number.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Compute displayStatus: overdue if past due_date and still open/partially_paid
      const today = new Date().toISOString().split('T')[0];
      return (data ?? []).map((inv: any) => ({
        ...inv,
        displayStatus:
          (inv.status === 'open' || inv.status === 'partially_paid') && inv.due_date < today
            ? 'overdue'
            : inv.status,
      }));
    },
    enabled: !!filters.orgId,
  });
}
```

- [ ] **Step 2: Write use-payments hook**

Create `modules/billing/src/hooks/use-payments.ts`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function usePayments(invoiceId: string | null) {
  return useQuery({
    queryKey: ['payments', invoiceId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!invoiceId,
  });
}
```

- [ ] **Step 3: Write use-invoice-generation-preview hook**

Create `modules/billing/src/hooks/use-invoice-generation-preview.ts`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { getGenerationPreview } from '../actions/generate-invoices';

export function useInvoiceGenerationPreview(
  orgId: string | null,
  month: number,
  year: number
) {
  return useQuery({
    queryKey: ['invoice-generation-preview', orgId, month, year],
    queryFn: async () => {
      const result = await getGenerationPreview(orgId!, month, year);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!orgId,
  });
}
```

- [ ] **Step 4: Update barrel index.ts to export hooks**

Update `modules/billing/src/index.ts`:

```typescript
// Schemas (pure types + zod — safe for both client and server)
export { invoiceSchema, type InvoiceFormValues } from './schemas/invoice-schema';
export { paymentSchema, type PaymentFormValues } from './schemas/payment-schema';

// Hooks (client-only)
export { useInvoices, type InvoiceFilters } from './hooks/use-invoices';
export { usePayments } from './hooks/use-payments';
export { useInvoiceGenerationPreview } from './hooks/use-invoice-generation-preview';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createInvoice } from '@onereal/billing/actions/create-invoice';
//   import { generateInvoices } from '@onereal/billing/actions/generate-invoices';
//   import { recordPayment } from '@onereal/billing/actions/record-payment';
```

- [ ] **Step 5: Install billing module dependency in web app**

Run: `cd apps/web && pnpm add @onereal/billing@workspace:*`
Expected: Dependency added to apps/web/package.json.

- [ ] **Step 6: Commit**

```bash
git add modules/billing/src/hooks/ modules/billing/src/index.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(billing): add React Query hooks and update barrel exports"
```

---

## Chunk 3: UI Components and Pages

### Task 9: Invoice Table Component

**Files:**
- Create: `apps/web/components/billing/invoice-table.tsx`

- [ ] **Step 1: Create the reusable invoice table**

Create `apps/web/components/billing/invoice-table.tsx`:

```typescript
'use client';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button,
} from '@onereal/ui';
import { Pencil, DollarSign, Ban } from 'lucide-react';
import type { Invoice } from '@onereal/types';

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  open: { label: 'Open', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  partially_paid: { label: 'Partial', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  void: { label: 'Void', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

interface InvoiceTableProps {
  invoices: (Invoice & { displayStatus: string; tenants?: any; service_providers?: any; properties?: any })[];
  direction: 'receivable' | 'payable';
  onPay: (invoice: Invoice) => void;
  onEdit: (invoice: Invoice) => void;
  onVoid: (invoice: Invoice) => void;
}

export function InvoiceTable({ invoices, direction, onPay, onEdit, onVoid }: InvoiceTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>{direction === 'receivable' ? 'Tenant' : 'Vendor'}</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => {
            const cfg = statusConfig[inv.displayStatus] || statusConfig.open;
            const isPastDue = inv.displayStatus === 'overdue';
            const canPay = inv.status !== 'paid' && inv.status !== 'void';
            const canVoid = Number(inv.amount_paid) === 0 && inv.status !== 'void';
            const canEdit = inv.status !== 'void';

            return (
              <TableRow key={inv.id}>
                <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                <TableCell>
                  {direction === 'receivable'
                    ? inv.tenants
                      ? `${inv.tenants.first_name} ${inv.tenants.last_name}`
                      : '\u2014'
                    : inv.service_providers?.name ?? inv.service_providers?.company_name ?? '\u2014'}
                </TableCell>
                <TableCell>{inv.properties?.name ?? '\u2014'}</TableCell>
                <TableCell className={isPastDue ? 'text-destructive' : ''}>
                  {new Date(inv.due_date).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  ${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right">
                  ${Number(inv.amount_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canPay && (
                      <Button variant="ghost" size="icon" onClick={() => onPay(inv)} title="Record Payment">
                        <DollarSign className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => onEdit(inv)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canVoid && (
                      <Button variant="ghost" size="icon" onClick={() => onVoid(inv)} title="Void">
                        <Ban className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/billing/invoice-table.tsx
git commit -m "feat(billing): add reusable invoice table component"
```

---

### Task 10: Invoice Dialog

**Files:**
- Create: `apps/web/components/billing/invoice-dialog.tsx`

- [ ] **Step 1: Create the invoice create/edit dialog**

Create `apps/web/components/billing/invoice-dialog.tsx`:

```typescript
'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { invoiceSchema, type InvoiceFormValues } from '@onereal/billing';
import { createInvoice } from '@onereal/billing/actions/create-invoice';
import { updateInvoice } from '@onereal/billing/actions/update-invoice';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import { useTenants } from '@onereal/contacts';
import { useProviders } from '@onereal/contacts';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Invoice } from '@onereal/types';

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
  defaultDirection: 'receivable' | 'payable';
}

export function InvoiceDialog({ open, onOpenChange, invoice, defaultDirection }: InvoiceDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });
  const providers = (providersData ?? []) as any[];

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: invoice ? {
      direction: invoice.direction,
      tenant_id: invoice.tenant_id ?? undefined,
      provider_id: invoice.provider_id ?? undefined,
      property_id: invoice.property_id,
      unit_id: invoice.unit_id ?? undefined,
      description: invoice.description,
      amount: invoice.amount,
      due_date: invoice.due_date,
      issued_date: invoice.issued_date,
    } : {
      direction: defaultDirection,
      tenant_id: undefined,
      provider_id: undefined,
      property_id: '',
      unit_id: undefined,
      description: '',
      amount: undefined as unknown as number,
      due_date: '',
      issued_date: new Date().toISOString().split('T')[0],
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(invoice ? {
        direction: invoice.direction,
        tenant_id: invoice.tenant_id ?? undefined,
        provider_id: invoice.provider_id ?? undefined,
        property_id: invoice.property_id,
        unit_id: invoice.unit_id ?? undefined,
        description: invoice.description,
        amount: invoice.amount,
        due_date: invoice.due_date,
        issued_date: invoice.issued_date,
      } : {
        direction: defaultDirection,
        tenant_id: undefined,
        provider_id: undefined,
        property_id: '',
        unit_id: undefined,
        description: '',
        amount: undefined as unknown as number,
        due_date: '',
        issued_date: new Date().toISOString().split('T')[0],
      });
    }
  }, [open, invoice, form, defaultDirection]);

  const direction = form.watch('direction');
  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  async function onSubmit(values: InvoiceFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = invoice
      ? await updateInvoice(invoice.id, values)
      : await createInvoice(activeOrg.id, values);

    if (result.success) {
      toast.success(invoice ? 'Invoice updated' : 'Invoice created');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  const isEditing = !!invoice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Invoice' : direction === 'receivable' ? 'New Invoice' : 'New Bill'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="property_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Property *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {properties.map((p) => (
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
                        {units.map((u: any, idx: number) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.unit_number ?? `Unit ${idx + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {direction === 'receivable' && (
                <FormField control={form.control} name="tenant_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenant *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {tenants.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.first_name} {t.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {direction === 'payable' && (
                <FormField control={form.control} name="provider_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}{p.company_name ? ` (${p.company_name})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="due_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Due Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description *</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="e.g. Rent - April 2026" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{isEditing ? 'Update' : 'Create'}</Button>
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
git add apps/web/components/billing/invoice-dialog.tsx
git commit -m "feat(billing): add invoice create/edit dialog"
```

---

### Task 11: Payment Dialog

**Files:**
- Create: `apps/web/components/billing/payment-dialog.tsx`

- [ ] **Step 1: Create the payment recording dialog**

Create `apps/web/components/billing/payment-dialog.tsx`:

```typescript
'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { paymentSchema, type PaymentFormValues } from '@onereal/billing';
import { recordPayment } from '@onereal/billing/actions/record-payment';
import { useUser } from '@onereal/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Invoice } from '@onereal/types';

const methodLabels: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank Transfer',
  online: 'Online',
  other: 'Other',
};

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export function PaymentDialog({ open, onOpenChange, invoice }: PaymentDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const remaining = invoice ? Number(invoice.amount) - Number(invoice.amount_paid) : 0;

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoice_id: invoice?.id ?? '',
      amount: remaining,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'bank_transfer',
      reference_number: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open && invoice) {
      const rem = Number(invoice.amount) - Number(invoice.amount_paid);
      form.reset({
        invoice_id: invoice.id,
        amount: rem,
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'bank_transfer',
        reference_number: '',
        notes: '',
      });
    }
  }, [open, invoice, form]);

  async function onSubmit(values: PaymentFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = await recordPayment(activeOrg.id, values);

    if (result.success) {
      toast.success('Payment recorded');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          {invoice && (
            <DialogDescription>
              {invoice.invoice_number} — Remaining: ${remaining.toFixed(2)}
            </DialogDescription>
          )}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" max={remaining} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="payment_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="payment_method" render={({ field }) => (
                <FormItem>
                  <FormLabel>Method *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(methodLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="reference_number" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference #</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder="Check #, transaction ID" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ''} placeholder="Optional notes" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Record Payment</Button>
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
git add apps/web/components/billing/payment-dialog.tsx
git commit -m "feat(billing): add payment recording dialog"
```

---

### Task 12: Generate Invoices Dialog

**Files:**
- Create: `apps/web/components/billing/generate-invoices-dialog.tsx`

- [ ] **Step 1: Create the batch generation dialog**

Create `apps/web/components/billing/generate-invoices-dialog.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoiceGenerationPreview } from '@onereal/billing';
import { generateInvoices } from '@onereal/billing/actions/generate-invoices';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface GenerateInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function GenerateInvoicesDialog({ open, onOpenChange }: GenerateInvoicesDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: preview, isLoading: previewLoading } = useInvoiceGenerationPreview(
    activeOrg?.id ?? null,
    month,
    year,
  );

  async function handleGenerate() {
    if (!activeOrg) return;
    setIsGenerating(true);
    const result = await generateInvoices(activeOrg.id, month, year);
    setIsGenerating(false);

    if (result.success) {
      toast.success(`Created ${result.data.created} invoice(s)${result.data.skipped > 0 ? `, ${result.data.skipped} skipped` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-generation-preview'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  // Build month options: current month +/- a few
  const monthOptions: { month: number; year: number; label: string }[] = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    monthOptions.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const selectedKey = `${month}-${year}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate Monthly Invoices</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Month</label>
            <Select
              value={selectedKey}
              onValueChange={(v) => {
                const [m, y] = v.split('-').map(Number);
                setMonth(m);
                setYear(y);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-muted/50 p-3">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">Checking active leases...</p>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                This will create invoices for <strong className="text-foreground">{preview.eligible} active lease(s)</strong>
                {' '}that don&apos;t have {monthNames[month - 1]} {year} invoices yet.
                {preview.existing > 0 && ` (${preview.existing} already exist)`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No active leases found.</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !preview?.eligible}
            >
              {isGenerating ? 'Generating...' : `Generate ${preview?.eligible ?? 0} Invoice(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/billing/generate-invoices-dialog.tsx
git commit -m "feat(billing): add generate invoices dialog with preview"
```

---

### Task 13: Incoming Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/incoming/page.tsx`

- [ ] **Step 1: Create the Incoming page**

Create `apps/web/app/(dashboard)/accounting/incoming/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useTenants } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { GenerateInvoicesDialog } from '@/components/billing/generate-invoices-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
} from '@onereal/ui';
import { Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice } from '@onereal/types';

type TabValue = 'open' | 'paid' | 'all';

export default function IncomingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  // Map tab to status filter — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: invoicesRaw, isLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'receivable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    tenantId: tenantFilter || undefined,
    search: search || undefined,
  });

  // Filter out void for "all" tab
  const invoices = tab === 'all'
    ? (invoicesRaw ?? []).filter((inv: any) => inv.status !== 'void')
    : (invoicesRaw ?? []);

  function handlePay(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setPaymentDialogOpen(true);
  }

  function handleEdit(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  }

  async function handleVoid(invoice: Invoice) {
    if (!confirm(`Void invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    const result = await voidInvoice(invoice.id);
    if (result.success) {
      toast.success('Invoice voided');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleNewInvoice() {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Incoming</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
            <Zap className="h-4 w-4" /> Generate Invoices
          </Button>
          <Button className="gap-2" onClick={handleNewInvoice}>
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={(v) => setTenantFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {tab === 'open' ? 'No open invoices' : tab === 'paid' ? 'No paid invoices' : 'No invoices yet'}
          </p>
          <Button onClick={handleNewInvoice}>Create your first invoice</Button>
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          direction="receivable"
          onPay={handlePay}
          onEdit={handleEdit}
          onVoid={handleVoid}
        />
      )}

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        defaultDirection="receivable"
      />
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={selectedInvoice}
      />
      <GenerateInvoicesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/incoming/page.tsx
git commit -m "feat(billing): add Incoming invoices page with tabs and filters"
```

---

### Task 14: Outgoing Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`

- [ ] **Step 1: Create the Outgoing page**

Create `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { useProviders } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { deleteExpense } from '@onereal/accounting/actions/delete-expense';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { ExpenseDialog } from '@/components/accounting/expense-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice, Expense } from '@onereal/types';

type TabValue = 'open' | 'paid' | 'expenses';

export default function OutgoingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });

  // Bills (payable invoices) — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'open' ? 'open' : tab === 'paid' ? 'paid' : undefined;
  const { data: invoicesRaw, isLoading: billsLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'payable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    search: search || undefined,
  });

  const bills = invoicesRaw ?? [];

  // Expenses (existing manual entries)
  const { data: expensesData, isLoading: expensesLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    search: search || undefined,
  });
  const expenses = (expensesData ?? []) as any[];

  function handlePay(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setPaymentDialogOpen(true);
  }

  function handleEditBill(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  }

  async function handleVoidBill(invoice: Invoice) {
    if (!confirm(`Void bill ${invoice.invoice_number}?`)) return;
    const result = await voidInvoice(invoice.id);
    if (result.success) {
      toast.success('Bill voided');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleNewBill() {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  }

  function handleNewExpense() {
    setEditingExpense(null);
    setExpenseDialogOpen(true);
  }

  function handleEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setExpenseDialogOpen(true);
  }

  async function handleDeleteExpense(id: string) {
    if (!confirm('Delete this expense?')) return;
    const result = await deleteExpense(id);
    if (result.success) {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  const showBills = tab === 'open' || tab === 'paid';
  const isLoading = showBills ? billsLoading : expensesLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outgoing</h1>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={handleNewBill}>
            <Plus className="h-4 w-4" /> New Bill
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleNewExpense}>
            <Plus className="h-4 w-4" /> Quick Expense
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="open">Open Bills</TabsTrigger>
          <TabsTrigger value="paid">Paid Bills</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={showBills ? 'Search bills...' : 'Search expenses...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : showBills ? (
        bills.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground mb-4">
              {tab === 'open' ? 'No open bills' : 'No paid bills'}
            </p>
            <Button onClick={handleNewBill}>Create your first bill</Button>
          </div>
        ) : (
          <InvoiceTable
            invoices={bills}
            direction="payable"
            onPay={handlePay}
            onEdit={handleEditBill}
            onVoid={handleVoidBill}
          />
        )
      ) : (
        expenses.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground mb-4">No expenses recorded yet</p>
            <Button onClick={handleNewExpense}>Add your first expense</Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((exp: any) => (
                  <TableRow key={exp.id}>
                    <TableCell>{new Date(exp.transaction_date).toLocaleDateString()}</TableCell>
                    <TableCell>{exp.properties?.name ?? '\u2014'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{exp.expense_type.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>{exp.service_providers?.name ?? '\u2014'}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{exp.description}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      ${Number(exp.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditExpense(exp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteExpense(exp.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        defaultDirection="payable"
      />
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={selectedInvoice}
      />
      <ExpenseDialog
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        expense={editingExpense}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/outgoing/page.tsx
git commit -m "feat(billing): add Outgoing page with bills and expenses tabs"
```

---

### Task 15: Sidebar Restructure and Page Updates

**Files:**
- Modify: `apps/web/components/dashboard/sidebar.tsx`
- Modify: `apps/web/app/(dashboard)/accounting/page.tsx`
- Remove: `apps/web/app/(dashboard)/accounting/income/page.tsx`
- Remove: `apps/web/app/(dashboard)/accounting/expenses/page.tsx`

- [ ] **Step 1: Update sidebar — Accounting becomes collapsible with children**

In `apps/web/components/dashboard/sidebar.tsx`, change the Accounting nav item from:

```typescript
{ label: 'Accounting', href: '/accounting', icon: Calculator },
```

to:

```typescript
{
  label: 'Accounting', href: '/accounting', icon: Calculator,
  children: [
    { label: 'Financial Overview', href: '/accounting' },
    { label: 'Incoming', href: '/accounting/incoming' },
    { label: 'Outgoing', href: '/accounting/outgoing' },
  ],
},
```

Also update the child active-state check in the sidebar's render logic. Find the line:

```typescript
const isChildActive = pathname.startsWith(child.href);
```

And change it to use exact match for `/accounting` (to prevent Financial Overview from being highlighted when on sub-pages):

```typescript
const isChildActive = child.href === '/accounting'
  ? pathname === child.href
  : pathname.startsWith(child.href);
```

- [ ] **Step 2: Update Financial Overview page links**

In `apps/web/app/(dashboard)/accounting/page.tsx`, change the link buttons from:

```tsx
<Link href="/accounting/income">
  <Button variant="outline" size="sm" className="gap-1">
    Income <ArrowRight className="h-3 w-3" />
  </Button>
</Link>
<Link href="/accounting/expenses">
  <Button variant="outline" size="sm" className="gap-1">
    Expenses <ArrowRight className="h-3 w-3" />
  </Button>
</Link>
```

to:

```tsx
<Link href="/accounting/incoming">
  <Button variant="outline" size="sm" className="gap-1">
    Incoming <ArrowRight className="h-3 w-3" />
  </Button>
</Link>
<Link href="/accounting/outgoing">
  <Button variant="outline" size="sm" className="gap-1">
    Outgoing <ArrowRight className="h-3 w-3" />
  </Button>
</Link>
```

- [ ] **Step 3: Remove old income and expenses pages**

Delete:
- `apps/web/app/(dashboard)/accounting/income/page.tsx`
- `apps/web/app/(dashboard)/accounting/expenses/page.tsx`

Run: `rm apps/web/app/\(dashboard\)/accounting/income/page.tsx apps/web/app/\(dashboard\)/accounting/expenses/page.tsx`

- [ ] **Step 4: Verify the dev server compiles**

Run: `cd apps/web && pnpm dev`
Expected: No build errors. Navigate to `/accounting/incoming` and `/accounting/outgoing` — pages load. Sidebar shows collapsible Accounting menu with 3 children.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard/sidebar.tsx apps/web/app/\(dashboard\)/accounting/
git commit -m "feat(billing): restructure sidebar and replace income/expenses pages with incoming/outgoing"
```

---

### Task 16: Smoke Test — End-to-End Flow

This is a manual verification task to confirm the full flow works.

- [ ] **Step 1: Test sidebar navigation**

1. Open http://localhost:3000
2. Click Accounting in sidebar — should expand with Financial Overview, Incoming, Outgoing
3. Click each sub-item — verify correct page loads
4. Financial Overview page should still show charts and stats

- [ ] **Step 2: Test invoice generation**

1. Navigate to `/accounting/incoming`
2. Click "Generate Invoices"
3. Select current month
4. Preview should show eligible lease count
5. Click "Generate N Invoices"
6. Invoices should appear in the Open tab

- [ ] **Step 3: Test manual invoice creation**

1. On Incoming page, click "+ New Invoice"
2. Fill in: property, tenant, amount, due date, description
3. Submit — invoice should appear in the list

- [ ] **Step 4: Test payment recording**

1. Click the dollar sign icon on an open invoice
2. Payment dialog opens with pre-filled remaining balance
3. Fill payment method, submit
4. Invoice status should change to "Paid" (or "Partial" if partial)
5. Navigate to Financial Overview — income should reflect the payment

- [ ] **Step 5: Test outgoing (bills)**

1. Navigate to `/accounting/outgoing`
2. Click "+ New Bill"
3. Fill in: property, vendor, amount, due date, description
4. Submit — bill appears in Open Bills tab
5. Pay the bill — should create expense record
6. Switch to Expenses tab — new auto-created expense should appear

- [ ] **Step 6: Test void invoice**

1. Create a new invoice (don't pay it)
2. Click the ban icon — confirm void
3. Invoice should disappear from Open tab

- [ ] **Step 7: Commit any fixes**

If any issues found during testing, fix and commit with descriptive messages.

# Phase 4B: Enhanced Lease Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flexible lease charges, late fee assessment, and automatic month-to-month conversion to the existing lease and billing system.

**Architecture:** Extends `modules/contacts/` with lease charge CRUD, extends `modules/billing/` with multi-charge invoice generation and late fee assessment. Single database migration adds `lease_charges` table and extends `leases` and `invoices` tables. Lease dialog gets inline charge management, late fee settings, and M2M toggle.

**Tech Stack:** Next.js 15, TypeScript, Supabase (PostgreSQL + RLS), Zod, React Hook Form, TanStack Query, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-15-phase4b-enhanced-lease-management-design.md`

---

## Chunk 1: Foundation (Database, Types, Schemas)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260315000012_lease_charges.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- Migration 012: Lease charges, late fees, month-to-month support
-- ============================================================

-- 1. Create lease_charges table
CREATE TABLE public.lease_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'one_time')),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_lease_charges_lease ON public.lease_charges(lease_id);
CREATE INDEX idx_lease_charges_org_active ON public.lease_charges(org_id, is_active);

-- Updated_at trigger
CREATE TRIGGER set_lease_charges_updated_at
  BEFORE UPDATE ON public.lease_charges
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- RLS
ALTER TABLE public.lease_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease charges in their orgs"
  ON public.lease_charges FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert lease charges"
  ON public.lease_charges FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update lease charges"
  ON public.lease_charges FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete lease charges"
  ON public.lease_charges FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- 2. Add late fee + month-to-month columns to leases
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS late_fee_type TEXT DEFAULT NULL
    CHECK (late_fee_type IS NULL OR late_fee_type IN ('flat', 'percentage')),
  ADD COLUMN IF NOT EXISTS late_fee_amount DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS late_fee_grace_days INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_month_to_month BOOLEAN NOT NULL DEFAULT true;

-- Update status constraint to include 'month_to_month'
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_status_check;
ALTER TABLE public.leases ADD CONSTRAINT leases_status_check
  CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'month_to_month'));

-- 3. Add charge + late-fee linkage columns to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS lease_charge_id UUID REFERENCES public.lease_charges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_fee_for_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Apply migration to remote database**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && npx supabase db push`
Expected: Migration applies successfully, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260315000012_lease_charges.sql
git commit -m "feat: add lease_charges table, late fee and M2M columns"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add `LeaseCharge` interface after the `LeaseDocument` interface (after line 229)**

Add this after the `LeaseDocument` interface:

```typescript
export interface LeaseCharge {
  id: string;
  org_id: string;
  lease_id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'one_time';
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update `Lease` interface (lines 204-221)**

Replace the existing `Lease` interface with:

```typescript
export interface Lease {
  id: string;
  org_id: string;
  unit_id: string;
  tenant_id: string;
  start_date: string | null;
  end_date: string | null;
  rent_amount: number | null;
  deposit_amount: number | null;
  payment_due_day: number | null;
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'month_to_month';
  terms: Record<string, unknown>;
  renewal_status: string | null;
  renewal_notes: string | null;
  renewed_from_id: string | null;
  late_fee_type: 'flat' | 'percentage' | null;
  late_fee_amount: number | null;
  late_fee_grace_days: number | null;
  auto_month_to_month: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Update `Invoice` interface (lines 231-249)**

Replace the existing `Invoice` interface with:

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
  lease_charge_id: string | null;
  late_fee_for_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat: add LeaseCharge type, update Lease and Invoice interfaces"
```

---

### Task 3: Update Lease Schema

**Files:**
- Modify: `modules/contacts/src/schemas/lease-schema.ts`

- [ ] **Step 1: Replace the entire file with updated schema**

The current file has 4 fields to add (`late_fee_type`, `late_fee_amount`, `late_fee_grace_days`, `auto_month_to_month`) and the status enum needs `month_to_month`. However, `month_to_month` is system-managed and should NOT be settable via the form. The form schema should not include it — the display status is computed client-side.

Replace the file contents:

```typescript
import { z } from 'zod';

export const leaseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid('Select a unit'),
  tenant_id: z.string().uuid('Select a tenant'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  rent_amount: z.coerce.number().positive('Rent must be positive'),
  deposit_amount: z.coerce.number().min(0).optional().default(0),
  payment_due_day: z.coerce.number().min(1).max(28).optional().default(1),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
  auto_month_to_month: z.boolean().optional().default(true),
  late_fee_type: z.enum(['flat', 'percentage']).nullable().optional().default(null),
  late_fee_amount: z.coerce.number().positive().nullable().optional().default(null),
  late_fee_grace_days: z.coerce.number().int().min(1).nullable().optional().default(null),
}).refine((data) => data.end_date > data.start_date, {
  message: 'End date must be after start date',
  path: ['end_date'],
});

export type LeaseFormValues = z.infer<typeof leaseSchema>;
```

**Key decisions:**
- `status` enum stays as 4 values (no `month_to_month`) — that status is system-managed
- `late_fee_type` is nullable (null = disabled)
- `late_fee_amount` and `late_fee_grace_days` are nullable (only set when late fees are enabled)
- `auto_month_to_month` defaults to `true`

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/schemas/lease-schema.ts
git commit -m "feat: add late fee and M2M fields to lease schema"
```

---

### Task 4: Lease Charge Schema

**Files:**
- Create: `modules/contacts/src/schemas/lease-charge-schema.ts`

- [ ] **Step 1: Create the schema file**

```typescript
import { z } from 'zod';

export const leaseChargeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  frequency: z.enum(['monthly', 'yearly', 'one_time']),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional().default(''),
  is_active: z.boolean().optional().default(true),
});

export type LeaseChargeFormValues = z.infer<typeof leaseChargeSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/schemas/lease-charge-schema.ts
git commit -m "feat: add lease charge Zod schema"
```

---

## Chunk 2: Backend Logic (Actions, Hooks, Exports)

### Task 5: Lease Charge CRUD Actions

**Files:**
- Create: `modules/contacts/src/actions/create-lease-charge.ts`
- Create: `modules/contacts/src/actions/update-lease-charge.ts`
- Create: `modules/contacts/src/actions/delete-lease-charge.ts`

- [ ] **Step 1: Create `create-lease-charge.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseChargeSchema, type LeaseChargeFormValues } from '../schemas/lease-charge-schema';

export async function createLeaseCharge(
  orgId: string,
  leaseId: string,
  values: LeaseChargeFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = leaseChargeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const insertData: Record<string, unknown> = {
      org_id: orgId,
      lease_id: leaseId,
      name: parsed.data.name,
      amount: parsed.data.amount,
      frequency: parsed.data.frequency,
      start_date: parsed.data.start_date,
      is_active: parsed.data.is_active,
    };

    // Only set end_date if provided (non-empty string)
    if (parsed.data.end_date) {
      insertData.end_date = parsed.data.end_date;
    }

    const { data, error } = await db
      .from('lease_charges')
      .insert(insertData)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create lease charge' };
  }
}
```

- [ ] **Step 2: Create `update-lease-charge.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseChargeSchema, type LeaseChargeFormValues } from '../schemas/lease-charge-schema';

export async function updateLeaseCharge(
  id: string,
  values: LeaseChargeFormValues
): Promise<ActionResult> {
  try {
    const parsed = leaseChargeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('lease_charges')
      .update({
        name: parsed.data.name,
        amount: parsed.data.amount,
        frequency: parsed.data.frequency,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date || null,
        is_active: parsed.data.is_active,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update lease charge' };
  }
}
```

- [ ] **Step 3: Create `delete-lease-charge.ts`**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteLeaseCharge(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('lease_charges')
      .delete()
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete lease charge' };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add modules/contacts/src/actions/create-lease-charge.ts modules/contacts/src/actions/update-lease-charge.ts modules/contacts/src/actions/delete-lease-charge.ts
git commit -m "feat: add lease charge CRUD actions"
```

---

### Task 6: Lease Charges Hook

**Files:**
- Create: `modules/contacts/src/hooks/use-lease-charges.ts`

- [ ] **Step 1: Create the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useLeaseCharges(leaseId: string | null) {
  return useQuery({
    queryKey: ['lease-charges', leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('lease_charges')
        .select('*')
        .eq('lease_id', leaseId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leaseId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/hooks/use-lease-charges.ts
git commit -m "feat: add useLeaseCharges React Query hook"
```

---

### Task 7: Update Lease Actions for New Fields

**Files:**
- Modify: `modules/contacts/src/actions/create-lease.ts`
- Modify: `modules/contacts/src/actions/update-lease.ts`

- [ ] **Step 1: Update `create-lease.ts`**

The existing code already destructures `property_id` from `parsed.data` and spreads the rest into the insert. Since the new fields (`auto_month_to_month`, `late_fee_type`, `late_fee_amount`, `late_fee_grace_days`) are part of the schema and should go directly to the DB, they'll be included in the spread automatically.

No code changes needed for `create-lease.ts` — the spread `{ ...leaseData, org_id: orgId }` already handles new schema fields.

**Verify:** Read the file and confirm the spread pattern works. The only field destructured out is `property_id`, so new fields flow through.

- [ ] **Step 2: Update `update-lease.ts`**

Same as create — the spread `leaseData` already includes new fields. However, we need to add status transition enforcement and handle M2M unit occupancy.

Replace `modules/contacts/src/actions/update-lease.ts` with:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseSchema, type LeaseFormValues } from '../schemas/lease-schema';

export async function updateLease(
  id: string,
  values: LeaseFormValues
): Promise<ActionResult> {
  try {
    const parsed = leaseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Fetch current lease to check status transitions
    const { data: currentLease } = await db
      .from('leases')
      .select('status')
      .eq('id', id)
      .single();

    // Enforce status transition rules:
    // - Can set to 'active' only from 'draft'
    // - Can set to 'terminated' from any status
    // - Cannot set to 'month_to_month' via form (system-managed)
    if (currentLease) {
      const newStatus = parsed.data.status;
      const oldStatus = currentLease.status;

      if (newStatus === 'active' && oldStatus !== 'draft' && oldStatus !== 'active') {
        return { success: false, error: 'Can only activate a lease from draft status' };
      }
    }

    // Extract property_id (not stored on leases table)
    const { property_id, ...leaseData } = parsed.data;

    const { error } = await db
      .from('leases')
      .update(leaseData)
      .eq('id', id);

    if (error) return { success: false, error: error.message };

    // Unit occupancy sync
    if (parsed.data.status === 'active') {
      await db
        .from('units')
        .update({ status: 'occupied' })
        .eq('id', parsed.data.unit_id);
    } else if (parsed.data.status === 'terminated' || parsed.data.status === 'expired') {
      // Check if any other active/month_to_month leases exist on the same unit
      const { data: otherLeases } = await db
        .from('leases')
        .select('id')
        .eq('unit_id', parsed.data.unit_id)
        .in('status', ['active', 'month_to_month'])
        .neq('id', id)
        .limit(1);

      if (!otherLeases || otherLeases.length === 0) {
        await db
          .from('units')
          .update({ status: 'vacant' })
          .eq('id', parsed.data.unit_id);
      }
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update lease' };
  }
}
```

**Changes from original:**
- Added status transition enforcement (active only from draft)
- Unit occupancy check now includes `month_to_month` in the "other active leases" query

- [ ] **Step 3: Commit**

```bash
git add modules/contacts/src/actions/update-lease.ts
git commit -m "feat: add status transition rules and M2M support to update-lease"
```

---

### Task 8: Update useLeases Hook with Display Status

**Files:**
- Modify: `modules/contacts/src/hooks/use-leases.ts`

- [ ] **Step 1: Replace the file with display status computation**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface LeaseFilters {
  orgId: string | null;
  tenantId?: string;
  propertyId?: string;
  unitId?: string;
  status?: string;
}

export function useLeases(filters: LeaseFilters) {
  return useQuery({
    queryKey: ['leases', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('leases')
        .select('*, tenants(first_name, last_name), units(unit_number, property_id, properties(name))')
        .eq('org_id', filters.orgId)
        .order('start_date', { ascending: false });

      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.unitId) query = query.eq('unit_id', filters.unitId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;

      // Client-side property filtering (since property_id is on units, not leases)
      let result = data ?? [];
      if (filters.propertyId) {
        result = result.filter((lease: any) => lease.units?.property_id === filters.propertyId);
      }

      // Compute displayStatus for month-to-month detection (read-only, no DB writes)
      const today = new Date().toISOString().split('T')[0];
      result = result.map((lease: any) => {
        let displayStatus = lease.status;

        if (lease.status === 'active' && lease.end_date && lease.end_date < today) {
          if (lease.auto_month_to_month) {
            displayStatus = 'month_to_month';
          } else {
            displayStatus = 'expired';
          }
        }

        return { ...lease, displayStatus };
      });

      return result;
    },
    enabled: !!filters.orgId,
  });
}
```

**Key change:** After fetching, each lease gets a `displayStatus` field. The DB `status` column is unchanged — the actual DB update happens only during invoice generation (Task 10).

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/hooks/use-leases.ts
git commit -m "feat: add displayStatus computation for M2M leases in useLeases hook"
```

---

### Task 9: Update Module Exports

**Files:**
- Modify: `modules/contacts/src/index.ts`

- [ ] **Step 1: Add exports for new schema and hook**

Add these lines to the existing file:

```typescript
export { leaseChargeSchema, type LeaseChargeFormValues } from './schemas/lease-charge-schema';
export { useLeaseCharges } from './hooks/use-lease-charges';
```

Add them after the existing `leaseSchema` and `useLeases` exports respectively.

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/index.ts
git commit -m "feat: export lease charge schema and hook from contacts module"
```

---

## Chunk 3: Invoice Generation & UI

### Task 10: Update Invoice Generation

**Files:**
- Modify: `modules/billing/src/actions/generate-invoices.ts`

This is the most complex task. The current file generates one rent invoice per active lease. The updated version must:
1. Fetch `active` AND `month_to_month` leases
2. Auto-update expired leases with `auto_month_to_month = true`
3. Generate invoices for rent + all active charges (monthly, yearly, one-time)
4. Assess late fees on overdue invoices
5. Use updated idempotency checks

- [ ] **Step 1: Replace `generate-invoices.ts` with the complete updated version**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface GenerateResult {
  created: number;
  skipped: number;
  lateFees: number;
  skipReasons?: string[];
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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
    const monthName = monthNames[month - 1];
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch active + month_to_month leases
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, end_date, auto_month_to_month, late_fee_type, late_fee_amount, late_fee_grace_days, units(property_id)')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    if (leaseError) return { success: false, error: leaseError.message };
    if (!leases || leases.length === 0) {
      // Still assess late fees even with no active leases
      const lateFees = await assessLateFees(db, orgId, today);
      return { success: true, data: { created: 0, skipped: 0, lateFees } };
    }

    // 2. Auto-update status for expired leases
    for (const lease of leases) {
      if (lease.end_date && lease.end_date < today && lease.auto_month_to_month !== false) {
        // Check if still marked as 'active' (not yet transitioned)
        await db
          .from('leases')
          .update({ status: 'month_to_month' })
          .eq('id', lease.id)
          .eq('status', 'active');
      } else if (lease.end_date && lease.end_date < today && lease.auto_month_to_month === false) {
        await db
          .from('leases')
          .update({ status: 'expired' })
          .eq('id', lease.id)
          .eq('status', 'active');
      }
    }

    // Re-fetch to get updated statuses (some may now be expired)
    const { data: activeLeases } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, units(property_id)')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    const eligibleLeases = activeLeases ?? [];

    // 3. Fetch lease charges for all eligible leases
    const leaseIds = eligibleLeases.map((l: any) => l.id);
    let allCharges: any[] = [];
    if (leaseIds.length > 0) {
      const { data: charges } = await db
        .from('lease_charges')
        .select('*')
        .in('lease_id', leaseIds)
        .eq('is_active', true);
      allCharges = charges ?? [];
    }

    // 4. Fetch existing invoices for idempotency checks
    let existingRentInvoices = new Set<string>();
    let existingChargeInvoices = new Set<string>(); // key: "chargeId-month-year"

    if (leaseIds.length > 0) {
      // Rent invoices: lease_id + month + lease_charge_id IS NULL
      const { data: existRent } = await db
        .from('invoices')
        .select('lease_id')
        .in('lease_id', leaseIds)
        .is('lease_charge_id', null)
        .gte('due_date', startOfMonth)
        .lte('due_date', endOfMonth);

      existingRentInvoices = new Set((existRent ?? []).map((e: any) => e.lease_id));

      // Charge invoices: lease_charge_id + month
      const chargeIds = allCharges.map((c: any) => c.id);
      if (chargeIds.length > 0) {
        const { data: existCharge } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', chargeIds)
          .gte('due_date', startOfMonth)
          .lte('due_date', endOfMonth);

        existingChargeInvoices = new Set(
          (existCharge ?? []).map((e: any) => `${e.lease_charge_id}-${month}-${year}`)
        );

        // Also check one-time charges that have ANY invoice (regardless of month)
        const oneTimeChargeIds = allCharges
          .filter((c: any) => c.frequency === 'one_time')
          .map((c: any) => c.id);

        if (oneTimeChargeIds.length > 0) {
          const { data: existOneTime } = await db
            .from('invoices')
            .select('lease_charge_id')
            .in('lease_charge_id', oneTimeChargeIds);

          for (const e of (existOneTime ?? [])) {
            existingChargeInvoices.add(`${e.lease_charge_id}-onetime`);
          }
        }
      }
    }

    // 5. Generate invoices
    let created = 0;
    let skipped = 0;
    const skipReasons: string[] = [];

    for (const lease of eligibleLeases) {
      const propertyId = lease.units?.property_id;
      const dueDay = lease.payment_due_day ?? 1;
      const maxDay = new Date(year, month, 0).getDate();
      const safeDay = Math.min(dueDay, maxDay);
      const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;

      if (!propertyId) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: missing property`);
        continue;
      }

      // 5a. Rent invoice
      if (lease.rent_amount && lease.rent_amount > 0) {
        if (!existingRentInvoices.has(lease.id)) {
          const result = await createInvoice(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: lease.rent_amount,
            due_date: dueDate,
            description: `Rent - ${monthName} ${year}`,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: rent - ${result.error}`);
          }
        }
      }

      // 5b. Additional charges
      const leaseCharges = allCharges.filter((c: any) => c.lease_id === lease.id);

      for (const charge of leaseCharges) {
        // Check charge date range
        if (charge.start_date > endOfMonth) continue; // hasn't started yet
        if (charge.end_date && charge.end_date < startOfMonth) continue; // already ended

        if (charge.frequency === 'monthly') {
          const key = `${charge.id}-${month}-${year}`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await createInvoice(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: `${charge.name} - ${monthName} ${year}`,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        } else if (charge.frequency === 'yearly') {
          // Only generate in the month matching start_date month
          const chargeMonth = new Date(charge.start_date + 'T00:00:00').getMonth() + 1;
          if (chargeMonth !== month) continue;

          const key = `${charge.id}-${month}-${year}`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await createInvoice(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: `${charge.name} - ${year}`,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        } else if (charge.frequency === 'one_time') {
          const key = `${charge.id}-onetime`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await createInvoice(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: charge.name,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        }
      }
    }

    // 6. Assess late fees
    const lateFees = await assessLateFees(db, orgId, today);

    return { success: true, data: { created, skipped, lateFees, skipReasons } };
  } catch {
    return { success: false, error: 'Failed to generate invoices' };
  }
}

// Helper: create a single invoice with auto-generated invoice number
async function createInvoice(
  db: any,
  orgId: string,
  data: {
    lease_id: string;
    tenant_id: string;
    property_id: string;
    unit_id: string;
    amount: number;
    due_date: string;
    description: string;
    lease_charge_id?: string;
    late_fee_for_invoice_id?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { data: invoiceNumber, error: seqError } = await db.rpc('next_invoice_number', {
    p_org_id: orgId,
  });
  if (seqError) return { success: false, error: `invoice number error - ${seqError.message}` };

  const insertData: Record<string, unknown> = {
    org_id: orgId,
    invoice_number: invoiceNumber,
    direction: 'receivable',
    status: 'open',
    lease_id: data.lease_id,
    tenant_id: data.tenant_id,
    property_id: data.property_id,
    unit_id: data.unit_id,
    amount: data.amount,
    due_date: data.due_date,
    issued_date: new Date().toISOString().split('T')[0],
    description: data.description,
  };

  if (data.lease_charge_id) insertData.lease_charge_id = data.lease_charge_id;
  if (data.late_fee_for_invoice_id) insertData.late_fee_for_invoice_id = data.late_fee_for_invoice_id;

  const { error: insertError } = await db.from('invoices').insert(insertData);
  if (insertError) return { success: false, error: `insert failed - ${insertError.message}` };

  return { success: true };
}

// Helper: assess late fees on overdue invoices
async function assessLateFees(
  db: any,
  orgId: string,
  today: string
): Promise<number> {
  // Find overdue receivable invoices that:
  // 1. Are open or partially_paid
  // 2. Are NOT themselves late fees
  // 3. Are past due date
  // 4. Have a lease with late fee configuration
  const { data: overdueInvoices } = await db
    .from('invoices')
    .select('id, invoice_number, lease_id, tenant_id, property_id, unit_id, amount, amount_paid, due_date')
    .eq('org_id', orgId)
    .eq('direction', 'receivable')
    .in('status', ['open', 'partially_paid'])
    .is('late_fee_for_invoice_id', null)
    .lt('due_date', today);

  if (!overdueInvoices || overdueInvoices.length === 0) return 0;

  // Get leases with late fee config
  const overdueLeaseIds = [...new Set(overdueInvoices.map((inv: any) => inv.lease_id).filter(Boolean))];
  if (overdueLeaseIds.length === 0) return 0;

  const { data: leasesWithFees } = await db
    .from('leases')
    .select('id, late_fee_type, late_fee_amount, late_fee_grace_days')
    .in('id', overdueLeaseIds)
    .not('late_fee_type', 'is', null);

  if (!leasesWithFees || leasesWithFees.length === 0) return 0;

  const leaseFeesMap = new Map(leasesWithFees.map((l: any) => [l.id, l]));

  // Check which overdue invoices already have late fee invoices
  const overdueIds = overdueInvoices.map((inv: any) => inv.id);
  const { data: existingLateFees } = await db
    .from('invoices')
    .select('late_fee_for_invoice_id')
    .in('late_fee_for_invoice_id', overdueIds);

  const hasLateFee = new Set((existingLateFees ?? []).map((e: any) => e.late_fee_for_invoice_id));

  let lateFeeCount = 0;

  for (const inv of overdueInvoices) {
    if (!inv.lease_id || !leaseFeesMap.has(inv.lease_id)) continue;
    if (hasLateFee.has(inv.id)) continue;

    const leaseConfig = leaseFeesMap.get(inv.lease_id);
    const graceDays = leaseConfig.late_fee_grace_days ?? 5;

    // Check grace period
    const dueDate = new Date(inv.due_date + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const daysPastDue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPastDue <= graceDays) continue;

    // Calculate late fee amount
    let feeAmount: number;
    if (leaseConfig.late_fee_type === 'flat') {
      feeAmount = Number(leaseConfig.late_fee_amount);
    } else {
      // Percentage on remaining balance
      const remaining = Number(inv.amount) - Number(inv.amount_paid);
      feeAmount = Math.round(remaining * (Number(leaseConfig.late_fee_amount) / 100) * 100) / 100;
    }

    if (feeAmount <= 0) continue;

    const result = await createInvoice(db, orgId, {
      lease_id: inv.lease_id,
      tenant_id: inv.tenant_id,
      property_id: inv.property_id,
      unit_id: inv.unit_id,
      amount: feeAmount,
      due_date: today,
      description: `Late Fee - ${inv.invoice_number}`,
      late_fee_for_invoice_id: inv.id,
    });

    if (result.success) lateFeeCount++;
  }

  return lateFeeCount;
}

// Preview function (also updated)
export async function getGenerationPreview(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number; existing: number; lateFees: number }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const today = new Date().toISOString().split('T')[0];
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

    // Count eligible leases (active + month_to_month)
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, rent_amount, end_date, auto_month_to_month')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    if (leaseError) return { success: false, error: leaseError.message };

    // Filter out leases that would be expired (not M2M)
    const eligibleLeases = (leases ?? []).filter((l: any) => {
      if (l.end_date && l.end_date < today && !l.auto_month_to_month) return false;
      return true;
    });

    const leaseIds = eligibleLeases.map((l: any) => l.id);

    // Count existing rent invoices for this month
    let existingRentCount = 0;
    if (leaseIds.length > 0) {
      const { data: existRent } = await db
        .from('invoices')
        .select('lease_id')
        .in('lease_id', leaseIds)
        .is('lease_charge_id', null)
        .gte('due_date', startOfMonth)
        .lte('due_date', endOfMonth);
      existingRentCount = existRent?.length ?? 0;
    }

    // Count eligible charges
    let totalChargeInvoices = 0;
    let existingChargeCount = 0;
    if (leaseIds.length > 0) {
      const { data: charges } = await db
        .from('lease_charges')
        .select('id, lease_id, frequency, start_date, end_date')
        .in('lease_id', leaseIds)
        .eq('is_active', true);

      const activeCharges = (charges ?? []).filter((c: any) => {
        if (c.start_date > endOfMonth) return false;
        if (c.end_date && c.end_date < startOfMonth) return false;

        if (c.frequency === 'monthly') return true;
        if (c.frequency === 'yearly') {
          const chargeMonth = new Date(c.start_date + 'T00:00:00').getMonth() + 1;
          return chargeMonth === month;
        }
        if (c.frequency === 'one_time') return true;
        return false;
      });

      totalChargeInvoices = activeCharges.length;

      // Check existing charge invoices — split by frequency to avoid double-counting
      const nonOneTimeIds = activeCharges
        .filter((c: any) => c.frequency !== 'one_time')
        .map((c: any) => c.id);

      if (nonOneTimeIds.length > 0) {
        // Monthly/yearly charges in this month
        const { data: existCharge } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', nonOneTimeIds)
          .gte('due_date', startOfMonth)
          .lte('due_date', endOfMonth);
        existingChargeCount = existCharge?.length ?? 0;
      }

      // One-time charges that already have any invoice (regardless of month)
      const oneTimeIds = activeCharges
        .filter((c: any) => c.frequency === 'one_time')
        .map((c: any) => c.id);
      if (oneTimeIds.length > 0) {
        const { data: existOneTime } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', oneTimeIds);
        existingChargeCount += existOneTime?.length ?? 0;
      }
    }

    // Count late fees eligible
    let lateFeeCount = 0;
    const { data: overdueInvoices } = await db
      .from('invoices')
      .select('id, lease_id')
      .eq('org_id', orgId)
      .eq('direction', 'receivable')
      .in('status', ['open', 'partially_paid'])
      .is('late_fee_for_invoice_id', null)
      .lt('due_date', today);

    if (overdueInvoices && overdueInvoices.length > 0) {
      const overdueLeaseIds = [...new Set(overdueInvoices.map((inv: any) => inv.lease_id).filter(Boolean))];
      if (overdueLeaseIds.length > 0) {
        const { data: leasesWithFees } = await db
          .from('leases')
          .select('id, late_fee_grace_days')
          .in('id', overdueLeaseIds)
          .not('late_fee_type', 'is', null);

        if (leasesWithFees && leasesWithFees.length > 0) {
          const leaseFeesMap = new Map(leasesWithFees.map((l: any) => [l.id, l]));
          const overdueIds = overdueInvoices.map((inv: any) => inv.id);

          const { data: existingLateFees } = await db
            .from('invoices')
            .select('late_fee_for_invoice_id')
            .in('late_fee_for_invoice_id', overdueIds);

          const hasLateFee = new Set((existingLateFees ?? []).map((e: any) => e.late_fee_for_invoice_id));

          for (const inv of overdueInvoices) {
            if (!inv.lease_id || !leaseFeesMap.has(inv.lease_id)) continue;
            if (hasLateFee.has(inv.id)) continue;

            const config = leaseFeesMap.get(inv.lease_id);
            const graceDays = config.late_fee_grace_days ?? 5;
            const dueDate = new Date(inv.due_date + 'T00:00:00');
            const todayDate = new Date(today + 'T00:00:00');
            const daysPastDue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysPastDue > graceDays) lateFeeCount++;
          }
        }
      }
    }

    const rentEligible = eligibleLeases.filter((l: any) => l.rent_amount && l.rent_amount > 0).length;
    const totalEligible = (rentEligible - existingRentCount) + (totalChargeInvoices - existingChargeCount);
    const totalExisting = existingRentCount + existingChargeCount;

    return {
      success: true,
      data: {
        eligible: Math.max(0, totalEligible),
        existing: totalExisting,
        lateFees: lateFeeCount,
      },
    };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm build`
Expected: No TypeScript errors related to the generate-invoices module.

- [ ] **Step 3: Commit**

```bash
git add modules/billing/src/actions/generate-invoices.ts
git commit -m "feat: multi-charge invoice generation with late fee assessment"
```

---

### Task 11: Update Invoice Generation Preview Hook

**Files:**
- Modify: `modules/billing/src/hooks/use-invoice-generation-preview.ts`

- [ ] **Step 1: Update the hook to include lateFees in the return type**

The hook already calls `getGenerationPreview` which now returns `{ eligible, existing, lateFees }`. The hook just needs to pass this through. Since it already returns `result.data`, no change is needed — the new `lateFees` field flows through automatically.

**Verify:** Read the file and confirm the hook returns `result.data` directly. The updated `getGenerationPreview` adds `lateFees` to the return type, so the hook's return type will automatically include it.

No code change needed. The hook already does:
```typescript
const result = await getGenerationPreview(orgId!, month, year);
if (!result.success) throw new Error(result.error);
return result.data;
```

- [ ] **Step 2: Commit (skip — no changes needed)**

---

### Task 12: Update Lease Dialog UI

**Files:**
- Modify: `apps/web/components/contacts/lease-dialog.tsx`

This adds three new sections to the lease dialog:
1. Auto Month-to-Month toggle
2. Additional Charges list
3. Late Fee Settings

- [ ] **Step 1: Replace the lease dialog with the complete updated version**

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { leaseSchema, type LeaseFormValues, useTenants, useLeaseCharges } from '@onereal/contacts';
import { createLease } from '@onereal/contacts/actions/create-lease';
import { updateLease } from '@onereal/contacts/actions/update-lease';
import { createLeaseCharge } from '@onereal/contacts/actions/create-lease-charge';
import { deleteLeaseCharge } from '@onereal/contacts/actions/delete-lease-charge';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Button, Separator,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Switch,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import type { LeaseCharge } from '@onereal/types';

const leaseStatusLabels: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
};

const frequencyLabels: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  one_time: 'One-Time',
};

interface PendingCharge {
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'one_time';
}

interface LeaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lease: any | null;
  defaultTenantId?: string;
  defaultPropertyId?: string;
}

export function LeaseDialog({ open, onOpenChange, lease, defaultTenantId, defaultPropertyId }: LeaseDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];

  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  // Existing charges (only when editing)
  const { data: existingCharges, refetch: refetchCharges } = useLeaseCharges(lease?.id ?? null);

  // Pending charges for new leases (not yet saved to DB)
  const [pendingCharges, setPendingCharges] = useState<PendingCharge[]>([]);
  const [newChargeName, setNewChargeName] = useState('');
  const [newChargeAmount, setNewChargeAmount] = useState('');
  const [newChargeFrequency, setNewChargeFrequency] = useState<'monthly' | 'yearly' | 'one_time'>('monthly');

  const defaultValues: LeaseFormValues = {
    property_id: defaultPropertyId ?? '',
    unit_id: '',
    tenant_id: defaultTenantId ?? '',
    start_date: '',
    end_date: '',
    rent_amount: undefined as unknown as number,
    deposit_amount: 0,
    payment_due_day: 1,
    status: 'draft',
    auto_month_to_month: true,
    late_fee_type: null,
    late_fee_amount: null,
    late_fee_grace_days: null,
  };

  const form = useForm<LeaseFormValues>({
    resolver: zodResolver(leaseSchema),
    defaultValues: lease ? {
      property_id: lease.units?.property_id ?? '',
      unit_id: lease.unit_id,
      tenant_id: lease.tenant_id,
      start_date: lease.start_date ?? '',
      end_date: lease.end_date ?? '',
      rent_amount: lease.rent_amount ?? 0,
      deposit_amount: lease.deposit_amount ?? 0,
      payment_due_day: lease.payment_due_day ?? 1,
      status: lease.status === 'month_to_month' ? 'active' : (lease.status as LeaseFormValues['status']),
      auto_month_to_month: lease.auto_month_to_month ?? true,
      late_fee_type: lease.late_fee_type ?? null,
      late_fee_amount: lease.late_fee_amount ?? null,
      late_fee_grace_days: lease.late_fee_grace_days ?? null,
    } : defaultValues,
  });

  useEffect(() => {
    if (open) {
      setPendingCharges([]);
      setNewChargeName('');
      setNewChargeAmount('');
      setNewChargeFrequency('monthly');
      form.reset(lease ? {
        property_id: lease.units?.property_id ?? '',
        unit_id: lease.unit_id,
        tenant_id: lease.tenant_id,
        start_date: lease.start_date ?? '',
        end_date: lease.end_date ?? '',
        rent_amount: lease.rent_amount ?? 0,
        deposit_amount: lease.deposit_amount ?? 0,
        payment_due_day: lease.payment_due_day ?? 1,
        status: lease.status === 'month_to_month' ? 'active' : (lease.status as LeaseFormValues['status']),
        auto_month_to_month: lease.auto_month_to_month ?? true,
        late_fee_type: lease.late_fee_type ?? null,
        late_fee_amount: lease.late_fee_amount ?? null,
        late_fee_grace_days: lease.late_fee_grace_days ?? null,
      } : defaultValues);
    }
  }, [open, lease, form, defaultTenantId, defaultPropertyId]);

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  const lateFeeType = form.watch('late_fee_type');

  useEffect(() => {
    if (units.length === 1 && form.getValues('unit_id') !== units[0].id) {
      form.setValue('unit_id', units[0].id);
    }
  }, [units, form]);

  function handleAddPendingCharge() {
    if (!newChargeName.trim() || !newChargeAmount) return;
    const amount = parseFloat(newChargeAmount);
    if (isNaN(amount) || amount <= 0) return;

    setPendingCharges([...pendingCharges, {
      name: newChargeName.trim(),
      amount,
      frequency: newChargeFrequency,
    }]);
    setNewChargeName('');
    setNewChargeAmount('');
    setNewChargeFrequency('monthly');
  }

  async function handleDeleteExistingCharge(chargeId: string) {
    const result = await deleteLeaseCharge(chargeId);
    if (result.success) {
      toast.success('Charge removed');
      refetchCharges();
    } else {
      toast.error(result.error);
    }
  }

  async function onSubmit(values: LeaseFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    // Clear late fee fields if type is null
    if (!values.late_fee_type) {
      values.late_fee_amount = null;
      values.late_fee_grace_days = null;
    }

    const result = lease
      ? await updateLease(lease.id, values)
      : await createLease(activeOrg.id, values);

    if (result.success) {
      // Create pending charges for new leases
      const leaseId = lease?.id ?? (result as any).data?.id;
      if (leaseId && pendingCharges.length > 0) {
        const startDate = values.start_date;
        for (const charge of pendingCharges) {
          await createLeaseCharge(activeOrg.id, leaseId, {
            name: charge.name,
            amount: charge.amount,
            frequency: charge.frequency,
            start_date: startDate,
            end_date: '',
            is_active: true,
          });
        }
      }

      toast.success(lease ? 'Lease updated' : 'Lease created');
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      queryClient.invalidateQueries({ queryKey: ['lease-charges'] });
      onOpenChange(false);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lease ? 'Edit Lease' : 'Add Lease'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (units.length === 1) form.setValue('unit_id', units[0].id);
            form.handleSubmit(onSubmit, (errors) => {
              const first = Object.entries(errors)[0];
              if (first) toast.error(`${first[0]}: ${first[1]?.message}`);
            })();
          }} className="space-y-4">
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
                    <FormLabel>Unit *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {units.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>{u.unit_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="tenant_id" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Tenant *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {tenants.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="start_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="end_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="rent_amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Rent *</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="deposit_amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Security Deposit</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="payment_due_day" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Due Day (1-28)</FormLabel>
                  <FormControl><Input type="number" min="1" max="28" {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(leaseStatusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Auto Month-to-Month Toggle */}
            <FormField control={form.control} name="auto_month_to_month" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel className="text-sm font-medium">Auto Month-to-Month</FormLabel>
                  <p className="text-xs text-muted-foreground">Automatically convert to month-to-month when lease expires</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <Separator />

            {/* Additional Charges Section */}
            <div>
              <h4 className="text-sm font-medium mb-2">Additional Charges</h4>

              {/* Existing charges (edit mode) */}
              {lease && (existingCharges ?? []).map((charge: LeaseCharge) => (
                <div key={charge.id} className="flex items-center gap-2 mb-2 rounded border p-2 text-sm">
                  <span className="flex-1">{charge.name}</span>
                  <span className="text-muted-foreground">${charge.amount}</span>
                  <span className="text-xs text-muted-foreground">{frequencyLabels[charge.frequency]}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleDeleteExistingCharge(charge.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}

              {/* Pending charges (create mode) */}
              {pendingCharges.map((charge, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2 rounded border p-2 text-sm">
                  <span className="flex-1">{charge.name}</span>
                  <span className="text-muted-foreground">${charge.amount}</span>
                  <span className="text-xs text-muted-foreground">{frequencyLabels[charge.frequency]}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setPendingCharges(pendingCharges.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}

              {/* Add charge form */}
              <div className="flex items-end gap-2">
                <Input
                  placeholder="Charge name"
                  value={newChargeName}
                  onChange={(e) => setNewChargeName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  step="0.01"
                  value={newChargeAmount}
                  onChange={(e) => setNewChargeAmount(e.target.value)}
                  className="w-24 h-8 text-sm"
                />
                <Select value={newChargeFrequency} onValueChange={(v) => setNewChargeFrequency(v as any)}>
                  <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                    <SelectItem value="one_time">One-Time</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleAddPendingCharge}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* Late Fee Settings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Late Fee Settings</h4>
                <Switch
                  checked={!!lateFeeType}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      form.setValue('late_fee_type', 'flat');
                      form.setValue('late_fee_grace_days', 5);
                    } else {
                      form.setValue('late_fee_type', null);
                      form.setValue('late_fee_amount', null);
                      form.setValue('late_fee_grace_days', null);
                    }
                  }}
                />
              </div>
              {lateFeeType && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField control={form.control} name="late_fee_type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value ?? 'flat'}>
                        <FormControl><SelectTrigger className="h-8"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="flat">Flat Fee ($)</SelectItem>
                          <SelectItem value="percentage">Percentage (%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="late_fee_amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{lateFeeType === 'percentage' ? 'Percentage' : 'Amount'}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={lateFeeType === 'percentage' ? '5' : '50'}
                          className="h-8"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="late_fee_grace_days" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grace Days</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="5"
                          className="h-8"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{lease ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

**Key changes from original:**
- Added `useLeaseCharges` hook for existing charges (edit mode)
- Added pending charges state for new leases (create mode)
- Added "Additional Charges" section with inline add/remove
- Added "Late Fee Settings" section with enable toggle
- Added "Auto Month-to-Month" switch
- Dialog now scrollable (`max-h-[90vh] overflow-y-auto`)
- New imports: `useState`, `Switch`, `Separator`, `Plus`, `Trash2`, `LeaseCharge`, charge actions
- When editing a M2M lease, status shows as the original 4-option select (M2M is system-managed)

- [ ] **Step 2: Verify the app compiles**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/contacts/lease-dialog.tsx
git commit -m "feat: add charges, late fees, and M2M toggle to lease dialog"
```

---

### Task 13: Update Generate Invoices Dialog

**Files:**
- Modify: `apps/web/components/billing/generate-invoices-dialog.tsx`

- [ ] **Step 1: Read the current file to understand exact structure**

Read: `apps/web/components/billing/generate-invoices-dialog.tsx`

- [ ] **Step 2: Update the dialog to show late fee count and updated result**

The changes are:
1. Preview now includes `lateFees` count — show it in the preview panel
2. Result now includes `lateFees` count — show it in the success toast

Update the preview panel to show late fees:

In the preview section, after the eligible leases text, add:

```tsx
{preview?.lateFees > 0 && (
  <p className="text-sm text-amber-600 mt-1">
    + {preview.lateFees} late fee(s) to assess
  </p>
)}
```

Update the success toast in `handleGenerate` to include late fees:

```typescript
if (result.data.created > 0 || result.data.lateFees > 0) {
  let msg = `Created ${result.data.created} invoice(s)`;
  if (result.data.lateFees > 0) msg += `, ${result.data.lateFees} late fee(s)`;
  if (result.data.skipped > 0) msg += `, ${result.data.skipped} skipped`;
  toast.success(msg);
} else if (result.data.skipped > 0) {
  const reason = result.data.skipReasons?.[0] ?? 'Unknown reason';
  toast.error(`Skipped ${result.data.skipped} invoice(s): ${reason}`);
} else {
  toast.info('No invoices to generate');
}
```

Update the Generate button disabled condition and text to include late fees:

```tsx
disabled={isGenerating || (!preview?.eligible && !preview?.lateFees)}
```

And update the button label:

```tsx
{isGenerating
  ? 'Generating...'
  : `Generate ${(preview?.eligible ?? 0) + (preview?.lateFees ?? 0)} Invoice(s)`}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/billing/generate-invoices-dialog.tsx
git commit -m "feat: show late fee count in invoice generation dialog"
```

---

### Task 14: Apply Migration and Verify

- [ ] **Step 1: Push migration to Supabase**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && npx supabase db push`
Expected: Migration 012 applies successfully.

- [ ] **Step 2: Build the application**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm build`
Expected: Clean build with no errors.

- [ ] **Step 3: Manual verification**

Run: `cd C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal && pnpm dev`

Verify:
1. Open a lease dialog — see the new "Auto Month-to-Month" toggle, "Additional Charges" section, and "Late Fee Settings"
2. Create a lease with an additional charge (e.g., "Pet Rent" $50 Monthly)
3. Go to Incoming → Generate Invoices → verify the preview shows the correct count (rent + charges)
4. Generate invoices → verify multiple invoices created (one for rent, one for the charge)
5. Let an invoice go overdue, configure late fees on the lease, regenerate → verify late fee invoice created

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during verification"
```

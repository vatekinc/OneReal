# Tenant Credits Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a credits system that lets landlords issue credits (manual, overpayment, advance payment) to tenants and manually apply them to future invoices.

**Architecture:** New `credits` and `credit_applications` tables with transactional RPC functions for applying credits and recording overpayments. Credits are tenant-scoped with optional lease binding. UI lives in a new Accounting > Credits tab plus a widget on the tenant detail page.

**Tech Stack:** Supabase (PostgreSQL), Next.js server actions, React Query, shadcn/ui, Zod, react-hook-form

**Spec:** `docs/superpowers/specs/2026-03-26-tenant-credits-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260326000001_credits.sql` | Credits + credit_applications tables, indexes, RLS, RPC functions |
| `packages/types/src/models.ts` (modify) | Add Credit, CreditApplication interfaces |
| `modules/billing/src/schemas/credit-schema.ts` | Zod schemas for credit creation + application |
| `modules/billing/src/actions/create-credit.ts` | Server action: create manual / advance payment credit |
| `modules/billing/src/actions/apply-credit.ts` | Server action: call apply_credits_to_invoice RPC |
| `modules/billing/src/actions/void-credit.ts` | Server action: call void_credit RPC |
| `modules/billing/src/hooks/use-credits.ts` | React Query hooks for credits data |
| `apps/web/components/billing/credit-dialog.tsx` | Dialog for creating new credits |
| `apps/web/components/billing/apply-credit-dialog.tsx` | Dialog for applying credits to an invoice |
| `apps/web/components/billing/credit-table.tsx` | Table component for credits list |
| `apps/web/components/contacts/tenant-credit-widget.tsx` | Credit balance widget for tenant detail page |
| `apps/web/app/(dashboard)/accounting/credits/page.tsx` | Credits tab page |

### Modified Files
| File | Change |
|------|--------|
| `modules/billing/src/actions/record-payment.ts` | Allow overpayments, call new RPC |
| `modules/billing/src/actions/void-invoice.ts` | Reverse credit applications before voiding |
| `modules/billing/src/index.ts` | Export new schemas + hooks |
| `apps/web/components/dashboard/sidebar.tsx` | Add Credits nav link under Accounting |
| `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx` | Add credit widget |
| `apps/web/app/(dashboard)/accounting/incoming/page.tsx` | Add "Apply Credit" action |
| `apps/web/components/billing/invoice-table.tsx` | Add "Apply Credit" row action |

---

## Chunk 1: Database Migration + Types

### Task 1: Create Migration File

**Files:**
- Create: `supabase/migrations/20260326000001_credits.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ============================================================
-- Migration: Credits system (credits + credit_applications)
-- ============================================================

-- ============================================================
-- Update income_type constraint to allow 'advance_payment'
-- ============================================================
ALTER TABLE public.income DROP CONSTRAINT IF EXISTS income_income_type_check;
ALTER TABLE public.income ADD CONSTRAINT income_income_type_check
  CHECK (income_type IN ('rent', 'deposit', 'late_fee', 'advance_payment', 'other'));

-- ============================================================
-- Add CHECK constraint on invoices.amount_paid
-- ============================================================
ALTER TABLE public.invoices ADD CONSTRAINT invoices_amount_paid_check
  CHECK (amount_paid <= amount);

-- ============================================================
-- Credits table
-- ============================================================
CREATE TABLE public.credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  amount_used DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (amount_used >= 0),
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'overpayment', 'advance_payment')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_applied', 'void')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credits_amount_used_lte_amount CHECK (amount_used <= amount)
);

CREATE INDEX idx_credits_org_tenant ON public.credits(org_id, tenant_id);
CREATE INDEX idx_credits_org_status ON public.credits(org_id, status);
CREATE INDEX idx_credits_org_property ON public.credits(org_id, property_id);

CREATE TRIGGER handle_credits_updated_at
  BEFORE UPDATE ON public.credits
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Credit Applications table
-- ============================================================
CREATE TABLE public.credit_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES public.credits(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  applied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_applications_credit ON public.credit_applications(credit_id);
CREATE INDEX idx_credit_applications_invoice ON public.credit_applications(invoice_id);
CREATE INDEX idx_credit_applications_org ON public.credit_applications(org_id);

-- ============================================================
-- RLS — Credits
-- ============================================================
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credits in their orgs"
  ON public.credits FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert credits"
  ON public.credits FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update credits"
  ON public.credits FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete credits"
  ON public.credits FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RLS — Credit Applications
-- ============================================================
ALTER TABLE public.credit_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credit applications in their orgs"
  ON public.credit_applications FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert credit applications"
  ON public.credit_applications FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update credit applications"
  ON public.credit_applications FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete credit applications"
  ON public.credit_applications FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ============================================================
-- RPC: get_tenant_credit_balance
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tenant_credit_balance(
  p_org_id UUID,
  p_tenant_id UUID,
  p_lease_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_credits NUMERIC,
  total_used NUMERIC,
  available_balance NUMERIC,
  active_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(c.amount), 0)::NUMERIC AS total_credits,
    COALESCE(SUM(c.amount_used), 0)::NUMERIC AS total_used,
    COALESCE(SUM(c.amount - c.amount_used), 0)::NUMERIC AS available_balance,
    COUNT(*)::INTEGER AS active_count
  FROM public.credits c
  WHERE c.org_id = p_org_id
    AND c.tenant_id = p_tenant_id
    AND c.status = 'active'
    AND (p_lease_id IS NULL OR c.lease_id IS NULL OR c.lease_id = p_lease_id);
END;
$$;

-- ============================================================
-- RPC: apply_credits_to_invoice
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_credits_to_invoice(
  p_org_id UUID,
  p_invoice_id UUID,
  p_applications JSONB,
  p_applied_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice RECORD;
  v_credit RECORD;
  v_app JSONB;
  v_apply_amount DECIMAL(10,2);
  v_total_applied DECIMAL(10,2) := 0;
  v_invoice_remaining DECIMAL(10,2);
  v_credit_remaining DECIMAL(10,2);
  v_new_amount_paid DECIMAL(10,2);
  v_new_status TEXT;
BEGIN
  -- Lock and fetch invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status IN ('void', 'draft') THEN
    RAISE EXCEPTION 'Cannot apply credits to a % invoice', v_invoice.status;
  END IF;

  v_invoice_remaining := v_invoice.amount - v_invoice.amount_paid;

  -- Process each credit application
  FOR v_app IN SELECT * FROM jsonb_array_elements(p_applications)
  LOOP
    v_apply_amount := (v_app->>'amount')::DECIMAL(10,2);

    IF v_apply_amount <= 0 THEN
      RAISE EXCEPTION 'Application amount must be positive';
    END IF;

    -- Lock and fetch credit
    SELECT * INTO v_credit
    FROM public.credits
    WHERE id = (v_app->>'credit_id')::UUID
      AND org_id = p_org_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credit % not found or not active', v_app->>'credit_id';
    END IF;

    -- Validate credit belongs to same tenant
    IF v_credit.tenant_id != v_invoice.tenant_id THEN
      RAISE EXCEPTION 'Credit tenant does not match invoice tenant';
    END IF;

    -- Validate lease scope
    IF v_credit.lease_id IS NOT NULL AND v_credit.lease_id != v_invoice.lease_id THEN
      RAISE EXCEPTION 'Lease-scoped credit does not match invoice lease';
    END IF;

    v_credit_remaining := v_credit.amount - v_credit.amount_used;

    IF v_apply_amount > v_credit_remaining THEN
      RAISE EXCEPTION 'Application amount % exceeds credit remaining %', v_apply_amount, v_credit_remaining;
    END IF;

    v_total_applied := v_total_applied + v_apply_amount;

    IF v_total_applied > v_invoice_remaining THEN
      RAISE EXCEPTION 'Total applied % exceeds invoice remaining %', v_total_applied, v_invoice_remaining;
    END IF;

    -- Insert credit application
    INSERT INTO public.credit_applications (org_id, credit_id, invoice_id, amount, applied_by)
    VALUES (p_org_id, v_credit.id, p_invoice_id, v_apply_amount, p_applied_by);

    -- Update credit
    UPDATE public.credits
    SET amount_used = amount_used + v_apply_amount,
        status = CASE WHEN amount_used + v_apply_amount >= amount THEN 'fully_applied' ELSE 'active' END
    WHERE id = v_credit.id;
  END LOOP;

  -- Update invoice
  v_new_amount_paid := v_invoice.amount_paid + v_total_applied;
  v_new_status := CASE WHEN v_new_amount_paid >= v_invoice.amount THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET amount_paid = v_new_amount_paid, status = v_new_status
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('total_applied', v_total_applied, 'new_status', v_new_status);
END;
$$;

-- ============================================================
-- RPC: record_payment_with_overpayment
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_payment_with_overpayment(
  p_org_id UUID,
  p_invoice_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_method TEXT,
  p_payment_date DATE,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice RECORD;
  v_remaining DECIMAL(10,2);
  v_invoice_payment DECIMAL(10,2);
  v_excess DECIMAL(10,2);
  v_income_type TEXT;
  v_income_id UUID;
  v_expense_id UUID;
  v_payment_id UUID;
  v_credit_id UUID := NULL;
BEGIN
  -- Lock and fetch invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status IN ('void', 'paid') THEN
    RAISE EXCEPTION 'Cannot pay a % invoice', v_invoice.status;
  END IF;

  v_remaining := v_invoice.amount - v_invoice.amount_paid;

  -- Reject overpayments on payable invoices (credits only apply to receivables)
  IF v_invoice.direction = 'payable' AND p_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment exceeds remaining balance of %', v_remaining;
  END IF;

  v_invoice_payment := LEAST(p_amount, v_remaining);
  v_excess := GREATEST(p_amount - v_remaining, 0);

  -- Create income or expense record
  IF v_invoice.direction = 'receivable' THEN
    v_income_type := CASE
      WHEN LOWER(COALESCE(v_invoice.description, '')) LIKE '%rent%' THEN 'rent'
      WHEN LOWER(COALESCE(v_invoice.description, '')) LIKE '%deposit%' THEN 'deposit'
      ELSE 'other'
    END;

    INSERT INTO public.income (org_id, property_id, unit_id, amount, income_type, description, transaction_date)
    VALUES (p_org_id, v_invoice.property_id, v_invoice.unit_id, p_amount, v_income_type,
            'Payment for ' || v_invoice.invoice_number, p_payment_date)
    RETURNING id INTO v_income_id;
  ELSE
    INSERT INTO public.expenses (org_id, property_id, unit_id, amount, expense_type, description, transaction_date, provider_id)
    VALUES (p_org_id, v_invoice.property_id, v_invoice.unit_id, p_amount,
            COALESCE(v_invoice.expense_type, 'other'),
            'Payment for ' || v_invoice.invoice_number, p_payment_date, v_invoice.provider_id)
    RETURNING id INTO v_expense_id;
  END IF;

  -- Create payment record
  INSERT INTO public.payments (org_id, invoice_id, amount, payment_date, payment_method, reference_number, notes, income_id, expense_id)
  VALUES (p_org_id, p_invoice_id, p_amount, p_payment_date, p_payment_method, p_reference_number, p_notes, v_income_id, v_expense_id)
  RETURNING id INTO v_payment_id;

  -- Update invoice
  UPDATE public.invoices
  SET amount_paid = amount_paid + v_invoice_payment,
      status = CASE WHEN amount_paid + v_invoice_payment >= amount THEN 'paid' ELSE 'partially_paid' END
  WHERE id = p_invoice_id;

  -- Create overpayment credit if excess
  IF v_excess > 0 AND v_invoice.direction = 'receivable' THEN
    INSERT INTO public.credits (org_id, tenant_id, lease_id, property_id, amount, reason, source, invoice_id, created_by)
    VALUES (
      p_org_id,
      v_invoice.tenant_id,
      v_invoice.lease_id,
      v_invoice.property_id,
      v_excess,
      'Overpayment on invoice ' || v_invoice.invoice_number,
      'overpayment',
      p_invoice_id,
      p_user_id
    )
    RETURNING id INTO v_credit_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'credit_id', v_credit_id,
    'overpayment_amount', v_excess
  );
END;
$$;

-- ============================================================
-- RPC: void_credit
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_credit(
  p_org_id UUID,
  p_credit_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit RECORD;
BEGIN
  SELECT * INTO v_credit
  FROM public.credits
  WHERE id = p_credit_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found';
  END IF;

  IF v_credit.status = 'void' THEN
    RAISE EXCEPTION 'Credit is already void';
  END IF;

  UPDATE public.credits
  SET status = 'void'
  WHERE id = p_credit_id;
END;
$$;

-- ============================================================
-- RPC: reverse_invoice_credit_applications
-- Used by void-invoice when invoice has credit applications
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_invoice_credit_applications(
  p_org_id UUID,
  p_invoice_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_app RECORD;
  v_count INTEGER := 0;
  v_total_reversed DECIMAL(10,2) := 0;
BEGIN
  FOR v_app IN
    SELECT * FROM public.credit_applications
    WHERE invoice_id = p_invoice_id AND org_id = p_org_id AND status = 'active'
    FOR UPDATE
  LOOP
    -- Reverse the credit application
    UPDATE public.credit_applications
    SET status = 'reversed', reversed_at = now()
    WHERE id = v_app.id;

    -- Restore credit balance
    UPDATE public.credits
    SET amount_used = amount_used - v_app.amount,
        status = 'active'
    WHERE id = v_app.credit_id;

    v_total_reversed := v_total_reversed + v_app.amount;
    v_count := v_count + 1;
  END LOOP;

  -- Reset invoice amount_paid by the accumulated reversed amount
  IF v_total_reversed > 0 THEN
    UPDATE public.invoices
    SET amount_paid = amount_paid - v_total_reversed
    WHERE id = p_invoice_id;
  END IF;

  RETURN v_count;
END;
$$;
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `npx supabase db push` (or apply via Supabase dashboard)
Expected: Migration applies successfully, tables and functions created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260326000001_credits.sql
git commit -m "feat(credits): add credits + credit_applications tables and RPC functions"
```

---

### Task 2: Add TypeScript Interfaces

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add Credit and CreditApplication interfaces**

Add after the existing `Payment` interface:

```typescript
export interface Credit {
  id: string;
  org_id: string;
  tenant_id: string;
  lease_id: string | null;
  property_id: string | null;
  amount: number;
  amount_used: number;
  reason: string;
  source: 'manual' | 'overpayment' | 'advance_payment';
  invoice_id: string | null;
  status: 'active' | 'fully_applied' | 'void';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  tenant?: Tenant;
  lease?: Lease;
  property?: Property;
}

export interface CreditApplication {
  id: string;
  org_id: string;
  credit_id: string;
  invoice_id: string;
  amount: number;
  status: 'active' | 'reversed';
  applied_by: string | null;
  applied_at: string;
  reversed_at: string | null;
  created_at: string;
  // Joined fields
  credit?: Credit;
  invoice?: Invoice;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat(credits): add Credit and CreditApplication type interfaces"
```

---

## Chunk 2: Schemas + Server Actions

### Task 3: Create Credit Schemas

**Files:**
- Create: `modules/billing/src/schemas/credit-schema.ts`

- [ ] **Step 1: Write the Zod schemas**

```typescript
import { z } from 'zod';

export const creditSchema = z.object({
  source: z.enum(['manual', 'advance_payment']),
  tenant_id: z.string().uuid('Select a tenant'),
  lease_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  reason: z.string().min(1, 'Reason is required'),
  payment_method: z.string().optional().nullable(),
});

export type CreditFormValues = z.infer<typeof creditSchema>;

export const applyCreditSchema = z.object({
  invoice_id: z.string().uuid(),
  applications: z.array(z.object({
    credit_id: z.string().uuid(),
    amount: z.coerce.number().positive('Amount must be positive'),
  })).min(1, 'Select at least one credit'),
});

export type ApplyCreditFormValues = z.infer<typeof applyCreditSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/schemas/credit-schema.ts
git commit -m "feat(credits): add Zod schemas for credit creation and application"
```

---

### Task 4: Create Credit Server Action

**Files:**
- Create: `modules/billing/src/actions/create-credit.ts`

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { creditSchema, type CreditFormValues } from '../schemas/credit-schema';

export async function createCredit(
  orgId: string,
  values: CreditFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = creditSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // For advance_payment, create income record immediately
    let incomeId: string | null = null;
    if (parsed.data.source === 'advance_payment') {
      // Determine property_id: from form or from tenant's active lease
      let propertyId = parsed.data.property_id;
      if (!propertyId && parsed.data.lease_id) {
        const { data: lease } = await db
          .from('leases')
          .select('unit_id, units(property_id)')
          .eq('id', parsed.data.lease_id)
          .single();
        propertyId = lease?.units?.property_id ?? null;
      }

      if (propertyId) {
        const { data: incomeRow, error: incomeError } = await db
          .from('income')
          .insert({
            org_id: orgId,
            property_id: propertyId,
            amount: parsed.data.amount,
            income_type: 'advance_payment',
            description: `Advance payment credit: ${parsed.data.reason}`,
            transaction_date: new Date().toISOString().split('T')[0],
          })
          .select('id')
          .single();

        if (incomeError) return { success: false, error: incomeError.message };
        incomeId = incomeRow.id;
      }
    }

    const { data, error } = await db
      .from('credits')
      .insert({
        org_id: orgId,
        tenant_id: parsed.data.tenant_id,
        lease_id: parsed.data.lease_id || null,
        property_id: parsed.data.property_id || null,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        source: parsed.data.source,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      // Rollback: delete orphaned income record if credit insert failed
      if (incomeId) {
        await db.from('income').delete().eq('id', incomeId);
      }
      return { success: false, error: error.message };
    }
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create credit' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/create-credit.ts
git commit -m "feat(credits): add create-credit server action"
```

---

### Task 5: Apply Credit Server Action

**Files:**
- Create: `modules/billing/src/actions/apply-credit.ts`

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { applyCreditSchema, type ApplyCreditFormValues } from '../schemas/credit-schema';

export async function applyCredits(
  orgId: string,
  values: ApplyCreditFormValues
): Promise<ActionResult<{ total_applied: number; new_status: string }>> {
  try {
    const parsed = applyCreditSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('apply_credits_to_invoice', {
      p_org_id: orgId,
      p_invoice_id: parsed.data.invoice_id,
      p_applications: parsed.data.applications,
      p_applied_by: user.id,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data };
  } catch {
    return { success: false, error: 'Failed to apply credits' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/apply-credit.ts
git commit -m "feat(credits): add apply-credit server action"
```

---

### Task 6: Void Credit Server Action

**Files:**
- Create: `modules/billing/src/actions/void-credit.ts`

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function voidCredit(id: string, orgId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db.rpc('void_credit', {
      p_org_id: orgId,
      p_credit_id: id,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to void credit' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/void-credit.ts
git commit -m "feat(credits): add void-credit server action"
```

---

### Task 7: Modify Record Payment for Overpayments

**Files:**
- Modify: `modules/billing/src/actions/record-payment.ts`

- [ ] **Step 1: Replace the current implementation to use the RPC**

Replace the entire body of `recordPayment` with:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { paymentSchema, type PaymentFormValues } from '../schemas/payment-schema';

export async function recordPayment(
  orgId: string,
  values: PaymentFormValues
): Promise<ActionResult<{ id: string; credit_id?: string; overpayment_amount?: number }>> {
  try {
    const parsed = paymentSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('record_payment_with_overpayment', {
      p_org_id: orgId,
      p_invoice_id: parsed.data.invoice_id,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.payment_method,
      p_payment_date: parsed.data.payment_date,
      p_reference_number: parsed.data.reference_number || null,
      p_notes: parsed.data.notes || null,
      p_user_id: user.id,
    });

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        id: data.payment_id,
        credit_id: data.credit_id,
        overpayment_amount: data.overpayment_amount,
      },
    };
  } catch {
    return { success: false, error: 'Failed to record payment' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/record-payment.ts
git commit -m "feat(credits): use transactional RPC for payments, support overpayments"
```

---

### Task 8: Modify Void Invoice for Credit Reversals

**Files:**
- Modify: `modules/billing/src/actions/void-invoice.ts`

- [ ] **Step 1: Update to reverse credit applications before voiding**

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

    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid, status, org_id')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (invoice.status === 'void') {
      return { success: false, error: 'Invoice is already void' };
    }

    // Check for credit applications and reverse them
    const { data: creditApps } = await db
      .from('credit_applications')
      .select('id')
      .eq('invoice_id', id)
      .eq('status', 'active');

    if (creditApps && creditApps.length > 0) {
      const { error: reverseError } = await db.rpc('reverse_invoice_credit_applications', {
        p_org_id: invoice.org_id,
        p_invoice_id: id,
      });
      if (reverseError) return { success: false, error: reverseError.message };
    }

    // Re-fetch invoice after potential credit reversal
    const { data: updatedInvoice } = await db
      .from('invoices')
      .select('amount_paid')
      .eq('id', id)
      .single();

    // Block void if there are still cash payments
    if (Number(updatedInvoice.amount_paid) > 0) {
      return { success: false, error: 'Cannot void an invoice that has cash payments. Remove payments first.' };
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

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/void-invoice.ts
git commit -m "feat(credits): reverse credit applications when voiding invoice"
```

---

### Task 9: Create Credits Hook + Update Module Exports

**Files:**
- Create: `modules/billing/src/hooks/use-credits.ts`
- Modify: `modules/billing/src/index.ts`

- [ ] **Step 1: Write the credits hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface CreditFilters {
  orgId: string | null;
  tenantId?: string;
  propertyId?: string;
  status?: string;
  source?: string;
}

export function useCredits(filters: CreditFilters) {
  return useQuery({
    queryKey: ['credits', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('credits')
        .select('*, tenants(first_name, last_name), properties(name), leases(start_date, end_date)')
        .eq('org_id', filters.orgId)
        .order('created_at', { ascending: false });

      if (filters.tenantId) {
        query = query.eq('tenant_id', filters.tenantId);
      }
      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.source && filters.source !== 'all') {
        query = query.eq('source', filters.source);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

export function useTenantCreditBalance(orgId: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['credit-balance', orgId, tenantId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any).rpc('get_tenant_credit_balance', {
        p_org_id: orgId,
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      return data?.[0] ?? { total_credits: 0, total_used: 0, available_balance: 0, active_count: 0 };
    },
    enabled: !!orgId && !!tenantId,
  });
}

export function useCreditApplications(invoiceId: string | null) {
  return useQuery({
    queryKey: ['credit-applications', invoiceId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('credit_applications')
        .select('*, credits(reason, source, tenant_id)')
        .eq('invoice_id', invoiceId)
        .eq('status', 'active')
        .order('applied_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!invoiceId,
  });
}
```

- [ ] **Step 2: Update module barrel exports**

Add to `modules/billing/src/index.ts`:

```typescript
export { creditSchema, applyCreditSchema, type CreditFormValues, type ApplyCreditFormValues } from './schemas/credit-schema';
export { useCredits, useTenantCreditBalance, useCreditApplications, type CreditFilters } from './hooks/use-credits';
```

- [ ] **Step 3: Commit**

```bash
git add modules/billing/src/hooks/use-credits.ts modules/billing/src/index.ts
git commit -m "feat(credits): add credits hooks and update module exports"
```

---

## Chunk 3: UI Components

### Task 10: Credit Table Component

**Files:**
- Create: `apps/web/components/billing/credit-table.tsx`

- [ ] **Step 1: Write the credit table**

```typescript
'use client';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@onereal/ui';
import { MoreHorizontal } from 'lucide-react';
import type { Credit } from '@onereal/types';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance Payment',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  fully_applied: 'bg-blue-100 text-blue-800',
  void: 'bg-gray-100 text-gray-800',
};

interface CreditTableProps {
  credits: any[];
  onVoid: (credit: any) => void;
  onApply: (credit: any) => void;
}

export function CreditTable({ credits, onVoid, onApply }: CreditTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Used</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credits.map((credit: any) => {
            const remaining = Number(credit.amount) - Number(credit.amount_used);
            return (
              <TableRow key={credit.id}>
                <TableCell>{new Date(credit.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {credit.tenants ? `${credit.tenants.first_name} ${credit.tenants.last_name}` : '\u2014'}
                </TableCell>
                <TableCell>{credit.properties?.name ?? '\u2014'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{sourceLabels[credit.source] ?? credit.source}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">${Number(credit.amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">${Number(credit.amount_used).toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">${remaining.toFixed(2)}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusColors[credit.status] ?? ''}`}>
                    {credit.status.replace('_', ' ')}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {credit.status === 'active' && remaining > 0 && (
                        <DropdownMenuItem onClick={() => onApply(credit)}>
                          Apply to Invoice
                        </DropdownMenuItem>
                      )}
                      {credit.status === 'active' && (
                        <DropdownMenuItem className="text-destructive" onClick={() => onVoid(credit)}>
                          Void Credit
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
git add apps/web/components/billing/credit-table.tsx
git commit -m "feat(credits): add CreditTable component"
```

---

### Task 11: New Credit Dialog

**Files:**
- Create: `apps/web/components/billing/credit-dialog.tsx`

- [ ] **Step 1: Write the credit creation dialog**

```typescript
'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { creditSchema, type CreditFormValues } from '@onereal/billing';
import { createCredit } from '@onereal/billing/actions/create-credit';
import { useUser } from '@onereal/auth';
import { useTenants, useLeases } from '@onereal/contacts';
import { useProperties } from '@onereal/portfolio';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTenantId?: string;
}

export function CreditDialog({ open, onOpenChange, defaultTenantId }: CreditDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  const form = useForm<CreditFormValues>({
    resolver: zodResolver(creditSchema),
    defaultValues: {
      source: 'manual',
      tenant_id: defaultTenantId ?? '',
      lease_id: null,
      property_id: null,
      amount: 0,
      reason: '',
      payment_method: null,
    },
  });

  const selectedTenantId = form.watch('tenant_id');

  const { data: leasesData } = useLeases({
    orgId: activeOrg?.id ?? null,
    tenantId: selectedTenantId || undefined,
  });
  const leases = (leasesData ?? []) as any[];

  useEffect(() => {
    if (open) {
      form.reset({
        source: 'manual',
        tenant_id: defaultTenantId ?? '',
        lease_id: null,
        property_id: null,
        amount: 0,
        reason: '',
        payment_method: null,
      });
    }
  }, [open, defaultTenantId, form]);

  async function onSubmit(values: CreditFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = await createCredit(activeOrg.id, values);

    if (result.success) {
      toast.success('Credit created');
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  const source = form.watch('source');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Credit</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="source" render={({ field }) => (
              <FormItem>
                <FormLabel>Credit Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="manual">Manual Credit</SelectItem>
                    <SelectItem value="advance_payment">Advance Payment</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="tenant_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Tenant *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {tenants.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.first_name} {t.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {leases.length > 0 && (
              <FormField control={form.control} name="lease_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope to Lease (optional)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value ?? 'none'}>
                    <FormControl><SelectTrigger><SelectValue placeholder="All leases (tenant-scoped)" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">All leases (tenant-scoped)</SelectItem>
                      {leases.map((l: any) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.units?.properties?.name ?? 'Property'} — {l.units?.unit_number ?? 'Unit'} ({l.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {source === 'advance_payment' && (
                <FormField control={form.control} name="payment_method" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </div>

            <FormField control={form.control} name="reason" render={({ field }) => (
              <FormItem>
                <FormLabel>Reason / Notes *</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder={source === 'advance_payment' ? 'e.g., April rent paid in advance' : 'e.g., Maintenance inconvenience discount'} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Create Credit</Button>
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
git add apps/web/components/billing/credit-dialog.tsx
git commit -m "feat(credits): add CreditDialog component"
```

---

### Task 12: Apply Credit Dialog

**Files:**
- Create: `apps/web/components/billing/apply-credit-dialog.tsx`

- [ ] **Step 1: Write the apply credit dialog**

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useCredits } from '@onereal/billing';
import { applyCredits } from '@onereal/billing/actions/apply-credit';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Badge, Input, Checkbox,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Invoice } from '@onereal/types';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance',
};

interface ApplyCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export function ApplyCreditDialog({ open, onOpenChange, invoice }: ApplyCreditDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const { data: creditsRaw } = useCredits({
    orgId: activeOrg?.id ?? null,
    tenantId: invoice?.tenant_id ?? undefined,
    status: 'active',
  });

  // Filter by lease scope: show tenant-scoped (no lease_id) + matching lease_id
  const availableCredits = (creditsRaw ?? []).filter((c: any) => {
    if (Number(c.amount) - Number(c.amount_used) <= 0) return false;
    if (!c.lease_id) return true; // tenant-scoped
    return c.lease_id === invoice?.lease_id; // lease-scoped must match
  });

  const invoiceRemaining = invoice ? Number(invoice.amount) - Number(invoice.amount_paid) : 0;

  const [selections, setSelections] = useState<Record<string, number>>({});

  function toggleCredit(creditId: string, creditRemaining: number) {
    setSelections((prev) => {
      if (prev[creditId] !== undefined) {
        const next = { ...prev };
        delete next[creditId];
        return next;
      }
      return { ...prev, [creditId]: Math.min(creditRemaining, invoiceRemaining - totalSelected(prev)) };
    });
  }

  function updateAmount(creditId: string, amount: number) {
    setSelections((prev) => ({ ...prev, [creditId]: amount }));
  }

  function totalSelected(sels: Record<string, number> = selections) {
    return Object.values(sels).reduce((sum, v) => sum + v, 0);
  }

  async function handleApply() {
    if (!activeOrg || !invoice) return;

    const applications = Object.entries(selections)
      .filter(([, amount]) => amount > 0)
      .map(([credit_id, amount]) => ({ credit_id, amount }));

    if (applications.length === 0) {
      toast.error('Select at least one credit to apply');
      return;
    }

    const result = await applyCredits(activeOrg.id, {
      invoice_id: invoice.id,
      applications,
    });

    if (result.success) {
      toast.success(`$${totalSelected().toFixed(2)} credit applied`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['credit-applications'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      setSelections({});
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setSelections({}); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply Credit</DialogTitle>
          {invoice && (
            <DialogDescription>
              {invoice.invoice_number} — Remaining: ${invoiceRemaining.toFixed(2)}
            </DialogDescription>
          )}
        </DialogHeader>

        {availableCredits.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No credits available for this tenant.</p>
        ) : (
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {availableCredits.map((credit: any) => {
              const remaining = Number(credit.amount) - Number(credit.amount_used);
              const isSelected = selections[credit.id] !== undefined;
              return (
                <div key={credit.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleCredit(credit.id, remaining)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{sourceLabels[credit.source]}</Badge>
                      <span className="text-sm font-medium">${remaining.toFixed(2)} available</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{credit.reason}</p>
                  </div>
                  {isSelected && (
                    <Input
                      type="number"
                      step="0.01"
                      min={0.01}
                      max={Math.min(remaining, invoiceRemaining)}
                      value={selections[credit.id]}
                      onChange={(e) => updateAmount(credit.id, Number(e.target.value))}
                      className="w-24"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {availableCredits.length > 0 && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm font-medium">
              Total: ${totalSelected().toFixed(2)} of ${invoiceRemaining.toFixed(2)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setSelections({}); onOpenChange(false); }}>Cancel</Button>
              <Button onClick={handleApply} disabled={totalSelected() <= 0 || totalSelected() > invoiceRemaining}>
                Apply Credit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/billing/apply-credit-dialog.tsx
git commit -m "feat(credits): add ApplyCreditDialog component"
```

---

### Task 13: Tenant Credit Widget

**Files:**
- Create: `apps/web/components/contacts/tenant-credit-widget.tsx`

- [ ] **Step 1: Write the widget**

```typescript
'use client';

import { useState } from 'react';
import { useTenantCreditBalance, useCredits } from '@onereal/billing';
import { useUser } from '@onereal/auth';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@onereal/ui';
import { CreditCard, Plus } from 'lucide-react';
import Link from 'next/link';
import { CreditDialog } from '@/components/billing/credit-dialog';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance',
};

interface TenantCreditWidgetProps {
  tenantId: string;
}

export function TenantCreditWidget({ tenantId }: TenantCreditWidgetProps) {
  const { activeOrg } = useUser();
  const { data: balance } = useTenantCreditBalance(activeOrg?.id ?? null, tenantId);
  const { data: credits } = useCredits({
    orgId: activeOrg?.id ?? null,
    tenantId,
    status: 'active',
  });

  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  const activeCredits = (credits ?? []).filter((c: any) =>
    Number(c.amount) - Number(c.amount_used) > 0
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" /> Credits
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setCreditDialogOpen(true)}>
            <Plus className="h-3 w-3" /> New Credit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <p className="text-2xl font-bold">
              ${Number(balance?.available_balance ?? 0).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Available balance ({balance?.active_count ?? 0} active credit{(balance?.active_count ?? 0) !== 1 ? 's' : ''})
            </p>
          </div>

          {activeCredits.length > 0 && (
            <div className="space-y-2">
              {activeCredits.slice(0, 3).map((credit: any) => {
                const remaining = Number(credit.amount) - Number(credit.amount_used);
                return (
                  <div key={credit.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{sourceLabels[credit.source]}</Badge>
                      <span className="text-muted-foreground truncate max-w-[150px]">{credit.reason}</span>
                    </div>
                    <span className="font-medium">${remaining.toFixed(2)}</span>
                  </div>
                );
              })}
              {activeCredits.length > 3 && (
                <Link href={`/accounting/credits?tenant=${tenantId}`} className="text-xs text-primary hover:underline">
                  View all {activeCredits.length} credits →
                </Link>
              )}
            </div>
          )}

          {activeCredits.length === 0 && (
            <p className="text-sm text-muted-foreground">No active credits</p>
          )}
        </CardContent>
      </Card>

      <CreditDialog
        open={creditDialogOpen}
        onOpenChange={setCreditDialogOpen}
        defaultTenantId={tenantId}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/contacts/tenant-credit-widget.tsx
git commit -m "feat(credits): add TenantCreditWidget component"
```

---

## Chunk 4: Pages + Integration

### Task 14: Credits Page

**Files:**
- Create: `apps/web/app/(dashboard)/accounting/credits/page.tsx`

- [ ] **Step 1: Write the credits page**

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useCredits } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useTenants } from '@onereal/contacts';
import { voidCredit } from '@onereal/billing/actions/void-credit';
import { CreditTable } from '@/components/billing/credit-table';
import { CreditDialog } from '@/components/billing/credit-dialog';
import {
  Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
} from '@onereal/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type TabValue = 'active' | 'fully_applied' | 'void' | 'all';

export default function CreditsPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('active');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: credits, isLoading } = useCredits({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    tenantId: tenantFilter || undefined,
    status: statusFilter,
    source: sourceFilter || undefined,
  });

  async function handleVoid(credit: any) {
    if (!activeOrg) return;
    if (!confirm('Void this credit? Remaining balance will be forfeited.')) return;
    const result = await voidCredit(credit.id, activeOrg.id);
    if (result.success) {
      toast.success('Credit voided');
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleApply(_credit: any) {
    // For now, navigate to incoming page where they can apply from the invoice side
    toast.info('Use "Apply Credit" from the invoice row in Incoming to apply credits.');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Credits</h1>
        <Button className="gap-2" onClick={() => setCreditDialogOpen(true)}>
          <Plus className="h-4 w-4" /> New Credit
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="fully_applied">Applied</TabsTrigger>
          <TabsTrigger value="void">Void</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={tenantFilter} onValueChange={(v) => setTenantFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Sources" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="overpayment">Overpayment</SelectItem>
            <SelectItem value="advance_payment">Advance Payment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (credits ?? []).length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No credits found</p>
          <Button onClick={() => setCreditDialogOpen(true)}>Create your first credit</Button>
        </div>
      ) : (
        <CreditTable credits={credits ?? []} onVoid={handleVoid} onApply={handleApply} />
      )}

      <CreditDialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/accounting/credits/page.tsx"
git commit -m "feat(credits): add Credits page under Accounting"
```

---

### Task 15: Add Credits to Sidebar Navigation

**Files:**
- Modify: `apps/web/components/dashboard/sidebar.tsx:33-40`

- [ ] **Step 1: Add Credits child nav item**

In the `navItems` array, find the Accounting children array and add Credits:

```typescript
  {
    label: 'Accounting', href: '/accounting', icon: Calculator,
    children: [
      { label: 'Overview', href: '/accounting' },
      { label: 'Incoming', href: '/accounting/incoming' },
      { label: 'Outgoing', href: '/accounting/outgoing' },
      { label: 'Credits', href: '/accounting/credits' },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/dashboard/sidebar.tsx
git commit -m "feat(credits): add Credits link to sidebar navigation"
```

---

### Task 16: Add Credit Widget to Tenant Detail Page

**Files:**
- Modify: `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx`

- [ ] **Step 1: Import the widget**

Add import at top of file:

```typescript
import { TenantCreditWidget } from '@/components/contacts/tenant-credit-widget';
```

- [ ] **Step 2: Add widget between Contact Information card and Leases section**

After the closing `</Card>` of the Contact Information card (around line 158), add:

```tsx
      <TenantCreditWidget tenantId={id} />
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx"
git commit -m "feat(credits): add credit widget to tenant detail page"
```

---

### Task 17: Add "Apply Credit" to Incoming Page

**Files:**
- Modify: `apps/web/app/(dashboard)/accounting/incoming/page.tsx`

- [ ] **Step 1: Import ApplyCreditDialog**

Add import:

```typescript
import { ApplyCreditDialog } from '@/components/billing/apply-credit-dialog';
```

- [ ] **Step 2: Add state for apply credit dialog**

Add alongside other dialog states:

```typescript
const [applyCreditDialogOpen, setApplyCreditDialogOpen] = useState(false);
```

- [ ] **Step 3: Add handler function**

```typescript
function handleApplyCredit(invoice: Invoice) {
  setSelectedInvoice(invoice);
  setApplyCreditDialogOpen(true);
}
```

- [ ] **Step 4: Pass handler to InvoiceTable**

Add `onApplyCredit={handleApplyCredit}` prop to `<InvoiceTable>`.

- [ ] **Step 5: Add dialog at bottom of component**

```tsx
<ApplyCreditDialog
  open={applyCreditDialogOpen}
  onOpenChange={setApplyCreditDialogOpen}
  invoice={selectedInvoice}
/>
```

- [ ] **Step 6: Update PaymentDialog to show overpayment toast**

In the `onSubmit` handler of `PaymentDialog` (or the `handlePay` in incoming page), after `result.success`, check for overpayment:

```typescript
if (result.data?.overpayment_amount && result.data.overpayment_amount > 0) {
  toast.success(`Payment recorded. $${result.data.overpayment_amount.toFixed(2)} credit created from overpayment.`);
} else {
  toast.success('Payment recorded');
}
queryClient.invalidateQueries({ queryKey: ['credits'] });
queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
```

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(dashboard)/accounting/incoming/page.tsx"
git commit -m "feat(credits): add Apply Credit action to incoming invoices page"
```

---

### Task 18: Add "Apply Credit" to InvoiceTable Row Actions

**Files:**
- Modify: `apps/web/components/billing/invoice-table.tsx`

- [ ] **Step 1: Add onApplyCredit prop**

Add to the component's props interface:

```typescript
onApplyCredit?: (invoice: Invoice) => void;
```

- [ ] **Step 2: Add dropdown menu item**

In the row action dropdown, add before the Void option (only for receivable, open/partially_paid invoices):

```tsx
{invoice.direction === 'receivable' && (invoice.status === 'open' || invoice.status === 'partially_paid') && onApplyCredit && (
  <DropdownMenuItem onClick={() => onApplyCredit(invoice)}>
    Apply Credit
  </DropdownMenuItem>
)}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/billing/invoice-table.tsx
git commit -m "feat(credits): add Apply Credit row action to invoice table"
```

---

### Task 19: Update Payment Dialog for Overpayments

**Files:**
- Modify: `apps/web/components/billing/payment-dialog.tsx`

- [ ] **Step 1: Remove max amount restriction**

In the `<Input>` for amount (line 105), remove `max={remaining}` to allow overpayments.

- [ ] **Step 2: Update the payment schema validation**

In `modules/billing/src/schemas/payment-schema.ts`, the schema already uses `z.coerce.number().positive()` without a max — no change needed.

- [ ] **Step 3: Handle overpayment response in onSubmit**

Update the success handler in `PaymentDialog` to show overpayment credit notification:

```typescript
if (result.success) {
  if (result.data?.overpayment_amount && result.data.overpayment_amount > 0) {
    toast.success(`Payment recorded. $${result.data.overpayment_amount.toFixed(2)} credit created from overpayment.`);
  } else {
    toast.success('Payment recorded');
  }
  queryClient.invalidateQueries({ queryKey: ['invoices'] });
  queryClient.invalidateQueries({ queryKey: ['payments'] });
  queryClient.invalidateQueries({ queryKey: ['income'] });
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
  queryClient.invalidateQueries({ queryKey: ['credits'] });
  queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
  onOpenChange(false);
} else {
  toast.error(result.error);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/billing/payment-dialog.tsx
git commit -m "feat(credits): allow overpayments and show credit toast in payment dialog"
```

---

### Task 20: Final Integration Commit + Push

- [ ] **Step 1: Run lint check**

```bash
cd apps/web && npx next lint
```

- [ ] **Step 2: Verify the app builds**

```bash
cd apps/web && npx next build
```

- [ ] **Step 3: Push all changes to remote**

```bash
git push
```

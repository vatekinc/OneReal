# Security Deposit Refunds Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement security deposit refunds: track refunds per lease (1:N) with deductions linked to existing expense rows, auto-create paired ledger expense for cash outflow, and prevent over-refund.

**Architecture:** Single migration adds `deposit_refunds` + `deposit_refund_deductions` tables, modifies `expenses` (adds `tenant_id`, `lease_id`, extends `expense_type` enum), and creates four `SECURITY DEFINER` RPCs (`next_deposit_refund_number`, `create_deposit_refund`, `void_deposit_refund`, `get_lease_deposit_summary`). Server actions wrap the RPCs; React Query hooks expose them; UI surfaces on lease detail, tenant detail, and Outgoing pages.

**Tech Stack:** PostgreSQL (Supabase), Next.js 15, TypeScript, React Query (TanStack), react-hook-form + zod, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-06-deposit-refunds-design.md](../specs/2026-05-06-deposit-refunds-design.md)

**Note on testing:** This codebase has no automated test suite for accounting flows. Each task includes a **Manual Smoke Test** step in lieu of `pytest`/`vitest` runs. Verification is by running the dev server and exercising the UI / running SQL in the Supabase SQL editor.

---

## Chunk 1: Database Migration

### Task 1.1: Write the migration file

**Files:**
- Create: `supabase/migrations/20260506000002_deposit_refunds.sql`

- [ ] **Step 1: Create the migration file with full SQL**

Write this exact content:

```sql
-- ============================================================
-- Migration: Security Deposit Refunds
--   - Adds tenant_id + lease_id to expenses (nullable)
--   - Extends expenses.expense_type to include 'deposit_refund'
--   - Creates deposit_refunds + deposit_refund_deductions tables
--   - Creates RPCs: next_deposit_refund_number,
--     create_deposit_refund, void_deposit_refund,
--     get_lease_deposit_summary
-- ============================================================

-- ------------------------------------------------------------
-- 1. Modify expenses table
-- ------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN lease_id  UUID REFERENCES public.leases(id)  ON DELETE SET NULL;

CREATE INDEX idx_expenses_lease ON public.expenses(lease_id);
CREATE INDEX idx_expenses_tenant ON public.expenses(tenant_id);

ALTER TABLE public.expenses DROP CONSTRAINT expenses_expense_type_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_type_check
  CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty',
    'deposit_refund', 'other'
  ));

-- ------------------------------------------------------------
-- 2. deposit_refunds table
-- ------------------------------------------------------------
CREATE TABLE public.deposit_refunds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id         UUID NOT NULL REFERENCES public.leases(id)        ON DELETE RESTRICT,
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id)       ON DELETE RESTRICT,
  refund_amount    DECIMAL(10,2) NOT NULL CHECK (refund_amount > 0),
  refund_date      DATE NOT NULL,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('check','ach','cash','other')),
  refund_number    TEXT NOT NULL,
  reference_number TEXT,
  notes            TEXT,
  expense_id       UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, refund_number)
);

CREATE INDEX idx_deposit_refunds_lease  ON public.deposit_refunds(org_id, lease_id);
CREATE INDEX idx_deposit_refunds_tenant ON public.deposit_refunds(org_id, tenant_id);
CREATE INDEX idx_deposit_refunds_status ON public.deposit_refunds(org_id, status);

CREATE TRIGGER handle_deposit_refunds_updated_at
  BEFORE UPDATE ON public.deposit_refunds
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ------------------------------------------------------------
-- 3. deposit_refund_deductions junction
-- ------------------------------------------------------------
CREATE TABLE public.deposit_refund_deductions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_refund_id   UUID NOT NULL REFERENCES public.deposit_refunds(id) ON DELETE CASCADE,
  expense_id          UUID NOT NULL REFERENCES public.expenses(id)        ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deposit_refund_id, expense_id)
);

CREATE INDEX idx_deposit_refund_deductions_expense
  ON public.deposit_refund_deductions(expense_id);

-- ------------------------------------------------------------
-- 4. RLS — deposit_refunds
-- ------------------------------------------------------------
ALTER TABLE public.deposit_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deposit refunds in their orgs"
  ON public.deposit_refunds FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert deposit refunds"
  ON public.deposit_refunds FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update deposit refunds"
  ON public.deposit_refunds FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete deposit refunds"
  ON public.deposit_refunds FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- ------------------------------------------------------------
-- 5. RLS — deposit_refund_deductions
-- ------------------------------------------------------------
ALTER TABLE public.deposit_refund_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deposit refund deductions in their orgs"
  ON public.deposit_refund_deductions FOR SELECT
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_org_ids())
    )
  );

CREATE POLICY "Managers can insert deposit refund deductions"
  ON public.deposit_refund_deductions FOR INSERT
  WITH CHECK (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

CREATE POLICY "Managers can delete deposit refund deductions"
  ON public.deposit_refund_deductions FOR DELETE
  USING (
    deposit_refund_id IN (
      SELECT id FROM public.deposit_refunds
      WHERE org_id IN (SELECT public.get_user_managed_org_ids())
    )
  );

-- ------------------------------------------------------------
-- 6. RPC: next_deposit_refund_number
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_deposit_refund_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  max_seq      INTEGER;
  next_seq     INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::TEXT || '_deposit_refund'));

  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(refund_number FROM 'DR-' || current_year || '-(\d+)$')
        AS INTEGER
      )
    ),
    0
  )
  INTO max_seq
  FROM public.deposit_refunds
  WHERE org_id = p_org_id
    AND refund_number LIKE 'DR-' || current_year || '-%';

  next_seq := max_seq + 1;
  RETURN 'DR-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

-- ------------------------------------------------------------
-- 7. RPC: get_lease_deposit_summary
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lease_deposit_summary(
  p_org_id   UUID,
  p_lease_id UUID
)
RETURNS TABLE (
  held         NUMERIC,
  refunded     NUMERIC,
  withheld     NUMERIC,
  balance      NUMERIC,
  refund_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_held     NUMERIC;
  v_refunded NUMERIC;
  v_withheld NUMERIC;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_user_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT COALESCE(deposit_amount, 0)
    INTO v_held
    FROM public.leases
    WHERE id = p_lease_id AND org_id = p_org_id;

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refunded
    FROM public.deposit_refunds
    WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active';

  SELECT COALESCE(SUM(e.amount), 0)
    INTO v_withheld
    FROM public.deposit_refund_deductions d
    JOIN public.deposit_refunds r ON r.id = d.deposit_refund_id
    JOIN public.expenses e        ON e.id = d.expense_id
    WHERE r.lease_id = p_lease_id AND r.org_id = p_org_id AND r.status = 'active';

  RETURN QUERY
  SELECT
    v_held,
    v_refunded,
    v_withheld,
    v_held - v_refunded - v_withheld,
    (SELECT COUNT(*)::INT
       FROM public.deposit_refunds
       WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active');
END;
$$;

-- ------------------------------------------------------------
-- 8. RPC: create_deposit_refund
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_deposit_refund(
  p_org_id                UUID,
  p_lease_id              UUID,
  p_refund_amount         DECIMAL(10,2),
  p_refund_date           DATE,
  p_payment_method        TEXT,
  p_reference_number      TEXT,
  p_notes                 TEXT,
  p_deduction_expense_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lease           RECORD;
  v_tenant_id       UUID;
  v_existing_total  DECIMAL(10,2);
  v_deductions_total DECIMAL(10,2);
  v_balance         DECIMAL(10,2);
  v_expense_id      UUID;
  v_refund_id       UUID;
  v_refund_number   TEXT;
  v_dedup_id        UUID;
  v_eligible_count  INT;
  v_already_linked  INT;
BEGIN
  -- Step 1: authorize
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Step 2: lock lease and resolve fields
  SELECT l.id, l.deposit_amount, l.start_date, l.end_date,
         u.property_id, u.id AS unit_id
    INTO v_lease
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    WHERE l.id = p_lease_id AND l.org_id = p_org_id
    FOR UPDATE OF l;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease not found';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.lease_tenants
    WHERE lease_id = p_lease_id
    ORDER BY created_at ASC
    LIMIT 1;

  -- Step 3 & 4: validate deposit + tenants exist
  IF v_lease.deposit_amount IS NULL OR v_lease.deposit_amount = 0 THEN
    RAISE EXCEPTION 'Lease has no deposit on file';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Lease has no tenants linked';
  END IF;

  -- Step 5: existing refund total
  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_existing_total
    FROM public.deposit_refunds
    WHERE lease_id = p_lease_id AND org_id = p_org_id AND status = 'active';

  -- Step 6: validate every deduction expense
  -- De-duplicate input array first so count comparisons are accurate
  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    p_deduction_expense_ids := ARRAY(SELECT DISTINCT unnest(p_deduction_expense_ids));

    SELECT COUNT(*) INTO v_eligible_count
      FROM public.expenses e
      WHERE e.id = ANY(p_deduction_expense_ids)
        AND e.org_id = p_org_id
        AND (
          e.lease_id = p_lease_id
          OR (
            e.property_id = v_lease.property_id
            AND e.transaction_date >= v_lease.start_date
            AND e.transaction_date <= COALESCE(v_lease.end_date, CURRENT_DATE) + INTERVAL '60 days'
          )
        );

    IF v_eligible_count <> array_length(p_deduction_expense_ids, 1) THEN
      RAISE EXCEPTION 'One or more deduction expenses are not eligible for this lease';
    END IF;

    SELECT COUNT(*) INTO v_already_linked
      FROM public.deposit_refund_deductions d
      JOIN public.deposit_refunds r ON r.id = d.deposit_refund_id
      WHERE d.expense_id = ANY(p_deduction_expense_ids)
        AND r.status = 'active';

    IF v_already_linked > 0 THEN
      RAISE EXCEPTION 'One or more deduction expenses are already linked to an active refund';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_deductions_total
      FROM public.expenses
      WHERE id = ANY(p_deduction_expense_ids);
  ELSE
    v_deductions_total := 0;
  END IF;

  -- Step 8: over-refund check
  IF v_existing_total + v_deductions_total + p_refund_amount > v_lease.deposit_amount THEN
    RAISE EXCEPTION 'Refund of $% plus $% in deductions exceeds remaining deposit balance of $%',
      p_refund_amount, v_deductions_total,
      v_lease.deposit_amount - v_existing_total;
  END IF;

  -- Step 9: refund number
  v_refund_number := public.next_deposit_refund_number(p_org_id);

  -- Step 10: paired expense row
  INSERT INTO public.expenses (
    org_id, property_id, unit_id, amount, expense_type, description,
    transaction_date, lease_id, tenant_id
  )
  VALUES (
    p_org_id, v_lease.property_id, v_lease.unit_id, p_refund_amount,
    'deposit_refund', 'Deposit refund ' || v_refund_number,
    p_refund_date, p_lease_id, v_tenant_id
  )
  RETURNING id INTO v_expense_id;

  -- Step 11: deposit_refunds row
  INSERT INTO public.deposit_refunds (
    org_id, lease_id, tenant_id, refund_amount, refund_date,
    payment_method, refund_number, reference_number, notes,
    expense_id, created_by
  )
  VALUES (
    p_org_id, p_lease_id, v_tenant_id, p_refund_amount, p_refund_date,
    p_payment_method, v_refund_number, p_reference_number, p_notes,
    v_expense_id, auth.uid()
  )
  RETURNING id INTO v_refund_id;

  -- Step 12: junction rows
  IF p_deduction_expense_ids IS NOT NULL AND array_length(p_deduction_expense_ids, 1) > 0 THEN
    INSERT INTO public.deposit_refund_deductions (deposit_refund_id, expense_id)
    SELECT v_refund_id, unnest(p_deduction_expense_ids);
  END IF;

  v_balance := v_lease.deposit_amount - v_existing_total - v_deductions_total - p_refund_amount;

  RETURN jsonb_build_object(
    'refund_id',         v_refund_id,
    'expense_id',        v_expense_id,
    'refund_number',     v_refund_number,
    'balance_remaining', v_balance
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. RPC: void_deposit_refund
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_deposit_refund(
  p_org_id    UUID,
  p_refund_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_refund RECORD;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_user_managed_org_ids()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT * INTO v_refund
    FROM public.deposit_refunds
    WHERE id = p_refund_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit refund not found';
  END IF;

  IF v_refund.status = 'void' THEN
    RAISE EXCEPTION 'Deposit refund is already void';
  END IF;

  UPDATE public.deposit_refunds
     SET status = 'void'
     WHERE id = p_refund_id;

  IF v_refund.expense_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = v_refund.expense_id;
  END IF;

  DELETE FROM public.deposit_refund_deductions
    WHERE deposit_refund_id = p_refund_id;
END;
$$;
```

- [ ] **Step 2: Lint the SQL locally**

Run: `cat supabase/migrations/20260506000002_deposit_refunds.sql | head -5` to confirm file exists.
Open the file in editor; verify no obvious typos.

- [ ] **Step 3: Push migration with dry-run first**

Run from project root:
```
npx supabase db push --dry-run
```
Expected output: `Would push these migrations: 20260506000002_deposit_refunds.sql`

- [ ] **Step 4: Apply the migration**

```
echo "y" | npx supabase db push
```
Expected: `Applying migration 20260506000002_deposit_refunds.sql... Finished supabase db push.`

- [ ] **Step 5: Manual smoke test — verify schema**

In Supabase SQL editor or psql, run:
```sql
-- Confirm new columns
SELECT column_name FROM information_schema.columns
WHERE table_name='expenses' AND column_name IN ('tenant_id','lease_id');
-- Should return 2 rows

-- Confirm new tables
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('deposit_refunds','deposit_refund_deductions');
-- Should return 2 rows

-- Confirm RPCs
SELECT proname FROM pg_proc
WHERE proname IN ('next_deposit_refund_number','get_lease_deposit_summary',
                  'create_deposit_refund','void_deposit_refund');
-- Should return 4 rows

-- Confirm extended enum
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'expenses_expense_type_check';
-- Output should include 'deposit_refund'
```

- [ ] **Step 6: Commit**

```
git add supabase/migrations/20260506000002_deposit_refunds.sql
git commit -m "feat(deposits): migration for deposit_refunds + RPCs"
```

---

## Chunk 2: Backend (schemas, actions, hooks)

### Task 2.1: Update expense schema with `tenant_id` + `lease_id`

**Files:**
- Modify: `modules/accounting/src/schemas/expense-schema.ts`

- [ ] **Step 1: Edit schema**

Add to the `expenseSchema` object:
```ts
tenant_id: z.string().uuid().optional().nullable(),
lease_id:  z.string().uuid().optional().nullable(),
```

Also extend the `expense_type` enum to include `'deposit_refund'`.

Final shape:
```ts
export const expenseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id:  z.string().uuid().optional().nullable(),
  tenant_id: z.string().uuid().optional().nullable(),
  lease_id:  z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  expense_type: z.enum([
    'mortgage','maintenance','repairs','utilities','insurance',
    'taxes','management','advertising','legal','hoa','home_warranty',
    'deposit_refund','other',
  ]),
  description: z.string().optional().default(''),
  transaction_date: z.string().min(1,'Date is required'),
  provider_id: z.string().uuid().optional().nullable(),
});
```

- [ ] **Step 2: Update create-expense action**

Modify `modules/accounting/src/actions/create-expense.ts` insert block:
```ts
.insert({
  ...parsed.data,
  org_id: orgId,
  unit_id: parsed.data.unit_id || null,
  tenant_id: parsed.data.tenant_id || null,
  lease_id: parsed.data.lease_id || null,
})
```

- [ ] **Step 3: Update update-expense action with deduction-link guard**

Modify `modules/accounting/src/actions/update-expense.ts`. Before the UPDATE, add the guard:
```ts
const { count: linkedCount } = await db
  .from('deposit_refund_deductions')
  .select('id, deposit_refunds!inner(status)', { count: 'exact', head: true })
  .eq('expense_id', expenseId)
  .eq('deposit_refunds.status', 'active');

if (linkedCount && linkedCount > 0) {
  return {
    success: false,
    error: 'This expense is linked to an active deposit refund — void the refund first to edit.',
  };
}
```

**Note:** The spec scopes the restriction to `tenant_id`, `lease_id`, `property_id`, `amount`, `transaction_date` only. We block ALL updates here as a deliberate tightening — simpler v1 invariant, avoids partial-update foot-guns. If a user only wants to fix a typo in the description, they can void the refund (which frees the deduction), edit the expense, then re-create the refund. Future iteration can relax this once the basics are proven.

Update the .update payload to include the new fields:
```ts
.update({
  ...parsed.data,
  unit_id: parsed.data.unit_id || null,
  tenant_id: parsed.data.tenant_id || null,
  lease_id: parsed.data.lease_id || null,
})
```

- [ ] **Step 4: Update delete-expense action with same guard**

Modify `modules/accounting/src/actions/delete-expense.ts`. Add the same `linkedCount` check before the delete. Reason: `expenses` has `ON DELETE RESTRICT` from junction so the DB will reject anyway — but a friendlier client-side error helps.

Also explicitly block deleting `expense_type='deposit_refund'` rows from this entry point (must go through `voidDepositRefund`):
```ts
const { data: expense } = await db
  .from('expenses').select('expense_type').eq('id', expenseId).single();
if (expense?.expense_type === 'deposit_refund') {
  return {
    success: false,
    error: 'Refund expenses must be voided via the deposit refund record.',
  };
}
```

- [ ] **Step 5: Type-check**

Run from project root:
```
cd modules/accounting && npx tsc --noEmit
```
Expected: clean (no output).

- [ ] **Step 6: Commit**

```
git add modules/accounting/src/schemas/expense-schema.ts \
        modules/accounting/src/actions/create-expense.ts \
        modules/accounting/src/actions/update-expense.ts \
        modules/accounting/src/actions/delete-expense.ts
git commit -m "feat(expenses): tenant_id + lease_id columns and guards"
```

---

### Task 2.2: Create deposit-refund schema

**Files:**
- Create: `modules/billing/src/schemas/deposit-refund-schema.ts`

- [ ] **Step 1: Write schema file**

```ts
import { z } from 'zod';

export const depositRefundSchema = z.object({
  lease_id: z.string().uuid('Select a lease'),
  refund_amount: z.coerce.number().positive('Amount must be positive'),
  refund_date: z.string().min(1, 'Refund date is required'),
  payment_method: z.enum(['check','ach','cash','other']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  deduction_expense_ids: z.array(z.string().uuid()).default([]),
});

export type DepositRefundFormValues = z.infer<typeof depositRefundSchema>;

export const voidDepositRefundSchema = z.object({
  refund_id: z.string().uuid(),
});
```

- [ ] **Step 2: Re-export from index**

Modify `modules/billing/src/index.ts`. Add:
```ts
export {
  depositRefundSchema,
  voidDepositRefundSchema,
  type DepositRefundFormValues,
} from './schemas/deposit-refund-schema';
```

- [ ] **Step 3: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add modules/billing/src/schemas/deposit-refund-schema.ts \
        modules/billing/src/index.ts
git commit -m "feat(deposits): add deposit-refund zod schema"
```

---

### Task 2.3: Create-deposit-refund server action

**Files:**
- Create: `modules/billing/src/actions/create-deposit-refund.ts`

- [ ] **Step 1: Write action**

```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import {
  depositRefundSchema,
  type DepositRefundFormValues,
} from '../schemas/deposit-refund-schema';

export async function createDepositRefund(
  orgId: string,
  values: DepositRefundFormValues,
): Promise<ActionResult<{
  refund_id: string;
  expense_id: string;
  refund_number: string;
  balance_remaining: number;
}>> {
  try {
    const parsed = depositRefundSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('create_deposit_refund', {
      p_org_id: orgId,
      p_lease_id: parsed.data.lease_id,
      p_refund_amount: parsed.data.refund_amount,
      p_refund_date: parsed.data.refund_date,
      p_payment_method: parsed.data.payment_method,
      p_reference_number: parsed.data.reference_number ?? null,
      p_notes: parsed.data.notes ?? null,
      p_deduction_expense_ids: parsed.data.deduction_expense_ids,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch {
    return { success: false, error: 'Failed to create deposit refund' };
  }
}
```

- [ ] **Step 2: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```
git add modules/billing/src/actions/create-deposit-refund.ts
git commit -m "feat(deposits): server action createDepositRefund"
```

---

### Task 2.4: Void-deposit-refund server action

**Files:**
- Create: `modules/billing/src/actions/void-deposit-refund.ts`

- [ ] **Step 1: Write action**

```ts
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function voidDepositRefund(
  orgId: string,
  refundId: string,
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db.rpc('void_deposit_refund', {
      p_org_id: orgId,
      p_refund_id: refundId,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to void deposit refund' };
  }
}
```

- [ ] **Step 2: Commit**

```
git add modules/billing/src/actions/void-deposit-refund.ts
git commit -m "feat(deposits): server action voidDepositRefund"
```

---

### Task 2.5: React Query hooks for deposit refunds

**Files:**
- Create: `modules/billing/src/hooks/use-deposit-refunds.ts`

- [ ] **Step 1: Write hook file**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface DepositRefundFilters {
  orgId: string | null;
  leaseId?: string;
  tenantId?: string;
  status?: 'active' | 'void';
}

export function useDepositRefunds(filters: DepositRefundFilters) {
  return useQuery({
    queryKey: ['deposit-refunds', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('deposit_refunds')
        .select(`
          *,
          tenants(first_name, last_name),
          leases(start_date, end_date, units(unit_number, properties(name))),
          expense:expenses!deposit_refunds_expense_id_fkey(id, amount, transaction_date),
          deductions:deposit_refund_deductions(
            expense:expenses(id, amount, description, transaction_date, expense_type)
          )
        `)
        .eq('org_id', filters.orgId)
        .order('refund_date', { ascending: false });

      if (filters.leaseId) query = query.eq('lease_id', filters.leaseId);
      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

export function useDepositSummary(orgId: string | null, leaseId: string | null) {
  return useQuery({
    queryKey: ['deposit-summary', orgId, leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any).rpc('get_lease_deposit_summary', {
        p_org_id: orgId,
        p_lease_id: leaseId,
      });
      if (error) throw error;
      return data?.[0] ?? { held: 0, refunded: 0, withheld: 0, balance: 0, refund_count: 0 };
    },
    enabled: !!orgId && !!leaseId,
  });
}

export interface EligibleExpense {
  id: string;
  amount: number;
  description: string;
  transaction_date: string;
  expense_type: string;
  lease_id: string | null;
  property_id: string;
}

/**
 * Lists expenses eligible to be linked as deductions on a deposit refund.
 * - Always includes expenses with lease_id = leaseId
 * - When includePropertyWindow=true, also includes expenses on the same
 *   property within the lease date window (+ 60 days).
 * - Excludes expenses already linked to active refunds.
 */
export function useEligibleDeductions(
  orgId: string | null,
  leaseId: string | null,
  includePropertyWindow: boolean,
) {
  return useQuery({
    queryKey: ['deposit-eligible-deductions', orgId, leaseId, includePropertyWindow],
    queryFn: async () => {
      if (!orgId || !leaseId) return [] as EligibleExpense[];
      const supabase = createClient();
      const db = supabase as any;

      const { data: lease } = await db
        .from('leases')
        .select('start_date, end_date, units(property_id)')
        .eq('id', leaseId).single();

      if (!lease) return [];

      // 1. Find expense ids already linked to active refunds (exclude these)
      const { data: linkedRows } = await db
        .from('deposit_refund_deductions')
        .select('expense_id, deposit_refunds!inner(status)')
        .eq('deposit_refunds.status', 'active');
      const linkedIds = new Set((linkedRows ?? []).map((r: any) => r.expense_id));

      // 2. Build candidate query
      let q = db
        .from('expenses')
        .select('id, amount, description, transaction_date, expense_type, lease_id, property_id')
        .eq('org_id', orgId)
        .neq('expense_type', 'deposit_refund')
        .order('transaction_date', { ascending: false });

      if (includePropertyWindow && lease.units?.property_id) {
        const upperEnd = lease.end_date ?? new Date().toISOString().split('T')[0];
        const upperPlus60 = new Date(upperEnd);
        upperPlus60.setDate(upperPlus60.getDate() + 60);
        const upperStr = upperPlus60.toISOString().split('T')[0];
        q = q.or(
          `lease_id.eq.${leaseId},and(property_id.eq.${lease.units.property_id},transaction_date.gte.${lease.start_date},transaction_date.lte.${upperStr})`
        );
      } else {
        q = q.eq('lease_id', leaseId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((e: any) => !linkedIds.has(e.id)) as EligibleExpense[];
    },
    enabled: !!orgId && !!leaseId,
  });
}
```

- [ ] **Step 2: Re-export from index**

Modify `modules/billing/src/index.ts`. Add:
```ts
export {
  useDepositRefunds,
  useDepositSummary,
  useEligibleDeductions,
  type DepositRefundFilters,
  type EligibleExpense,
} from './hooks/use-deposit-refunds';
```

- [ ] **Step 3: Type-check**

```
cd modules/billing && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add modules/billing/src/hooks/use-deposit-refunds.ts \
        modules/billing/src/index.ts
git commit -m "feat(deposits): hooks for refunds, summary, eligible deductions"
```

---

## Chunk 3: UI Components

### Task 3.1: Deposit Refund Dialog

**Files:**
- Create: `apps/web/components/billing/deposit-refund-dialog.tsx`

- [ ] **Step 1: Write the dialog component**

The dialog: header with deposit summary stats, deduction picker with a "include property+window" toggle, refund amount/date/method fields, submit button. The shape follows the existing `apply-credit-dialog.tsx` (Dialog → DialogContent → form with handleSubmit). Wire up to:
- `useDepositSummary(orgId, leaseId)` for the header stats
- `useEligibleDeductions(orgId, leaseId, includeWindow)` for the picker list
- `createDepositRefund` server action on submit
- `queryClient.invalidateQueries` for `['deposit-refunds']`, `['deposit-summary']`, `['deposit-eligible-deductions']`, `['expenses']`, `['financial-stats']`

Form schema: `depositRefundSchema` from `@onereal/billing`. Defaults: `lease_id` from prop, `refund_amount: 0`, `refund_date: today`, `payment_method: 'check'`, `deduction_expense_ids: []`.

Picker: each row has a checkbox; toggling updates `form.setValue('deduction_expense_ids', ...)`. Compute `withheld = sum(amount of selected eligible expenses)`. Compute `available = held - refunded - previouslyWithheld - withheld`. Disable Submit when `refund_amount <= 0` or exceeds `available + withheld`.

Reset form on `open` change in a `useEffect`.

Props:
```ts
interface DepositRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string | null;
  leaseLabel?: string;
}
```

- [ ] **Step 2: Type-check web app**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```
git add apps/web/components/billing/deposit-refund-dialog.tsx
git commit -m "feat(deposits): refund dialog with deduction picker"
```

---

### Task 3.2: Deposit Card (lease/tenant page widget)

**Files:**
- Create: `apps/web/components/billing/deposit-card.tsx`

- [ ] **Step 1: Write component**

Two render modes via `compact?: boolean` prop:

**Full mode** — bordered card with:
- Header `Deposit` + `[+ Refund Deposit]` button (disabled with tooltip when `held === 0` → "No deposit on this lease", or `balance <= 0` → "Deposit fully accounted for")
- Stats grid (4 columns): Held, Refunded, Withheld, Balance
- "Refunds" sub-section listing each refund row with `refund_number`, status Badge, refund_date, amount, payment_method, and Void button on active rows. Below each row: "Deductions: <description $amount>, ..." rendered from `r.deductions[]`.

**Compact mode** — single Button "Refund deposit (${balance})", same disabled rules. Used in tenant-page lease rows.

Both modes render `<DepositRefundDialog>` controlled by local `open` state.

Data sources:
- `useDepositSummary(orgId, leaseId)`
- `useDepositRefunds({ orgId, leaseId })` — note the joined `deductions:deposit_refund_deductions(expense:expenses(...))` shape

Void handler:
```ts
async function handleVoid(refundId: string, refundNumber: string) {
  if (!confirm(`Void refund ${refundNumber}? ...`)) return;
  const result = await voidDepositRefund(activeOrg.id, refundId);
  // toast + invalidate ['deposit-refunds','deposit-summary','deposit-eligible-deductions','expenses','financial-stats']
}
```

Props:
```ts
interface DepositCardProps {
  leaseId: string;
  leaseLabel: string;
  compact?: boolean;
}
```

- [ ] **Step 2: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```
git add apps/web/components/billing/deposit-card.tsx
git commit -m "feat(deposits): deposit card with summary + refund history"
```

---

### Task 3.3: Expense Dialog — add Tenant selector + auto-derive lease_id

**Files:**
- Modify: `apps/web/components/accounting/expense-dialog.tsx`

- [ ] **Step 1: Read existing expense-dialog.tsx**

Use the Read tool to get the current structure: `useForm` defaultValues, `form.reset` block, the FormFields layout, existing watchers.

- [ ] **Step 2: Add `tenant_id` and `lease_id` to defaults and reset**

In both `useForm({ defaultValues: ... })` and `form.reset({ ... })`:
```ts
tenant_id: expense?.tenant_id ?? undefined,
lease_id:  expense?.lease_id  ?? undefined,
```
(use `undefined` for create, hydrate from `expense` for edit.)

- [ ] **Step 3: Import useTenants and compute filtered list**

```ts
import { useTenants } from '@onereal/contacts';
import { useMemo } from 'react'; // if not already imported
```

After existing query hooks:
```ts
const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
const tenants = (tenantsData ?? []) as any[];

const selectedPropertyId = form.watch('property_id');
const filteredTenants = useMemo(() => {
  if (!selectedPropertyId) return tenants;
  return tenants.filter((t: any) =>
    t.lease_tenants?.some((lt: any) => lt.leases?.units?.property_id === selectedPropertyId),
  );
}, [tenants, selectedPropertyId]);
```

- [ ] **Step 4: Add the optional Tenant FormField**

Place between property/unit and amount:
```tsx
<FormField control={form.control} name="tenant_id" render={({ field }) => (
  <FormItem>
    <FormLabel>Tenant (optional)</FormLabel>
    <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value ?? 'none'}>
      <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {filteredTenants.map((t: any) => (
          <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <FormMessage />
  </FormItem>
)} />
```

- [ ] **Step 5: Auto-derive lease_id effect**

```ts
const selectedTenantId = form.watch('tenant_id');
useEffect(() => {
  if (!selectedTenantId || !selectedPropertyId) return;
  const tenant = tenants.find((t: any) => t.id === selectedTenantId);
  const activeLeaseId = tenant?.lease_tenants?.find((lt: any) => {
    const lease = lt.leases;
    return lease?.status === 'active' && lease.units?.property_id === selectedPropertyId;
  })?.leases?.id;
  form.setValue('lease_id', activeLeaseId ?? null);
}, [selectedTenantId, selectedPropertyId, tenants, form]);
```

- [ ] **Step 6: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```
git add apps/web/components/accounting/expense-dialog.tsx
git commit -m "feat(expenses): tenant selector + auto-derived lease_id"
```

---

### Task 3.4: Expense table — read-only behavior for `deposit_refund` rows

**Files:**
- Modify: the table component used by the Outgoing page (locate via grep)

- [ ] **Step 1: Locate the table**

```
grep -rn "expense_type" apps/web/components/accounting apps/web/app
```
The table component is likely either a shared component in `apps/web/components/accounting/` or inline JSX in `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`. Modify whichever owns the row-level edit/delete buttons.

- [ ] **Step 2: Suppress edit/delete for `deposit_refund` rows**

```tsx
const isRefund = expense.expense_type === 'deposit_refund';
{!isRefund && <Button onClick={() => onEdit(expense)} ... />}
{!isRefund && <Button onClick={() => onDelete(expense)} ... />}
{isRefund && expense.lease_id && (
  <Link href={`/contacts/leases/${expense.lease_id}`} className="text-xs text-primary hover:underline">
    View refund
  </Link>
)}
```

`Link` from `next/link`.

- [ ] **Step 3: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```
git add <files modified>
git commit -m "feat(expenses): make deposit_refund rows read-only in Outgoing"
```

---

## Chunk 4: Page Integration & Smoke Tests

### Task 4.1: Add Deposit card to lease detail page

**Files:**
- Modify: `apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx`

- [ ] **Step 1: Read current page**

Identify the JSX section that displays `lease.deposit_amount` (around line 129).

- [ ] **Step 2: Import DepositCard**

```ts
import { DepositCard } from '@/components/billing/deposit-card';
```

- [ ] **Step 3: Render DepositCard**

Replace (or place adjacent to, depending on layout) the existing deposit_amount block with a full-width section:

```tsx
<DepositCard
  leaseId={lease.id}
  leaseLabel={`${lease.units?.properties?.name ?? 'Property'} — ${lease.units?.unit_number ?? 'Unit'}`}
/>
```

If the existing deposit display is inside a metadata grid alongside other lease fields, leave the grid intact and add `DepositCard` as a separate full-width section below it — don't shoehorn the card into a grid cell.

- [ ] **Step 4: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add 'apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx'
git commit -m "feat(deposits): show DepositCard on lease detail page"
```

---

### Task 4.2: Add compact refund button on tenant detail page leases table

**Files:**
- Modify: `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx`

- [ ] **Step 1: Read current page**

Find the Leases table — each row corresponds to a lease.

- [ ] **Step 2: Import DepositCard**

```ts
import { DepositCard } from '@/components/billing/deposit-card';
```

- [ ] **Step 3: Render compact mode in the Actions cell**

Inside the Actions cell of each lease row, add (alongside existing edit/open/delete buttons):

```tsx
<DepositCard
  leaseId={lease.id}
  leaseLabel={`${lease.units?.properties?.name ?? 'Property'} — ${lease.units?.unit_number ?? 'Unit'}`}
  compact
/>
```

- [ ] **Step 4: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add 'apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx'
git commit -m "feat(deposits): refund button on tenant detail leases table"
```

---

### Task 4.3: Outgoing page — add `deposit_refund` filter and verify tenant joins

**Files:**
- Modify: `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`
- Possibly modify: `modules/accounting/src/hooks/use-expenses.ts`

- [ ] **Step 1: Read the page**

Locate the `expense_type` filter dropdown.

- [ ] **Step 2: Add menu item**

Inside `<SelectContent>` of the expense_type filter:
```tsx
<SelectItem value="deposit_refund">Deposit Refund</SelectItem>
```
(Place near the bottom, before "Other" if present.)

- [ ] **Step 3: Verify `useExpenses` returns tenant join**

Open `modules/accounting/src/hooks/use-expenses.ts`. Confirm `select(...)` includes `tenants(first_name, last_name)`. If not, add it. Without this, deposit refund rows can't show the tenant name in the table.

- [ ] **Step 4: Optionally add tenant column rendering**

If the existing table only shows provider name, add (in the relevant cell):
```tsx
{expense.expense_type === 'deposit_refund' && expense.tenants
  ? `${expense.tenants.first_name} ${expense.tenants.last_name}`
  : (existing render)}
```

- [ ] **Step 5: Type-check**

```
cd apps/web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```
git add 'apps/web/app/(dashboard)/accounting/outgoing/page.tsx' \
        modules/accounting/src/hooks/use-expenses.ts
git commit -m "feat(deposits): deposit_refund filter + tenant column in Outgoing"
```

---

### Task 4.4: End-to-end smoke test

**Files:** none — manual verification.

- [ ] **Step 1: Start dev server**

```
pnpm dev
```
Wait for `Ready in <Xs>`.

- [ ] **Step 2: Smoke 1 — happy-path full refund, no deductions**

1. Navigate to a lease with a non-zero deposit.
2. Click "Refund Deposit" on the new Deposit card.
3. Enter refund amount = full deposit; leave deductions empty.
4. Submit. Expected: success toast matching `/Refund DR-2026-\d{4} created/` (first of the year is `DR-2026-0001`; suffix grows if other test refunds happened first).
5. Verify Deposit card now shows: Refunded = full amount, Balance = 0.
6. Outgoing → filter by `Deposit Refund`. Expect one row with the right amount + tenant name visible. No edit/delete buttons; only "View refund" link.

- [ ] **Step 3: Smoke 2 — partial refund with deductions**

1. Pick a different lease with a deposit.
2. Pre-create 1-2 regular expenses (Maintenance/Repairs) on the same property — use the new Tenant selector to tag them.
3. Open Refund Deposit dialog. Confirm those expenses appear in Deductions.
4. Check 1-2 deductions, set refund amount = held - selected.
5. Submit. Verify Deposit card: Refunded + Withheld + Balance ties out to Held.
6. Re-open Refund dialog — selected deductions should NOT appear (already linked).

- [ ] **Step 4: Smoke 3 — over-refund prevention**

1. On a lease with `Held=$2000`, attempt refund of `$2500`, no deductions.
2. Expected: error toast like "Refund of $2500 plus $0 in deductions exceeds remaining deposit balance of $2000".
3. Dialog stays open.

- [ ] **Step 5: Smoke 4 — void refund**

1. On the lease from Smoke 1, click Void on the active refund.
2. Confirm prompt.
3. Refund row → status `void`. Deposit card balance returns to held amount.
4. Outgoing → Deposit Refund filter → the voided refund's expense row is gone.
5. Re-open Refund dialog — originally linked deductions are eligible again.

- [ ] **Step 6: Smoke 5 — expired-lease tenant (the original bug)**

1. Tenant detail page for Destiny Heaven Graham (lease 33-DowSt expired).
2. Click compact "Refund deposit" on the expired lease row.
3. Dialog opens, deposit summary loads, refund can be created.
4. This is the regression fix that motivated the feature.

- [ ] **Step 7: Smoke 6 — edit-guard on linked expense**

1. Pick an expense currently linked as a deduction to an active refund.
2. Outgoing page → edit that expense (if it isn't a `deposit_refund` row).
3. Expected error toast: "This expense is linked to an active deposit refund — void the refund first to edit."

- [ ] **Step 8: Stop dev server**

Ctrl+C in the dev terminal (or `TaskStop` if backgrounded).

---

### Task 4.5: Push to remote

- [ ] **Step 1: Verify git status clean**

```
git status
```
Expected: clean working tree (or only smoke-test fixes).

- [ ] **Step 2: Push**

```
git push origin main
```

- [ ] **Step 3: Verify Vercel deploy**

Wait for Vercel to auto-deploy from `main`. After deploy, repeat Smoke 5 on `one-real-web.vercel.app` to confirm production fix.

---

## Done Criteria

- All checkboxes filled across the 4 chunks.
- Migration applied to remote without error.
- All 6 smoke-test scenarios pass on local dev.
- Smoke 5 verified on the production Vercel deploy.

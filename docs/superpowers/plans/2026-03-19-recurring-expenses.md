# Recurring Expenses Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow property managers to create recurring expense templates per property and generate actual expense records for any month with a single click.

**Architecture:** New `recurring_expenses` table with RLS, extending `expenses` with `recurring_expense_id` + `generated_for_period` for idempotent generation. CRUD server actions + a generation action with co-located preview. UI: Recurring tab on property detail page + Generate Expenses dialog on the Outgoing page.

**Tech Stack:** Supabase (PostgreSQL + RLS), Next.js server actions, React Query, Zod, React Hook Form, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-19-recurring-expenses-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260319000002_recurring_expenses.sql` | Table, RLS, trigger, indexes, expenses table extension |
| `packages/types/src/models.ts` | `RecurringExpense` interface, extend `Expense` |
| `modules/accounting/src/schemas/recurring-expense-schema.ts` | Zod validation for template CRUD forms |
| `modules/accounting/src/actions/create-recurring-expense.ts` | Insert template |
| `modules/accounting/src/actions/update-recurring-expense.ts` | Update template |
| `modules/accounting/src/actions/delete-recurring-expense.ts` | Delete template |
| `modules/accounting/src/actions/generate-expenses.ts` | Generate expenses + preview (co-located) |
| `modules/accounting/src/hooks/use-recurring-expenses.ts` | Query hook for templates by property |
| `modules/accounting/src/hooks/use-expense-generation-preview.ts` | Query hook wrapping `previewGenerateExpenses` |
| `modules/accounting/src/index.ts` | Barrel exports for hooks + schema |
| `apps/web/components/accounting/recurring-expense-dialog.tsx` | Create/edit template dialog |
| `apps/web/components/accounting/generate-expenses-dialog.tsx` | Month picker + preview + generate dialog |
| `apps/web/components/properties/property-detail-tabs.tsx` | Add Recurring tab with inline component |
| `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` | Add Generate Expenses button |

---

## Chunk 1: Database + Types

### Task 1: Create the database migration

**Files:**
- Create: `supabase/migrations/20260319000002_recurring_expenses.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Recurring expense templates
CREATE TABLE public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN (
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other'
  )),
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
  description TEXT NOT NULL DEFAULT '',
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CHECK (end_date IS NULL OR end_date >= start_date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_expenses_org ON public.recurring_expenses(org_id);
CREATE INDEX idx_recurring_expenses_property ON public.recurring_expenses(property_id);

-- Auto-update updated_at
CREATE TRIGGER handle_recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recurring expenses in their orgs"
  ON public.recurring_expenses FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids()));

CREATE POLICY "Managers can insert recurring expenses"
  ON public.recurring_expenses FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can update recurring expenses"
  ON public.recurring_expenses FOR UPDATE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Managers can delete recurring expenses"
  ON public.recurring_expenses FOR DELETE
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

-- Extend expenses table for generation tracking
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurring_expense_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS generated_for_period TEXT;

-- Enforce idempotency: one generated expense per template per period
CREATE UNIQUE INDEX idx_expenses_recurring_period
  ON public.expenses(recurring_expense_id, generated_for_period)
  WHERE recurring_expense_id IS NOT NULL;
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `npx supabase db push --linked`
Expected: Migration applies successfully. If it fails, check error messages for existing objects.

Working directory: `c:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260319000002_recurring_expenses.sql
git commit -m "feat: add recurring_expenses table and extend expenses for generation tracking"
```

---

### Task 2: Add TypeScript types

**Files:**
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add RecurringExpense interface**

After the existing `Expense` interface (around line 147), add:

```typescript
export interface RecurringExpense {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  expense_type: string;
  amount: number;
  frequency: 'monthly' | 'yearly';
  description: string;
  provider_id: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined by hook, not stored in table:
  service_providers?: { name: string } | null;
}
```

- [ ] **Step 2: Extend Expense interface**

Add these two fields to the existing `Expense` interface (before `created_at`):

```typescript
  recurring_expense_id: string | null;
  generated_for_period: string | null;
```

- [ ] **Step 3: Verify build**

Run: `npx turbo build --filter=@onereal/types`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat: add RecurringExpense type and extend Expense with generation fields"
```

---

## Chunk 2: Schema + CRUD Actions

### Task 3: Create Zod validation schema

**Files:**
- Create: `modules/accounting/src/schemas/recurring-expense-schema.ts`

- [ ] **Step 1: Write the schema**

Reference: `modules/accounting/src/schemas/expense-schema.ts` for the existing pattern.

```typescript
import { z } from 'zod';

export const recurringExpenseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  expense_type: z.enum([
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other',
  ]),
  amount: z.coerce.number().positive('Amount must be positive'),
  frequency: z.enum(['monthly', 'yearly']),
  description: z.string().optional().default(''),
  provider_id: z.string().uuid().optional().nullable(),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional().nullable().default(null),
  is_active: z.boolean().optional().default(true),
}).refine(
  (data) => !data.end_date || data.end_date >= data.start_date,
  { message: 'End date must be on or after start date', path: ['end_date'] }
);

export type RecurringExpenseFormValues = z.infer<typeof recurringExpenseSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/schemas/recurring-expense-schema.ts
git commit -m "feat: add recurring expense Zod schema"
```

---

### Task 4: Create recurring expense server action

**Files:**
- Create: `modules/accounting/src/actions/create-recurring-expense.ts`

- [ ] **Step 1: Write the action**

Reference: `modules/accounting/src/actions/create-expense.ts` for the pattern.

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { recurringExpenseSchema, type RecurringExpenseFormValues } from '../schemas/recurring-expense-schema';

export async function createRecurringExpense(
  orgId: string,
  values: RecurringExpenseFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = recurringExpenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db
      .from('recurring_expenses')
      .insert({
        ...parsed.data,
        org_id: orgId,
        unit_id: parsed.data.unit_id || null,
        provider_id: parsed.data.provider_id || null,
        end_date: parsed.data.end_date || null,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create recurring expense' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/actions/create-recurring-expense.ts
git commit -m "feat: add create recurring expense server action"
```

---

### Task 5: Update recurring expense server action

**Files:**
- Create: `modules/accounting/src/actions/update-recurring-expense.ts`

- [ ] **Step 1: Write the action**

Reference: `modules/accounting/src/actions/update-expense.ts` for the pattern.

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { recurringExpenseSchema, type RecurringExpenseFormValues } from '../schemas/recurring-expense-schema';

export async function updateRecurringExpense(
  id: string,
  values: RecurringExpenseFormValues
): Promise<ActionResult> {
  try {
    const parsed = recurringExpenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('recurring_expenses')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
        provider_id: parsed.data.provider_id || null,
        end_date: parsed.data.end_date || null,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update recurring expense' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/actions/update-recurring-expense.ts
git commit -m "feat: add update recurring expense server action"
```

---

### Task 6: Delete recurring expense server action

**Files:**
- Create: `modules/accounting/src/actions/delete-recurring-expense.ts`

- [ ] **Step 1: Write the action**

Reference: `modules/accounting/src/actions/delete-expense.ts` for the pattern.

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteRecurringExpense(
  id: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('recurring_expenses')
      .delete()
      .eq('id', id);

    if (error) return { success: false, error: error.message };

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete recurring expense' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/actions/delete-recurring-expense.ts
git commit -m "feat: add delete recurring expense server action"
```

---

## Chunk 3: Generation Logic

### Task 7: Generate expenses + preview server action

**Files:**
- Create: `modules/accounting/src/actions/generate-expenses.ts`

- [ ] **Step 1: Write the generation action with co-located preview**

Reference: `modules/billing/src/actions/generate-invoices.ts` for the generation + preview co-location pattern.

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Fetch eligible recurring expense templates for a given org + month/year.
 * Shared logic between generate and preview.
 */
async function fetchEligibleTemplates(
  db: any,
  orgId: string,
  month: number,
  year: number
) {
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

  // Fetch active templates within date range
  const { data: templates, error } = await db
    .from('recurring_expenses')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .lte('start_date', endOfMonth)
    .or(`end_date.is.null,end_date.gte.${startOfMonth}`);

  if (error) throw error;

  // Filter by frequency
  const eligible = (templates ?? []).filter((t: any) => {
    if (t.frequency === 'monthly') return true;
    if (t.frequency === 'yearly') {
      const startMonth = new Date(t.start_date + 'T00:00:00').getMonth() + 1;
      return startMonth === month;
    }
    return false;
  });

  return eligible;
}

/**
 * Check which templates already have generated expenses for this period.
 * Returns a Set of recurring_expense_id values that should be skipped.
 */
async function fetchExistingForPeriod(
  db: any,
  templateIds: string[],
  period: string
): Promise<Set<string>> {
  if (templateIds.length === 0) return new Set();

  const { data: existing } = await db
    .from('expenses')
    .select('recurring_expense_id')
    .in('recurring_expense_id', templateIds)
    .eq('generated_for_period', period);

  return new Set((existing ?? []).map((e: any) => e.recurring_expense_id));
}

export async function generateExpenses(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ generated: number; skipped: number }>> {
  try {
    if (month < 1 || month > 12) return { success: false, error: 'Invalid month' };

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const transactionDate = `${year}-${String(month).padStart(2, '0')}-01`;

    const eligible = await fetchEligibleTemplates(db, orgId, month, year);
    if (eligible.length === 0) {
      return { success: true, data: { generated: 0, skipped: 0 } };
    }

    const templateIds = eligible.map((t: any) => t.id);
    const alreadyGenerated = await fetchExistingForPeriod(db, templateIds, period);

    let generated = 0;
    let skipped = 0;

    for (const template of eligible) {
      if (alreadyGenerated.has(template.id)) {
        skipped++;
        continue;
      }

      const { error: insertError } = await db.from('expenses').insert({
        org_id: template.org_id,
        property_id: template.property_id,
        unit_id: template.unit_id,
        expense_type: template.expense_type,
        amount: template.amount,
        description: template.description,
        provider_id: template.provider_id,
        transaction_date: transactionDate,
        recurring_expense_id: template.id,
        generated_for_period: period,
      });

      if (insertError) {
        // Unique constraint violation = concurrent generation, count as skipped
        if (insertError.code === '23505') {
          skipped++;
        } else {
          return { success: false, error: insertError.message };
        }
      } else {
        generated++;
      }
    }

    return { success: true, data: { generated, skipped } };
  } catch {
    return { success: false, error: 'Failed to generate expenses' };
  }
}

export async function previewGenerateExpenses(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number }>> {
  try {
    if (month < 1 || month > 12) return { success: false, error: 'Invalid month' };

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const eligible = await fetchEligibleTemplates(db, orgId, month, year);
    const templateIds = eligible.map((t: any) => t.id);
    const alreadyGenerated = await fetchExistingForPeriod(db, templateIds, period);

    const newEligible = eligible.filter((t: any) => !alreadyGenerated.has(t.id));

    return { success: true, data: { eligible: newEligible.length } };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/actions/generate-expenses.ts
git commit -m "feat: add generate expenses + preview server actions"
```

---

## Chunk 4: Hooks + Barrel Exports

### Task 8: Create recurring expenses query hook

**Files:**
- Create: `modules/accounting/src/hooks/use-recurring-expenses.ts`

- [ ] **Step 1: Write the hook**

Reference: `modules/accounting/src/hooks/use-expenses.ts` for the query hook pattern.

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useRecurringExpenses(propertyId: string | null) {
  return useQuery({
    queryKey: ['recurring-expenses', propertyId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('recurring_expenses')
        .select('*, service_providers(name)')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/hooks/use-recurring-expenses.ts
git commit -m "feat: add useRecurringExpenses query hook"
```

---

### Task 9: Create expense generation preview hook

**Files:**
- Create: `modules/accounting/src/hooks/use-expense-generation-preview.ts`

- [ ] **Step 1: Write the hook**

Reference: `modules/billing/src/hooks/use-invoice-generation-preview.ts` for the pattern.

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { previewGenerateExpenses } from '../actions/generate-expenses';

export function useExpenseGenerationPreview(
  orgId: string | null,
  month: number,
  year: number
) {
  return useQuery({
    queryKey: ['expense-generation-preview', orgId, month, year],
    queryFn: async () => {
      const result = await previewGenerateExpenses(orgId!, month, year);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!orgId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/hooks/use-expense-generation-preview.ts
git commit -m "feat: add useExpenseGenerationPreview hook"
```

---

### Task 10: Update barrel exports

**Files:**
- Modify: `modules/accounting/src/index.ts`

- [ ] **Step 1: Add exports**

Add these lines to the existing `index.ts`, following the established grouping pattern:

After the existing schema exports, add:
```typescript
export { recurringExpenseSchema, type RecurringExpenseFormValues } from './schemas/recurring-expense-schema';
```

After the existing hook exports, add:
```typescript
export { useRecurringExpenses } from './hooks/use-recurring-expenses';
export { useExpenseGenerationPreview } from './hooks/use-expense-generation-preview';
```

- [ ] **Step 2: Verify build**

Run: `npx turbo build --filter=@onereal/accounting`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add modules/accounting/src/index.ts
git commit -m "feat: export recurring expense schema and hooks from accounting barrel"
```

---

## Chunk 5: UI — Recurring Expense Dialog

### Task 11: Create recurring expense dialog component

**Files:**
- Create: `apps/web/components/accounting/recurring-expense-dialog.tsx`

- [ ] **Step 1: Write the dialog**

Reference: `apps/web/components/accounting/expense-dialog.tsx` for the form dialog pattern.

```typescript
'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { recurringExpenseSchema, type RecurringExpenseFormValues } from '@onereal/accounting';
import { createRecurringExpense } from '@onereal/accounting/actions/create-recurring-expense';
import { updateRecurringExpense } from '@onereal/accounting/actions/update-recurring-expense';
import { useUser } from '@onereal/auth';
import { useProviders } from '@onereal/contacts';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RecurringExpense } from '@onereal/types';

const expenseTypeLabels: Record<string, string> = {
  mortgage: 'Mortgage',
  maintenance: 'Maintenance',
  repairs: 'Repairs',
  utilities: 'Utilities',
  insurance: 'Insurance',
  taxes: 'Taxes',
  management: 'Management',
  advertising: 'Advertising',
  legal: 'Legal',
  hoa: 'HOA',
  home_warranty: 'Home Warranty',
  other: 'Other',
};

interface RecurringExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurringExpense: RecurringExpense | null;
  propertyId: string;
  units?: { id: string; unit_number: string }[];
}

export function RecurringExpenseDialog({
  open,
  onOpenChange,
  recurringExpense,
  propertyId,
  units = [],
}: RecurringExpenseDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });
  const providers = (providersData ?? []) as any[];

  const form = useForm<RecurringExpenseFormValues>({
    resolver: zodResolver(recurringExpenseSchema),
    defaultValues: recurringExpense ? {
      property_id: recurringExpense.property_id,
      unit_id: recurringExpense.unit_id ?? undefined,
      expense_type: recurringExpense.expense_type as RecurringExpenseFormValues['expense_type'],
      amount: recurringExpense.amount,
      frequency: recurringExpense.frequency,
      description: recurringExpense.description,
      provider_id: recurringExpense.provider_id ?? undefined,
      start_date: recurringExpense.start_date,
      end_date: recurringExpense.end_date ?? undefined,
      is_active: recurringExpense.is_active,
    } : {
      property_id: propertyId,
      unit_id: undefined,
      expense_type: 'mortgage',
      amount: undefined as unknown as number,
      frequency: 'monthly',
      description: '',
      provider_id: undefined,
      start_date: new Date().toISOString().split('T')[0],
      end_date: undefined,
      is_active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(recurringExpense ? {
        property_id: recurringExpense.property_id,
        unit_id: recurringExpense.unit_id ?? undefined,
        expense_type: recurringExpense.expense_type as RecurringExpenseFormValues['expense_type'],
        amount: recurringExpense.amount,
        frequency: recurringExpense.frequency,
        description: recurringExpense.description,
        provider_id: recurringExpense.provider_id ?? undefined,
        start_date: recurringExpense.start_date,
        end_date: recurringExpense.end_date ?? undefined,
        is_active: recurringExpense.is_active,
      } : {
        property_id: propertyId,
        unit_id: undefined,
        expense_type: 'mortgage',
        amount: undefined as unknown as number,
        frequency: 'monthly',
        description: '',
        provider_id: undefined,
        start_date: new Date().toISOString().split('T')[0],
        end_date: undefined,
        is_active: true,
      });
    }
  }, [open, recurringExpense, propertyId, form]);

  async function onSubmit(values: RecurringExpenseFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = recurringExpense
      ? await updateRecurringExpense(recurringExpense.id, values)
      : await createRecurringExpense(activeOrg.id, values);

    if (result.success) {
      toast.success(recurringExpense ? 'Recurring expense updated' : 'Recurring expense created');
      queryClient.invalidateQueries({ queryKey: ['recurring-expenses'] });
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
          <DialogTitle>{recurringExpense ? 'Edit Recurring Expense' : 'Add Recurring Expense'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="expense_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(expenseTypeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="frequency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Frequency *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="provider_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} defaultValue={field.value ?? 'none'}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {providers.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}{p.company_name ? ` (${p.company_name})` : ''}</SelectItem>
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
                        {units.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.unit_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="start_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="end_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="E.g., Monthly mortgage payment" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{recurringExpense ? 'Update' : 'Create'}</Button>
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
git add apps/web/components/accounting/recurring-expense-dialog.tsx
git commit -m "feat: add recurring expense dialog component"
```

---

## Chunk 6: UI — Generate Expenses Dialog + Page Updates

### Task 12: Create generate expenses dialog

**Files:**
- Create: `apps/web/components/accounting/generate-expenses-dialog.tsx`

- [ ] **Step 1: Write the dialog**

Reference: `apps/web/components/billing/generate-invoices-dialog.tsx` for the pattern.

```typescript
'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenseGenerationPreview } from '@onereal/accounting';
import { generateExpenses } from '@onereal/accounting/actions/generate-expenses';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface GenerateExpensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function GenerateExpensesDialog({ open, onOpenChange }: GenerateExpensesDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: preview, isLoading: previewLoading } = useExpenseGenerationPreview(
    activeOrg?.id ?? null,
    month,
    year,
  );

  async function handleGenerate() {
    if (!activeOrg) return;
    setIsGenerating(true);
    const result = await generateExpenses(activeOrg.id, month, year);
    setIsGenerating(false);

    if (result.success) {
      const { generated, skipped } = result.data;
      if (generated > 0) {
        let msg = `Generated ${generated} expense(s)`;
        if (skipped > 0) msg += ` (${skipped} already existed)`;
        toast.success(msg);
      } else if (skipped > 0) {
        toast.info(`All ${skipped} expense(s) already exist for this month`);
      } else {
        toast.info('No recurring expenses to generate');
      }
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['expense-generation-preview'] });
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
          <DialogTitle>Generate Recurring Expenses</DialogTitle>
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
              <p className="text-sm text-muted-foreground">Checking recurring expenses...</p>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{preview.eligible}</strong> recurring expense(s)
                to generate for {monthNames[month - 1]} {year}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No recurring expenses configured.</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !preview?.eligible}
            >
              {isGenerating
                ? 'Generating...'
                : `Generate ${preview?.eligible ?? 0} Expense(s)`}
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
git add apps/web/components/accounting/generate-expenses-dialog.tsx
git commit -m "feat: add generate expenses dialog component"
```

---

### Task 13: Add Generate Expenses button to Outgoing page

**Files:**
- Modify: `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`

- [ ] **Step 1: Add import and state**

At the top of the file, add the import:
```typescript
import { GenerateExpensesDialog } from '@/components/accounting/generate-expenses-dialog';
import { RefreshCw } from 'lucide-react';
```

Add state inside the component (after the existing `editingExpense` state):
```typescript
const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
```

- [ ] **Step 2: Add Generate button next to New Expense**

In the header section, add a "Generate" button before the "New Expense" button:

Replace:
```typescript
          <Button className="gap-2" onClick={handleNewExpense}>
            <Plus className="h-4 w-4" /> New Expense
          </Button>
```

With:
```typescript
          <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
            <RefreshCw className="h-4 w-4" /> Generate
          </Button>
          <Button className="gap-2" onClick={handleNewExpense}>
            <Plus className="h-4 w-4" /> New Expense
          </Button>
```

- [ ] **Step 3: Add the dialog at the bottom of the return**

After the existing `<ExpenseDialog ... />`, add:
```typescript
      <GenerateExpensesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/outgoing/page.tsx
git commit -m "feat: add Generate Expenses button to Outgoing page"
```

---

## Chunk 7: UI — Property Recurring Tab

### Task 14: Add Recurring tab to property detail page

**Files:**
- Modify: `apps/web/components/properties/property-detail-tabs.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of the file:

```typescript
import { useRecurringExpenses } from '@onereal/accounting';
import { updateRecurringExpense } from '@onereal/accounting/actions/update-recurring-expense';
import { deleteRecurringExpense } from '@onereal/accounting/actions/delete-recurring-expense';
import { RecurringExpenseDialog } from '@/components/accounting/recurring-expense-dialog';
import type { RecurringExpense } from '@onereal/types';
import { Switch } from '@onereal/ui';
```

Also add `DollarSign` to the existing lucide-react import if not already there — check the existing import line. The icon `Repeat` should also be imported for the tab (or use existing icons):

```typescript
import { ..., Repeat } from 'lucide-react';
```

- [ ] **Step 2: Add Recurring tab trigger**

In the `<TabsList>` section, add a new trigger after Leases:

```typescript
        <TabsTrigger value="recurring">Recurring</TabsTrigger>
```

- [ ] **Step 3: Add Recurring tab content**

After the `<TabsContent value="leases">` block (around line 87), add:

```typescript
      <TabsContent value="recurring">
        <PropertyRecurringExpenses propertyId={property.id} units={units} />
      </TabsContent>
```

- [ ] **Step 4: Add the PropertyRecurringExpenses component**

Add this inline component after the existing `PropertyLeases` component (around line 203), following the same pattern:

```typescript
function PropertyRecurringExpenses({ propertyId, units }: { propertyId: string; units: Unit[] }) {
  const queryClient = useQueryClient();
  const { data: recurringData } = useRecurringExpenses(propertyId);
  const recurring = (recurringData ?? []) as RecurringExpense[];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring expense? Already-generated expenses will not be affected.')) return;
    const result = await deleteRecurringExpense(id);
    if (result.success) {
      toast.success('Recurring expense deleted');
      queryClient.invalidateQueries({ queryKey: ['recurring-expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggleActive(item: RecurringExpense) {
    const result = await updateRecurringExpense(item.id, {
      property_id: item.property_id,
      unit_id: item.unit_id,
      expense_type: item.expense_type as any,
      amount: item.amount,
      frequency: item.frequency,
      description: item.description,
      provider_id: item.provider_id,
      start_date: item.start_date,
      end_date: item.end_date,
      is_active: !item.is_active,
    });
    if (result.success) {
      queryClient.invalidateQueries({ queryKey: ['recurring-expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  const unitOptions = units.map((u) => ({ id: u.id, unit_number: u.unit_number ?? '' }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Recurring Expense
        </Button>
      </div>
      {recurring.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No recurring expenses set up for this property yet.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recurring.map((item) => (
                <TableRow key={item.id} className={!item.is_active ? 'opacity-50' : ''}>
                  <TableCell className="capitalize">{item.expense_type.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-right font-medium">
                    ${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="capitalize">{item.frequency}</TableCell>
                  <TableCell>{item.service_providers?.name ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={() => handleToggleActive(item)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(item); setDialogOpen(true); }}>
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
      <RecurringExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recurringExpense={editing}
        propertyId={propertyId}
        units={unitOptions}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `npx turbo build --filter=web`
Expected: Build succeeds. If there are type errors, fix them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/properties/property-detail-tabs.tsx
git commit -m "feat: add Recurring tab to property detail page"
```

---

### Task 15: Push and verify deployment

- [ ] **Step 1: Push all changes**

Run: `git push`
Expected: Push succeeds.

- [ ] **Step 2: Verify Vercel build**

Check that the Vercel deployment at `one-real-web.vercel.app` builds successfully.

- [ ] **Step 3: Manual verification**

Test in the app:
1. Navigate to a property detail page → "Recurring" tab should be visible
2. Click "Add Recurring Expense" → dialog appears with all fields
3. Create a monthly mortgage expense → appears in the table
4. Toggle active/inactive switch → row dims/undims
5. Navigate to Outgoing page → "Generate" button visible
6. Click "Generate" → dialog shows preview count
7. Generate expenses for current month → success toast
8. Re-generate for same month → shows "already existed"
9. Expenses appear in the Outgoing page table

# Payable Invoices Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the Outgoing page from raw expense records to payable invoices with full payment lifecycle tracking, reusing the existing invoice system.

**Architecture:** Recurring expense templates generate payable invoices (instead of raw expenses). The Outgoing page is rewritten to mirror the Incoming page structure using `InvoiceTable` with `direction: 'payable'`. Payments on payable invoices auto-create expense records via the existing `recordPayment` action.

**Tech Stack:** Next.js 15, Supabase (PostgreSQL), TanStack Query, React Hook Form + Zod, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-20-payable-invoices-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260320000001_payable_invoices.sql` | CREATE | Add `expense_type`, `recurring_expense_id`, `generated_for_period` columns to invoices table + partial unique index + migrate existing expenses to paid invoices |
| `packages/types/src/models.ts` | MODIFY (lines 288-313) | Add 3 new fields to `Invoice` interface |
| `modules/billing/src/schemas/invoice-schema.ts` | MODIFY (lines 1-15) | Add optional `expense_type` field to schema |
| `modules/billing/src/actions/record-payment.ts` | MODIFY (line 78) | Use `invoice.expense_type` instead of hardcoded `'maintenance'` |
| `modules/accounting/src/actions/generate-expenses.ts` | MODIFY (entire file) | Insert into `invoices` table instead of `expenses` table |
| `apps/web/app/(dashboard)/accounting/outgoing/page.tsx` | REWRITE (entire file) | Mirror Incoming page with `direction: 'payable'` |
| `apps/web/components/billing/invoice-dialog.tsx` | MODIFY (lines 40-260) | Add `expense_type` select field for payable direction |
| `apps/web/components/accounting/generate-expenses-dialog.tsx` | MODIFY (lines 25-134) | Update labels, toast messages, and cache invalidation |

---

## Chunk 1: Database + Types + Schema

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260320000001_payable_invoices.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Extend invoices table for payable invoice support

-- Expense type for payable invoices (categorization: mortgage, utilities, etc.)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS expense_type TEXT;

-- Link payable invoices back to recurring expense templates
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recurring_expense_id UUID
  REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;

-- Idempotency for generated invoices: stores 'YYYY-MM' string for target month
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS generated_for_period TEXT;

-- Partial unique index: one generated invoice per template per period
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_recurring_period
  ON public.invoices(recurring_expense_id, generated_for_period)
  WHERE recurring_expense_id IS NOT NULL;

-- Migrate existing expenses to paid payable invoices.
-- These represent money already spent, so status='paid' and amount_paid=amount.
-- Uses next_invoice_number() to generate proper invoice numbers.
-- Preserves original created_at/updated_at timestamps for audit trails.
-- Note: provider_id exists on expenses (added in 20260315000007_contacts_tables.sql).
DO $$
DECLARE
  exp RECORD;
  inv_number TEXT;
BEGIN
  FOR exp IN SELECT * FROM public.expenses ORDER BY created_at ASC LOOP
    inv_number := public.next_invoice_number(exp.org_id);
    INSERT INTO public.invoices (
      org_id, invoice_number, direction, status, property_id, unit_id,
      provider_id, description, amount, amount_paid, due_date, issued_date,
      expense_type, recurring_expense_id, generated_for_period,
      created_at, updated_at
    ) VALUES (
      exp.org_id, inv_number, 'payable', 'paid', exp.property_id, exp.unit_id,
      exp.provider_id, exp.description, exp.amount, exp.amount, exp.transaction_date, exp.transaction_date,
      exp.expense_type, exp.recurring_expense_id, exp.generated_for_period,
      exp.created_at, exp.updated_at
    );
  END LOOP;
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260320000001_payable_invoices.sql
git commit -m "feat: add payable invoices migration - extend invoices table and migrate expenses"
```

---

### Task 2: Update Invoice TypeScript Interface

**Files:**
- Modify: `packages/types/src/models.ts:288-313`

- [ ] **Step 1: Add 3 new fields to Invoice interface**

Add `expense_type`, `recurring_expense_id`, and `generated_for_period` after the `payment_processor` field (before `created_at`):

```typescript
  payment_processor: 'stripe' | 'plaid' | null;
  expense_type: string | null;
  recurring_expense_id: string | null;
  generated_for_period: string | null;
  created_at: string;
  updated_at: string;
```

- [ ] **Step 2: Commit**

```bash
git add packages/types/src/models.ts
git commit -m "feat: add expense_type, recurring_expense_id, generated_for_period to Invoice type"
```

---

### Task 3: Add expense_type to Invoice Schema

**Files:**
- Modify: `modules/billing/src/schemas/invoice-schema.ts`

- [ ] **Step 1: Add `expense_type` to the Zod schema**

Add after `issued_date`:

```typescript
export const invoiceSchema = z.object({
  direction: z.enum(['receivable', 'payable']),
  tenant_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().default(''),
  amount: z.coerce.number().positive('Amount must be positive'),
  due_date: z.string().min(1, 'Due date is required'),
  issued_date: z.string().optional(),
  expense_type: z.string().optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/schemas/invoice-schema.ts
git commit -m "feat: add optional expense_type to invoice schema"
```

---

## Chunk 2: Server Action Modifications

### Task 4: Fix record-payment.ts expense_type

**Files:**
- Modify: `modules/billing/src/actions/record-payment.ts:78`

- [ ] **Step 1: Replace hardcoded 'maintenance' with invoice's expense_type**

Change line 78 from:
```typescript
          expense_type: 'maintenance',
```
to:
```typescript
          expense_type: invoice.expense_type || 'other',
```

- [ ] **Step 2: Commit**

```bash
git add modules/billing/src/actions/record-payment.ts
git commit -m "fix: use invoice expense_type instead of hardcoded 'maintenance' in record-payment"
```

---

### Task 5: Modify generate-expenses.ts to create invoices

**Files:**
- Modify: `modules/accounting/src/actions/generate-expenses.ts` (entire file)

- [ ] **Step 1: Rewrite the file to insert into invoices instead of expenses**

The full replacement file content:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

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
 * Check which templates already have generated invoices for this period.
 * Returns a Set of recurring_expense_id values that should be skipped.
 */
async function fetchExistingForPeriod(
  db: any,
  templateIds: string[],
  period: string
): Promise<Set<string>> {
  if (templateIds.length === 0) return new Set();

  const { data: existing } = await db
    .from('invoices')
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
    const dueDate = `${year}-${String(month).padStart(2, '0')}-01`;

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

      // Get next invoice number via RPC
      const { data: invoiceNumber, error: rpcError } = await db.rpc(
        'next_invoice_number',
        { p_org_id: template.org_id }
      );

      if (rpcError) {
        return { success: false, error: rpcError.message };
      }

      const { error: insertError } = await db.from('invoices').insert({
        org_id: template.org_id,
        invoice_number: invoiceNumber,
        direction: 'payable',
        status: 'open',
        property_id: template.property_id,
        unit_id: template.unit_id,
        amount: template.amount,
        amount_paid: 0,
        description: template.description,
        expense_type: template.expense_type,
        provider_id: template.provider_id,
        due_date: dueDate,
        issued_date: dueDate,
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

Key changes from original:
- Removed unused `monthNames` constant (dead code)
- `fetchExistingForPeriod`: queries `invoices` table instead of `expenses`
- `generateExpenses`: inserts into `invoices` with `invoice_number` (via RPC), `direction: 'payable'`, `status: 'open'`, `amount_paid: 0`, `due_date`, `issued_date` — instead of inserting into `expenses` with `transaction_date`
- `previewGenerateExpenses`: unchanged logic (already calls `fetchExistingForPeriod` which now checks invoices)

- [ ] **Step 2: Commit**

```bash
git add modules/accounting/src/actions/generate-expenses.ts
git commit -m "feat: generate payable invoices instead of raw expenses from recurring templates"
```

---

## Chunk 3: UI Changes

### Task 6: Add expense_type field to InvoiceDialog

**Files:**
- Modify: `apps/web/components/billing/invoice-dialog.tsx`

- [ ] **Step 1: Add expense_type to form defaultValues and reset**

In the `useForm` defaultValues (line 42-62) and the `useEffect` form.reset (line 65-88), add `expense_type` to both the invoice-editing and new-invoice branches:

For the invoice branch (editing):
```typescript
expense_type: invoice?.expense_type ?? undefined,
```

For the new invoice branch:
```typescript
expense_type: undefined,
```

Add to both the `useForm defaultValues` object AND the `useEffect form.reset()` object.

- [ ] **Step 2: Add expense_type Select after the Vendor field**

After the `{direction === 'payable' && ( ... provider_id field ... )}` block (after line 221), add a new expense_type field:

```tsx
            {direction === 'payable' && (
              <FormField control={form.control} name="expense_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expense Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="mortgage">Mortgage</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="repairs">Repairs</SelectItem>
                      <SelectItem value="utilities">Utilities</SelectItem>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="taxes">Taxes</SelectItem>
                      <SelectItem value="management">Management</SelectItem>
                      <SelectItem value="advertising">Advertising</SelectItem>
                      <SelectItem value="legal">Legal</SelectItem>
                      <SelectItem value="hoa">HOA</SelectItem>
                      <SelectItem value="home_warranty">Home Warranty</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/billing/invoice-dialog.tsx
git commit -m "feat: add expense_type select to InvoiceDialog for payable invoices"
```

---

### Task 7: Update GenerateExpensesDialog labels and cache invalidation

**Files:**
- Modify: `apps/web/components/accounting/generate-expenses-dialog.tsx`

- [ ] **Step 1: Update dialog title**

Change line 83:
```tsx
<DialogTitle>Generate Recurring Expenses</DialogTitle>
```
to:
```tsx
<DialogTitle>Generate Monthly Bills</DialogTitle>
```

- [ ] **Step 2: Update preview text**

Change lines 110-113 from:
```tsx
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{preview.eligible}</strong> recurring expense(s)
                to generate for {monthNames[month - 1]} {year}.
              </p>
```
to:
```tsx
              <p className="text-sm text-muted-foreground">
                This will create bills for <strong className="text-foreground">{preview.eligible} active recurring expense(s)</strong> that
                don&apos;t have {monthNames[month - 1]} {year} bills yet.
              </p>
```

- [ ] **Step 3: Update toast messages**

Change lines 47-55 from:
```tsx
      if (generated > 0) {
        let msg = `Generated ${generated} expense(s)`;
        if (skipped > 0) msg += ` (${skipped} already existed)`;
        toast.success(msg);
      } else if (skipped > 0) {
        toast.info(`All ${skipped} expense(s) already exist for this month`);
      } else {
        toast.info('No recurring expenses to generate');
      }
```
to:
```tsx
      if (generated > 0) {
        let msg = `Generated ${generated} bill(s)`;
        if (skipped > 0) msg += ` (${skipped} already existed)`;
        toast.success(msg);
      } else if (skipped > 0) {
        toast.info(`All ${skipped} bill(s) already exist for this month`);
      } else {
        toast.info('No recurring expenses to generate');
      }
```

- [ ] **Step 4: Update cache invalidation**

Change lines 56-58 from:
```tsx
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['expense-generation-preview'] });
```
to:
```tsx
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['expense-generation-preview'] });
```

- [ ] **Step 5: Update generate button text**

Change line 127:
```tsx
                : `Generate ${preview?.eligible ?? 0} Expense(s)`}
```
to:
```tsx
                : `Generate ${preview?.eligible ?? 0} Bill(s)`}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/accounting/generate-expenses-dialog.tsx
git commit -m "feat: update generate dialog labels from expenses to bills, fix cache invalidation"
```

---

### Task 8: Rewrite Outgoing Page

**Files:**
- Rewrite: `apps/web/app/(dashboard)/accounting/outgoing/page.tsx`

- [ ] **Step 1: Rewrite the entire Outgoing page to mirror Incoming page**

The new file mirrors `apps/web/app/(dashboard)/accounting/incoming/page.tsx` but with `direction: 'payable'`, vendor filter instead of tenant filter, and "Generate Bills" / "New Bill" buttons:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useProviders } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { deleteInvoice } from '@onereal/billing/actions/delete-invoice';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { GenerateExpensesDialog } from '@/components/accounting/generate-expenses-dialog';
import { resolveDateRange } from '@/lib/date-range';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  cn,
} from '@onereal/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice } from '@onereal/types';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

type TabValue = 'open' | 'paid' | 'all';

export default function OutgoingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [dateRange, setDateRange] = useState('current_month');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');

  const resolvedDates = useMemo(() => resolveDateRange(dateRange), [dateRange]);

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });
  const providers = (providersData ?? []) as any[];

  // Map tab to status filter — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: invoicesRaw, isLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'payable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    providerId: vendorFilter || undefined,
    search: search || undefined,
    from: resolvedDates?.from,
    to: resolvedDates?.to,
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

  async function handleDelete(invoice: Invoice) {
    if (!confirm(`Delete invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    const result = await deleteInvoice(invoice.id);
    if (result.success) {
      toast.success('Invoice deleted');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
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
        <h1 className="text-2xl font-bold">Outgoing</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {DATE_RANGES.map((r) => (
              <Button
                key={r.value}
                variant={dateRange === r.value ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setDateRange(r.value)}
                className={cn('text-xs', dateRange !== r.value && 'text-muted-foreground')}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
              <RefreshCw className="h-4 w-4" /> Generate Bills
            </Button>
            <Button className="gap-2" onClick={handleNewInvoice}>
              <Plus className="h-4 w-4" /> New Bill
            </Button>
          </div>
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
          placeholder="Search bills..."
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
        <Select value={vendorFilter} onValueChange={(v) => setVendorFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Vendors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.company_name ? ` (${p.company_name})` : ''}
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
            {tab === 'open' ? 'No open bills' : tab === 'paid' ? 'No paid bills' : 'No bills yet'}
          </p>
          <Button onClick={handleNewInvoice}>Create your first bill</Button>
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          direction="payable"
          onPay={handlePay}
          onEdit={handleEdit}
          onVoid={handleVoid}
          onDelete={handleDelete}
        />
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
      <GenerateExpensesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </div>
  );
}
```

Key differences from Incoming page:
- `direction: 'payable'` instead of `'receivable'`
- `vendorFilter` + `useProviders` instead of `tenantFilter` + `useTenants`
- `providerId` filter in `useInvoices` instead of `tenantId`
- "Generate Bills" + `RefreshCw` icon instead of "Generate Invoices" + `Zap` icon
- "New Bill" instead of "New Invoice"
- `GenerateExpensesDialog` instead of `GenerateInvoicesDialog`
- Empty state says "bills" instead of "invoices"
- `defaultDirection="payable"` on InvoiceDialog

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(dashboard)/accounting/outgoing/page.tsx
git commit -m "feat: rewrite Outgoing page to use payable invoices with tabs, vendor filter, and InvoiceTable"
```

---

## Implementation Order

Execute tasks **sequentially** in order 1-8. The ordering ensures each task builds on the previous:

1. **Task 1** (Migration) — columns must exist before any code references them
2. **Task 2** (Types) — TypeScript interface must match DB before code uses the fields
3. **Task 3** (Schema) — Zod schema must include `expense_type` before actions/dialogs use it
4. **Task 4** (record-payment fix) — small, independent fix
5. **Task 5** (generate-expenses rewrite) — depends on migration (invoices table has new columns)
6. **Task 6** (InvoiceDialog) — depends on schema (expense_type in Zod)
7. **Task 7** (GenerateExpensesDialog) — depends on generate-expenses action changes
8. **Task 8** (Outgoing page rewrite) — depends on all above being complete

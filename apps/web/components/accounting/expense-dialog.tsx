'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { expenseSchema, type ExpenseFormValues } from '@onereal/accounting';
import { createExpense } from '@onereal/accounting/actions/create-expense';
import { updateExpense } from '@onereal/accounting/actions/update-expense';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import { useProviders, useTenants } from '@onereal/contacts';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Expense } from '@onereal/types';

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

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
}

export function ExpenseDialog({ open, onOpenChange, expense }: ExpenseDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });
  const providers = (providersData ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense ? {
      property_id: expense.property_id,
      unit_id: expense.unit_id ?? undefined,
      tenant_id: (expense as any).tenant_id ?? undefined,
      lease_id: (expense as any).lease_id ?? undefined,
      amount: expense.amount,
      expense_type: expense.expense_type as ExpenseFormValues['expense_type'],
      description: expense.description,
      transaction_date: expense.transaction_date,
      provider_id: expense.provider_id ?? undefined,
    } : {
      property_id: '',
      unit_id: undefined,
      tenant_id: undefined,
      lease_id: undefined,
      amount: undefined as unknown as number,
      expense_type: 'mortgage',
      description: '',
      transaction_date: new Date().toISOString().split('T')[0],
      provider_id: undefined,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(expense ? {
        property_id: expense.property_id,
        unit_id: expense.unit_id ?? undefined,
        tenant_id: (expense as any).tenant_id ?? undefined,
        lease_id: (expense as any).lease_id ?? undefined,
        amount: expense.amount,
        expense_type: expense.expense_type as ExpenseFormValues['expense_type'],
        description: expense.description,
        transaction_date: expense.transaction_date,
        provider_id: expense.provider_id ?? undefined,
      } : {
        property_id: '',
        unit_id: undefined,
        tenant_id: undefined,
        lease_id: undefined,
        amount: undefined as unknown as number,
        expense_type: 'mortgage',
        description: '',
        transaction_date: new Date().toISOString().split('T')[0],
        provider_id: undefined,
      });
    }
  }, [open, expense, form]);

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  const filteredTenants = useMemo(() => {
    if (!selectedPropertyId) return tenants.map((t: any) => ({ ...t, _hasActiveLease: false }));
    return tenants
      .filter((t: any) =>
        t.lease_tenants?.some((lt: any) => lt.leases?.units?.property_id === selectedPropertyId),
      )
      .map((t: any) => ({
        ...t,
        _hasActiveLease: t.lease_tenants?.some((lt: any) => {
          const lease = lt.leases;
          return lease?.status === 'active' && lease.units?.property_id === selectedPropertyId;
        }),
      }));
  }, [tenants, selectedPropertyId]);

  const selectedTenantId = form.watch('tenant_id');
  useEffect(() => {
    if (!selectedTenantId || !selectedPropertyId) return;
    const tenant = tenants.find((t: any) => t.id === selectedTenantId);
    const matchingLeases: any[] = (tenant?.lease_tenants ?? [])
      .filter((lt: any) => lt.leases?.units?.property_id === selectedPropertyId)
      .map((lt: any) => lt.leases)
      .filter(Boolean);
    const active = matchingLeases.find((l: any) => l.status === 'active');
    const mostRecent = [...matchingLeases].sort((a, b) =>
      (b.start_date ?? '').localeCompare(a.start_date ?? ''),
    )[0];
    const lease = active ?? mostRecent;
    form.setValue('lease_id', lease?.id ?? null);
  }, [selectedTenantId, selectedPropertyId, tenants, form]);

  async function onSubmit(values: ExpenseFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = expense
      ? await updateExpense(expense.id, values)
      : await createExpense(activeOrg.id, values);

    if (result.success) {
      toast.success(expense ? 'Expense updated' : 'Expense created');
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
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="expense_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
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
              <FormField control={form.control} name="provider_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Provider</FormLabel>
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
              <FormField control={form.control} name="tenant_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant (optional)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value ?? 'none'}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {filteredTenants.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.first_name} {t.last_name}
                          {!t._hasActiveLease && (
                            <span className="ml-2 text-xs text-muted-foreground">(no active lease)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="transaction_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="Enter description" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{expense ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

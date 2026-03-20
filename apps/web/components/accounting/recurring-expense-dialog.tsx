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

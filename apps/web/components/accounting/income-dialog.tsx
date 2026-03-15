'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { incomeSchema, type IncomeFormValues } from '@onereal/accounting';
import { createIncome } from '@onereal/accounting/actions/create-income';
import { updateIncome } from '@onereal/accounting/actions/update-income';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Income } from '@onereal/types';

const incomeTypeLabels: Record<string, string> = {
  rent: 'Rent',
  deposit: 'Deposit',
  late_fee: 'Late Fee',
  other: 'Other',
};

interface IncomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
}

export function IncomeDialog({ open, onOpenChange, income }: IncomeDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];

  const form = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeSchema),
    defaultValues: income ? {
      property_id: income.property_id,
      unit_id: income.unit_id ?? undefined,
      amount: income.amount,
      income_type: income.income_type as IncomeFormValues['income_type'],
      description: income.description,
      transaction_date: income.transaction_date,
    } : {
      property_id: '',
      unit_id: undefined,
      amount: undefined as unknown as number,
      income_type: 'rent',
      description: '',
      transaction_date: new Date().toISOString().split('T')[0],
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(income ? {
        property_id: income.property_id,
        unit_id: income.unit_id ?? undefined,
        amount: income.amount,
        income_type: income.income_type as IncomeFormValues['income_type'],
        description: income.description,
        transaction_date: income.transaction_date,
      } : {
        property_id: '',
        unit_id: undefined,
        amount: undefined as unknown as number,
        income_type: 'rent',
        description: '',
        transaction_date: new Date().toISOString().split('T')[0],
      });
    }
  }, [open, income, form]);

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  async function onSubmit(values: IncomeFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = income
      ? await updateIncome(income.id, values)
      : await createIncome(activeOrg.id, values);

    if (result.success) {
      toast.success(income ? 'Income updated' : 'Income created');
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
              <FormField control={form.control} name="income_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(incomeTypeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
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
              <Button type="submit">{income ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

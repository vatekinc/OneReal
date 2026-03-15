'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { leaseSchema, type LeaseFormValues, useTenants } from '@onereal/contacts';
import { createLease } from '@onereal/contacts/actions/create-lease';
import { updateLease } from '@onereal/contacts/actions/update-lease';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Button,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const leaseStatusLabels: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
};

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
      status: lease.status as LeaseFormValues['status'],
    } : defaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(lease ? {
        property_id: lease.units?.property_id ?? '',
        unit_id: lease.unit_id,
        tenant_id: lease.tenant_id,
        start_date: lease.start_date ?? '',
        end_date: lease.end_date ?? '',
        rent_amount: lease.rent_amount ?? 0,
        deposit_amount: lease.deposit_amount ?? 0,
        payment_due_day: lease.payment_due_day ?? 1,
        status: lease.status as LeaseFormValues['status'],
      } : defaultValues);
    }
  }, [open, lease, form, defaultTenantId, defaultPropertyId]);

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  async function onSubmit(values: LeaseFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = lease
      ? await updateLease(lease.id, values)
      : await createLease(activeOrg.id, values);

    if (result.success) {
      toast.success(lease ? 'Lease updated' : 'Lease created');
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      onOpenChange(false);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{lease ? 'Edit Lease' : 'Add Lease'}</DialogTitle>
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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{lease ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

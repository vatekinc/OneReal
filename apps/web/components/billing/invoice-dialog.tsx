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
      expense_type: invoice.expense_type ?? undefined,
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
      expense_type: undefined,
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
        expense_type: invoice.expense_type ?? undefined,
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
        expense_type: undefined,
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

  // Filter tenants to only those with an active lease on the selected property
  const filteredTenants = useMemo(() => {
    if (!selectedPropertyId) return tenants;
    return tenants.filter((t: any) =>
      t.lease_tenants?.some((lt: any) => {
        const lease = lt.leases;
        if (!lease || lease.status !== 'active') return false;
        return lease.units?.property_id === selectedPropertyId;
      }),
    );
  }, [tenants, selectedPropertyId]);

  // Auto-select tenant when property changes and only one tenant matches
  useEffect(() => {
    if (filteredTenants.length === 1 && direction === 'receivable') {
      form.setValue('tenant_id', filteredTenants[0].id);
    }
  }, [filteredTenants, direction, form]);

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
            {isEditing
              ? (direction === 'receivable' ? 'Edit Invoice' : 'Edit Bill')
              : (direction === 'receivable' ? 'New Invoice' : 'New Bill')}
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
                        {filteredTenants.map((t: any) => (
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
                <FormLabel>Description</FormLabel>
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

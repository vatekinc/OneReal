'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { creditSchema, type CreditFormValues } from '@onereal/billing';
import { createCredit } from '@onereal/billing/actions/create-credit';
import { useUser } from '@onereal/auth';
import { useTenants, useLeases } from '@onereal/contacts';
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

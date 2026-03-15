'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { tenantSchema, type TenantFormValues } from '@onereal/contacts';
import { createTenant } from '@onereal/contacts/actions/create-tenant';
import { updateTenant } from '@onereal/contacts/actions/update-tenant';
import { useUser } from '@onereal/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Tenant } from '@onereal/types';

interface TenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: Tenant | null;
}

const defaultValues: TenantFormValues = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  notes: '',
};

export function TenantDialog({ open, onOpenChange, tenant }: TenantDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: tenant ? {
      first_name: tenant.first_name,
      last_name: tenant.last_name,
      email: tenant.email ?? '',
      phone: tenant.phone ?? '',
      emergency_contact_name: tenant.emergency_contact_name ?? '',
      emergency_contact_phone: tenant.emergency_contact_phone ?? '',
      notes: tenant.notes ?? '',
    } : defaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(tenant ? {
        first_name: tenant.first_name,
        last_name: tenant.last_name,
        email: tenant.email ?? '',
        phone: tenant.phone ?? '',
        emergency_contact_name: tenant.emergency_contact_name ?? '',
        emergency_contact_phone: tenant.emergency_contact_phone ?? '',
        notes: tenant.notes ?? '',
      } : defaultValues);
    }
  }, [open, tenant, form]);

  async function onSubmit(values: TenantFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = tenant
      ? await updateTenant(tenant.id, values)
      : await createTenant(activeOrg.id, values);

    if (result.success) {
      toast.success(tenant ? 'Tenant updated' : 'Tenant created');
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tenant ? 'Edit Tenant' : 'Add Tenant'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="first_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name *</FormLabel>
                  <FormControl><Input {...field} placeholder="First name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="last_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name *</FormLabel>
                  <FormControl><Input {...field} placeholder="Last name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} placeholder="Email address" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input {...field} placeholder="Phone number" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="emergency_contact_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Emergency Contact</FormLabel>
                  <FormControl><Input {...field} placeholder="Contact name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="emergency_contact_phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Emergency Phone</FormLabel>
                  <FormControl><Input {...field} placeholder="Emergency phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Additional notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{tenant ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

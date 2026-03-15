'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { providerSchema, type ProviderFormValues } from '@onereal/contacts';
import { createProvider } from '@onereal/contacts/actions/create-provider';
import { updateProvider } from '@onereal/contacts/actions/update-provider';
import { useUser } from '@onereal/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Textarea, Button,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ServiceProvider } from '@onereal/types';

const providerCategoryLabels: Record<string, string> = {
  plumber: 'Plumber',
  electrician: 'Electrician',
  hvac: 'HVAC',
  general_contractor: 'General Contractor',
  cleaner: 'Cleaner',
  landscaper: 'Landscaper',
  painter: 'Painter',
  roofer: 'Roofer',
  pest_control: 'Pest Control',
  locksmith: 'Locksmith',
  appliance_repair: 'Appliance Repair',
  mortgage_provider: 'Mortgage Provider',
  other: 'Other',
};

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ServiceProvider | null;
}

const defaultValues: ProviderFormValues = {
  name: '',
  company_name: '',
  email: '',
  phone: '',
  category: 'other',
  notes: '',
};

export function ProviderDialog({ open, onOpenChange, provider }: ProviderDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: provider ? {
      name: provider.name,
      company_name: provider.company_name ?? '',
      email: provider.email ?? '',
      phone: provider.phone ?? '',
      category: provider.category as ProviderFormValues['category'],
      notes: provider.notes ?? '',
    } : defaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(provider ? {
        name: provider.name,
        company_name: provider.company_name ?? '',
        email: provider.email ?? '',
        phone: provider.phone ?? '',
        category: provider.category as ProviderFormValues['category'],
        notes: provider.notes ?? '',
      } : defaultValues);
    }
  }, [open, provider, form]);

  async function onSubmit(values: ProviderFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = provider
      ? await updateProvider(provider.id, values)
      : await createProvider(activeOrg.id, values);

    if (result.success) {
      toast.success(provider ? 'Provider updated' : 'Provider created');
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider'] });
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
          <DialogTitle>{provider ? 'Edit Service Provider' : 'Add Service Provider'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl><Input {...field} placeholder="Contact name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="company_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl><Input {...field} placeholder="Company name" /></FormControl>
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
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Category *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(providerCategoryLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <Button type="submit">{provider ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { propertySchema, type PropertyFormValues } from '@onereal/portfolio';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button, Card, CardContent, CardHeader, CardTitle,
} from '@onereal/ui';

interface PropertyFormProps {
  defaultValues?: Partial<PropertyFormValues>;
  onSubmit: (values: PropertyFormValues) => void;
  loading?: boolean;
  submitLabel?: string;
}

const propertyTypes = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'apartment_complex', label: 'Apartment Complex' },
  { value: 'condo', label: 'Condo' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'sold', label: 'Sold' },
];

export function PropertyForm({
  defaultValues,
  onSubmit,
  loading,
  submitLabel = 'Save Property',
}: PropertyFormProps) {
  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      name: '',
      type: 'single_family',
      status: 'active',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      zip: '',
      country: 'US',
      notes: '',
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Property Name *</FormLabel>
                <FormControl><Input placeholder="123 Main St" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {propertyTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="address_line1" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Address Line 1</FormLabel>
                <FormControl><Input {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="address_line2" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Address Line 2</FormLabel>
                <FormControl><Input {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="state" render={({ field }) => (
              <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="zip" render={({ field }) => (
              <FormItem><FormLabel>ZIP</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="country" render={({ field }) => (
              <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="year_built" render={({ field }) => (
              <FormItem>
                <FormLabel>Year Built</FormLabel>
                <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="purchase_price" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Price</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="purchase_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Date</FormLabel>
                <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="market_value" render={({ field }) => (
              <FormItem>
                <FormLabel>Market Value</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={3} {...field} /></FormControl>
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

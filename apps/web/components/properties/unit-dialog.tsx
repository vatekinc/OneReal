'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { unitSchema, type UnitFormValues } from '@onereal/portfolio';
import { createUnit } from '@onereal/portfolio/actions/create-unit';
import { updateUnit } from '@onereal/portfolio/actions/update-unit';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Unit } from '@onereal/types';

interface UnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unit: Unit | null;
}

export function UnitDialog({ open, onOpenChange, propertyId, unit }: UnitDialogProps) {
  const queryClient = useQueryClient();
  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: unit ? {
      unit_number: unit.unit_number,
      type: unit.type as UnitFormValues['type'],
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      square_feet: unit.square_feet,
      rent_amount: unit.rent_amount,
      deposit_amount: unit.deposit_amount,
      status: unit.status as UnitFormValues['status'],
      floor: unit.floor,
    } : {
      unit_number: '',
      status: 'vacant',
    },
  });

  async function onSubmit(values: UnitFormValues) {
    const result = unit
      ? await updateUnit(unit.id, values)
      : await createUnit(propertyId, values);

    if (result.success) {
      toast.success(unit ? 'Unit updated' : 'Unit created');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
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
          <DialogTitle>{unit ? 'Edit Unit' : 'Add Unit'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="unit_number" render={({ field }) => (
                <FormItem><FormLabel>Unit Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other'].map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="bedrooms" render={({ field }) => (
                <FormItem><FormLabel>Bedrooms</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bathrooms" render={({ field }) => (
                <FormItem><FormLabel>Bathrooms</FormLabel><FormControl><Input type="number" step="0.5" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="square_feet" render={({ field }) => (
                <FormItem><FormLabel>Square Feet</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="rent_amount" render={({ field }) => (
                <FormItem><FormLabel>Rent Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['vacant', 'occupied', 'maintenance', 'not_available'].map((s) => (
                        <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{unit ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

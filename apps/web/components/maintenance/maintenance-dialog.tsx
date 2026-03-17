'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  maintenanceRequestSchema, type MaintenanceRequestFormValues,
  maintenanceUpdateSchema, type MaintenanceUpdateFormValues,
} from '@onereal/maintenance';
import { createMaintenanceRequest } from '@onereal/maintenance/actions/create-maintenance-request';
import { updateMaintenanceRequest } from '@onereal/maintenance/actions/update-maintenance-request';
import { useUser } from '@onereal/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const categoryLabels: Record<string, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  appliance: 'Appliance',
  structural: 'Structural',
  pest: 'Pest',
  other: 'Other',
};

const priorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  emergency: 'Emergency',
};

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_parts: 'Waiting on Parts',
  completed: 'Completed',
  closed: 'Closed',
};

interface MaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: any | null;
  properties: any[];
}

export function MaintenanceDialog({ open, onOpenChange, request, properties }: MaintenanceDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const isEdit = !!request;

  // Create-mode form
  const createForm = useForm<MaintenanceRequestFormValues>({
    resolver: zodResolver(maintenanceRequestSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'other',
      priority: 'medium',
      unit_id: '',
    },
  });

  // Edit-mode form
  const updateForm = useForm<MaintenanceUpdateFormValues>({
    resolver: zodResolver(maintenanceUpdateSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (open) {
      if (request) {
        updateForm.reset({
          status: request.status,
          priority: request.priority,
          estimated_cost: request.estimated_cost ?? undefined,
          actual_cost: request.actual_cost ?? undefined,
          scheduled_date: request.scheduled_date ?? undefined,
          completed_date: request.completed_date ?? undefined,
        });
      } else {
        createForm.reset({
          title: '',
          description: '',
          category: 'other',
          priority: 'medium',
          unit_id: '',
        });
      }
    }
  }, [open, request, createForm, updateForm]);

  const selectedPropertyId = createForm.watch('unit_id');
  // Build a flat list of all units across all properties for unit selection
  const allUnits = useMemo(() => {
    const result: { id: string; label: string }[] = [];
    for (const p of properties) {
      for (const u of p.units ?? []) {
        result.push({
          id: u.id,
          label: `${p.name} — ${u.unit_number ?? 'Unit'}`,
        });
      }
    }
    return result;
  }, [properties]);

  async function onCreateSubmit(values: MaintenanceRequestFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }
    const result = await createMaintenanceRequest(activeOrg.id, values);
    if (result.success) {
      toast.success('Maintenance request created');
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      onOpenChange(false);
      createForm.reset();
    } else {
      toast.error(result.error);
    }
  }

  async function onUpdateSubmit(values: MaintenanceUpdateFormValues) {
    if (!request) return;
    const result = await updateMaintenanceRequest(request.id, values);
    if (result.success) {
      toast.success('Maintenance request updated');
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Update Request' : 'New Maintenance Request'}</DialogTitle>
        </DialogHeader>

        {isEdit ? (
          /* ── Edit mode ── */
          <Form {...updateForm}>
            <form onSubmit={updateForm.handleSubmit(onUpdateSubmit)} className="space-y-4">
              <div className="mb-2">
                <p className="text-sm text-muted-foreground">Title</p>
                <p className="font-medium">{request.title}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={updateForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={updateForm.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={updateForm.control} name="estimated_cost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Cost</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={updateForm.control} name="actual_cost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Actual Cost</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={updateForm.control} name="scheduled_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={updateForm.control} name="completed_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Completed Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit">Update</Button>
              </div>
            </form>
          </Form>
        ) : (
          /* ── Create mode ── */
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField control={createForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Leaking kitchen faucet" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={createForm.control} name="unit_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property / Unit *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {allUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(categoryLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={createForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe the issue..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit">Submit</Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTenantMaintenanceRequests, maintenanceRequestSchema, type MaintenanceRequestFormValues } from '@onereal/maintenance';
import { createMaintenanceRequest } from '@onereal/maintenance/actions/create-maintenance-request';
import { useTenantLease } from '@onereal/tenant-portal';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea,
} from '@onereal/ui';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format-date';

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-800',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  emergency: 'bg-red-100 text-red-800',
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  waiting_parts: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

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

export default function TenantMaintenancePage() {
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useTenantMaintenanceRequests();
  const { data: lease } = useTenantLease();
  const [dialogOpen, setDialogOpen] = useState(false);

  const hasLease = !!lease;
  const unitId = lease?.unit_id;
  const orgId = lease?.org_id;

  const form = useForm<MaintenanceRequestFormValues>({
    resolver: zodResolver(maintenanceRequestSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'other',
      priority: 'medium',
      unit_id: unitId ?? '',
    },
  });

  // Keep unit_id in sync with lease
  if (unitId && form.getValues('unit_id') !== unitId) {
    form.setValue('unit_id', unitId);
  }

  async function onSubmit(values: MaintenanceRequestFormValues) {
    if (!orgId) {
      toast.error('No lease found');
      return;
    }
    const result = await createMaintenanceRequest(orgId, values);
    if (result.success) {
      toast.success('Request submitted');
      queryClient.invalidateQueries({ queryKey: ['tenant-maintenance-requests'] });
      setDialogOpen(false);
      form.reset({ title: '', description: '', category: 'other', priority: 'medium', unit_id: unitId ?? '' });
    } else {
      toast.error(result.error);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Maintenance Requests</h1>
        <Button className="gap-2" onClick={() => setDialogOpen(true)} disabled={!hasLease}>
          <Plus className="h-4 w-4" /> Submit Request
        </Button>
      </div>

      {!hasLease && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-muted-foreground">You need an active lease to submit maintenance requests.</p>
          </CardContent>
        </Card>
      )}

      {(!requests || requests.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No maintenance requests yet.</p>
            {hasLease && (
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>Submit your first request</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {requests.map((req: any) => (
            <Card key={req.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{req.title}</CardTitle>
                  <div className="flex gap-2 shrink-0">
                    <Badge className={priorityColors[req.priority] ?? ''}>{req.priority}</Badge>
                    <Badge className={statusColors[req.status] ?? ''}>{req.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <span>Category: {categoryLabels[req.category] ?? req.category}</span>
                  <span>Property: {req.units?.properties?.name ?? '—'}</span>
                  <span>Unit: {req.units?.unit_number ?? '—'}</span>
                  <span>Submitted: {new Date(req.created_at).toLocaleDateString()}</span>
                  {req.scheduled_date && <span>Scheduled: {formatDate(req.scheduled_date)}</span>}
                </div>
                {req.description && (
                  <p className="mt-2 text-sm">{req.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Submit Request Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Maintenance Request</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Leaking kitchen faucet" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="category" render={({ field }) => (
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
                <FormField control={form.control} name="priority" render={({ field }) => (
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

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe the issue in detail..." rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* unit_id is hidden — auto-set from lease */}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit">Submit</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

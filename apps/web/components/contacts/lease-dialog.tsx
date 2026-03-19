'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { leaseSchema, type LeaseFormValues, useTenants, useLeaseCharges } from '@onereal/contacts';
import { createLease } from '@onereal/contacts/actions/create-lease';
import { updateLease } from '@onereal/contacts/actions/update-lease';
import { createLeaseCharge } from '@onereal/contacts/actions/create-lease-charge';
import { deleteLeaseCharge } from '@onereal/contacts/actions/delete-lease-charge';
import { useUser } from '@onereal/auth';
import { useProperties } from '@onereal/portfolio';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Button, Separator, Badge,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  Switch,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, X, Check, ChevronsUpDown } from 'lucide-react';
import type { LeaseCharge } from '@onereal/types';

const leaseStatusLabels: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
};

const frequencyLabels: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  one_time: 'One-Time',
};

interface PendingCharge {
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'one_time';
}

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

  // Existing charges (only when editing)
  const { data: existingCharges, refetch: refetchCharges } = useLeaseCharges(lease?.id ?? null);

  // Pending charges for new leases (not yet saved to DB)
  const [pendingCharges, setPendingCharges] = useState<PendingCharge[]>([]);
  const [newChargeName, setNewChargeName] = useState('');
  const [newChargeAmount, setNewChargeAmount] = useState('');
  const [newChargeFrequency, setNewChargeFrequency] = useState<'monthly' | 'yearly' | 'one_time'>('monthly');

  // Extract tenant_ids from lease_tenants junction data when editing
  const leaseDefaultTenantIds = useMemo(() => {
    if (!lease) return defaultTenantId ? [defaultTenantId] : [];
    return (lease.lease_tenants ?? []).map((lt: any) => lt.tenant_id);
  }, [lease, defaultTenantId]);

  const defaultValues: LeaseFormValues = {
    property_id: defaultPropertyId ?? '',
    unit_id: '',
    tenant_ids: defaultTenantId ? [defaultTenantId] : [],
    lease_type: 'fixed',
    start_date: '',
    end_date: '',
    rent_amount: undefined as unknown as number,
    deposit_amount: 0,
    payment_due_day: 1,
    status: 'draft',
    late_fee_type: null,
    late_fee_amount: null,
    late_fee_grace_days: null,
  };

  const form = useForm<LeaseFormValues>({
    resolver: zodResolver(leaseSchema),
    defaultValues: lease ? {
      property_id: lease.units?.property_id ?? '',
      unit_id: lease.unit_id,
      tenant_ids: leaseDefaultTenantIds,
      lease_type: lease.lease_type ?? 'fixed',
      start_date: lease.start_date ?? '',
      end_date: lease.end_date ?? '',
      rent_amount: lease.rent_amount ?? 0,
      deposit_amount: lease.deposit_amount ?? 0,
      payment_due_day: lease.payment_due_day ?? 1,
      status: lease.status === 'month_to_month' ? 'active' : (lease.status as LeaseFormValues['status']),
      late_fee_type: lease.late_fee_type ?? null,
      late_fee_amount: lease.late_fee_amount ?? null,
      late_fee_grace_days: lease.late_fee_grace_days ?? null,
    } : defaultValues,
  });

  useEffect(() => {
    if (open) {
      setPendingCharges([]);
      setNewChargeName('');
      setNewChargeAmount('');
      setNewChargeFrequency('monthly');
      form.reset(lease ? {
        property_id: lease.units?.property_id ?? '',
        unit_id: lease.unit_id,
        tenant_ids: leaseDefaultTenantIds,
        lease_type: lease.lease_type ?? 'fixed',
        start_date: lease.start_date ?? '',
        end_date: lease.end_date ?? '',
        rent_amount: lease.rent_amount ?? 0,
        deposit_amount: lease.deposit_amount ?? 0,
        payment_due_day: lease.payment_due_day ?? 1,
        status: lease.status === 'month_to_month' ? 'active' : (lease.status as LeaseFormValues['status']),
        late_fee_type: lease.late_fee_type ?? null,
        late_fee_amount: lease.late_fee_amount ?? null,
        late_fee_grace_days: lease.late_fee_grace_days ?? null,
      } : defaultValues);
    }
  }, [open, lease, form, defaultTenantId, defaultPropertyId]);

  const selectedPropertyId = form.watch('property_id');
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const units = (selectedProperty as any)?.units ?? [];

  const leaseType = form.watch('lease_type');
  const lateFeeType = form.watch('late_fee_type');
  const selectedTenantIds = form.watch('tenant_ids') ?? [];

  useEffect(() => {
    if (units.length === 1 && form.getValues('unit_id') !== units[0].id) {
      form.setValue('unit_id', units[0].id);
    }
  }, [units, form]);

  function toggleTenant(tenantId: string) {
    const current = form.getValues('tenant_ids') ?? [];
    if (current.includes(tenantId)) {
      form.setValue('tenant_ids', current.filter((id: string) => id !== tenantId), { shouldValidate: true });
    } else {
      form.setValue('tenant_ids', [...current, tenantId], { shouldValidate: true });
    }
  }

  function removeTenant(tenantId: string) {
    const current = form.getValues('tenant_ids') ?? [];
    form.setValue('tenant_ids', current.filter((id: string) => id !== tenantId), { shouldValidate: true });
  }

  function handleAddPendingCharge() {
    if (!newChargeName.trim() || !newChargeAmount) return;
    const amount = parseFloat(newChargeAmount);
    if (isNaN(amount) || amount <= 0) return;

    setPendingCharges([...pendingCharges, {
      name: newChargeName.trim(),
      amount,
      frequency: newChargeFrequency,
    }]);
    setNewChargeName('');
    setNewChargeAmount('');
    setNewChargeFrequency('monthly');
  }

  async function handleDeleteExistingCharge(chargeId: string) {
    const result = await deleteLeaseCharge(chargeId);
    if (result.success) {
      toast.success('Charge removed');
      refetchCharges();
    } else {
      toast.error(result.error);
    }
  }

  async function onSubmit(values: LeaseFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    // Clear late fee fields if type is null
    if (!values.late_fee_type) {
      values.late_fee_amount = null;
      values.late_fee_grace_days = null;
    }

    const result = lease
      ? await updateLease(lease.id, values)
      : await createLease(activeOrg.id, values);

    if (result.success) {
      // Create pending charges for new leases
      const leaseId = lease?.id ?? (result as any).data?.id;
      if (leaseId && pendingCharges.length > 0) {
        const startDate = values.start_date;
        for (const charge of pendingCharges) {
          await createLeaseCharge(activeOrg.id, leaseId, {
            name: charge.name,
            amount: charge.amount,
            frequency: charge.frequency,
            start_date: startDate,
            end_date: '',
            is_active: true,
          });
        }
      }

      toast.success(lease ? 'Lease updated' : 'Lease created');
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      queryClient.invalidateQueries({ queryKey: ['lease-charges'] });
      onOpenChange(false);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lease ? 'Edit Lease' : 'Add Lease'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (units.length === 1) form.setValue('unit_id', units[0].id);
            form.handleSubmit(onSubmit, (errors) => {
              const first = Object.entries(errors)[0];
              if (first) toast.error(`${first[0]}: ${first[1]?.message}`);
            })();
          }} className="space-y-4">
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
              )}

              {/* Multi-Select Tenants */}
              <FormField control={form.control} name="tenant_ids" render={() => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Tenants *</FormLabel>
                  <div className="space-y-2">
                    {/* Selected tenants as badges */}
                    {selectedTenantIds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedTenantIds.map((tid: string) => {
                          const t = tenants.find((t: any) => t.id === tid);
                          if (!t) return null;
                          return (
                            <Badge key={tid} variant="secondary" className="gap-1 pr-1">
                              {t.first_name} {t.last_name}
                              <button
                                type="button"
                                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                                onClick={() => removeTenant(tid)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    {/* Dropdown to add tenants */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-between text-sm font-normal">
                          {selectedTenantIds.length === 0 ? 'Select tenants...' : `${selectedTenantIds.length} selected`}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]" align="start">
                        {tenants.length === 0 && (
                          <DropdownMenuItem disabled>No tenants found</DropdownMenuItem>
                        )}
                        {tenants.map((t: any) => {
                          const isSelected = selectedTenantIds.includes(t.id);
                          return (
                            <DropdownMenuItem
                              key={t.id}
                              onSelect={(e) => {
                                e.preventDefault();
                                toggleTenant(t.id);
                              }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                              {t.first_name} {t.last_name}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Lease Type */}
              <FormField control={form.control} name="lease_type" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Lease Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="month_to_month">Month-to-Month</SelectItem>
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
              {leaseType === 'fixed' && (
                <FormField control={form.control} name="end_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date *</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
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

            <Separator />

            {/* Additional Charges Section */}
            <div>
              <h4 className="text-sm font-medium mb-2">Additional Charges</h4>

              {/* Existing charges (edit mode) */}
              {lease && (existingCharges ?? []).map((charge: LeaseCharge) => (
                <div key={charge.id} className="flex items-center gap-2 mb-2 rounded border p-2 text-sm">
                  <span className="flex-1">{charge.name}</span>
                  <span className="text-muted-foreground">${charge.amount}</span>
                  <span className="text-xs text-muted-foreground">{frequencyLabels[charge.frequency]}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleDeleteExistingCharge(charge.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}

              {/* Pending charges (create mode) */}
              {pendingCharges.map((charge, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2 rounded border p-2 text-sm">
                  <span className="flex-1">{charge.name}</span>
                  <span className="text-muted-foreground">${charge.amount}</span>
                  <span className="text-xs text-muted-foreground">{frequencyLabels[charge.frequency]}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setPendingCharges(pendingCharges.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}

              {/* Add charge form */}
              <div className="flex items-end gap-2">
                <Input
                  placeholder="Charge name"
                  value={newChargeName}
                  onChange={(e) => setNewChargeName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  step="0.01"
                  value={newChargeAmount}
                  onChange={(e) => setNewChargeAmount(e.target.value)}
                  className="w-24 h-8 text-sm"
                />
                <Select value={newChargeFrequency} onValueChange={(v) => setNewChargeFrequency(v as any)}>
                  <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                    <SelectItem value="one_time">One-Time</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleAddPendingCharge}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* Late Fee Settings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Late Fee Settings</h4>
                <Switch
                  checked={!!lateFeeType}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      form.setValue('late_fee_type', 'flat');
                      form.setValue('late_fee_grace_days', 5);
                    } else {
                      form.setValue('late_fee_type', null);
                      form.setValue('late_fee_amount', null);
                      form.setValue('late_fee_grace_days', null);
                    }
                  }}
                />
              </div>
              {lateFeeType && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField control={form.control} name="late_fee_type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value ?? 'flat'}>
                        <FormControl><SelectTrigger className="h-8"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="flat">Flat Fee ($)</SelectItem>
                          <SelectItem value="percentage">Percentage (%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="late_fee_amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{lateFeeType === 'percentage' ? 'Percentage' : 'Amount'}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={lateFeeType === 'percentage' ? '5' : '50'}
                          className="h-8"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="late_fee_grace_days" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grace Days</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="5"
                          className="h-8"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">{lease ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

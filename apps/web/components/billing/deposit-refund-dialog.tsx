'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useUser } from '@onereal/auth';
import {
  depositRefundSchema,
  type DepositRefundFormValues,
  useDepositSummary,
  useEligibleDeductions,
} from '@onereal/billing';
import { createDepositRefund } from '@onereal/billing/actions/create-deposit-refund';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Textarea, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface DepositRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string | null;
  leaseLabel?: string;
}

export function DepositRefundDialog({ open, onOpenChange, leaseId, leaseLabel }: DepositRefundDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const [includeWindow, setIncludeWindow] = useState(false);

  const { data: summary } = useDepositSummary(activeOrg?.id ?? null, leaseId);
  const { data: eligible = [] } = useEligibleDeductions(activeOrg?.id ?? null, leaseId, includeWindow);

  const form = useForm<DepositRefundFormValues>({
    resolver: zodResolver(depositRefundSchema),
    defaultValues: {
      lease_id: leaseId ?? '',
      refund_amount: 0,
      refund_date: new Date().toISOString().split('T')[0],
      payment_method: 'check',
      reference_number: '',
      notes: '',
      deduction_expense_ids: [],
    },
  });

  useEffect(() => {
    if (open && leaseId) {
      form.reset({
        lease_id: leaseId,
        refund_amount: 0,
        refund_date: new Date().toISOString().split('T')[0],
        payment_method: 'check',
        reference_number: '',
        notes: '',
        deduction_expense_ids: [],
      });
      setIncludeWindow(false);
    }
  }, [open, leaseId, form]);

  const selectedIds = form.watch('deduction_expense_ids');
  const refundAmount = form.watch('refund_amount');

  const withheld = useMemo(
    () =>
      (eligible as any[])
        .filter((e: any) => selectedIds.includes(e.id))
        .reduce((sum: number, e: any) => sum + Number(e.amount), 0),
    [eligible, selectedIds],
  );

  const held = Number(summary?.held ?? 0);
  const refunded = Number(summary?.refunded ?? 0);
  const previouslyWithheld = Number(summary?.withheld ?? 0);
  const available = Math.max(0, held - refunded - previouslyWithheld - withheld);
  const maxRefundable = held - refunded - previouslyWithheld - withheld;

  function toggleDeduction(expenseId: string) {
    const cur = form.getValues('deduction_expense_ids');
    const next = cur.includes(expenseId)
      ? cur.filter((id) => id !== expenseId)
      : [...cur, expenseId];
    form.setValue('deduction_expense_ids', next);
  }

  async function onSubmit(values: DepositRefundFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }
    if (Number(values.refund_amount) <= 0) {
      toast.error('Enter a refund amount');
      return;
    }

    const result = await createDepositRefund(activeOrg.id, values);
    if (result.success) {
      toast.success(`Refund ${result.data.refund_number} created`);
      queryClient.invalidateQueries({ queryKey: ['deposit-refunds'] });
      queryClient.invalidateQueries({ queryKey: ['deposit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['deposit-eligible-deductions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refund Deposit</DialogTitle>
          {leaseLabel && <DialogDescription>{leaseLabel}</DialogDescription>}
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 text-sm rounded-md border p-3 bg-muted/40">
          <div>
            <div className="text-xs text-muted-foreground">Held</div>
            <div className="font-medium">${held.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Refunded</div>
            <div className="font-medium">${refunded.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Withheld (selected)</div>
            <div className="font-medium">${withheld.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Available</div>
            <div className="font-medium">${available.toFixed(2)}</div>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Deductions (link existing expenses)</span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeWindow}
                    onChange={(e) => setIncludeWindow(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  Show all expenses for this property during lease window
                </label>
              </div>
              {(eligible as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No eligible expenses found.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {(eligible as any[]).map((e: any) => {
                    const checked = selectedIds.includes(e.id);
                    return (
                      <label
                        key={e.id}
                        className="flex items-center gap-3 px-2 py-1 rounded hover:bg-muted/40 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDeduction(e.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="text-xs text-muted-foreground w-20">{e.transaction_date}</span>
                        <span className="text-sm flex-1 truncate">
                          {e.description || e.expense_type}
                        </span>
                        <span className="text-sm font-medium">${Number(e.amount).toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="refund_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refund Amount *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="refund_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refund Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="ach">ACH</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reference_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference #</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="e.g. check #" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={Number(refundAmount) <= 0 || Number(refundAmount) > maxRefundable}
              >
                Refund
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

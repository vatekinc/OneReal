'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { paymentSchema, type PaymentFormValues, usePayments, useInvoice } from '@onereal/billing';
import { recordPayment } from '@onereal/billing/actions/record-payment';
import { voidPayment } from '@onereal/billing/actions/void-payment';
import { useUser } from '@onereal/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea, Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Invoice } from '@onereal/types';

const methodLabels: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  online: 'Online',
  other: 'Other',
};

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export function PaymentDialog({ open, onOpenChange, invoice }: PaymentDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  // Prefer live invoice state so the dialog reflects voids/edits without
  // needing to be reopened. Fall back to the prop on initial render.
  const { data: liveInvoice } = useInvoice(invoice?.id ?? null);
  const inv = (liveInvoice as Invoice | null | undefined) ?? invoice;
  const remaining = inv ? Number(inv.amount) - Number(inv.amount_paid) : 0;

  const { data: paymentsRaw } = usePayments(invoice?.id ?? null);
  // Only show active payments — voids stay in the DB for audit but
  // shouldn't clutter the history view.
  const payments = ((paymentsRaw ?? []) as any[]).filter((p) => p.status !== 'void');

  async function handleVoidPayment(paymentId: string, paymentAmount: number) {
    if (!activeOrg) return;
    if (!confirm(`Void this $${Number(paymentAmount).toFixed(2)} payment? The income/expense entry will be removed and the invoice balance restored.`)) return;
    const result = await voidPayment(activeOrg.id, paymentId);
    if (result.success) {
      toast.success('Payment voided');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      // Dialog stays open — useInvoice refetches and the form picks up the new remaining
    } else {
      toast.error(result.error);
    }
  }

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoice_id: invoice?.id ?? '',
      amount: remaining,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'bank_transfer',
      reference_number: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open && invoice) {
      const rem = Number(invoice.amount) - Number(invoice.amount_paid);
      form.reset({
        invoice_id: invoice.id,
        amount: rem,
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'bank_transfer',
        reference_number: '',
        notes: '',
      });
    }
  }, [open, invoice, form]);

  async function onSubmit(values: PaymentFormValues) {
    if (!activeOrg) {
      toast.error('No active organization');
      return;
    }

    const result = await recordPayment(activeOrg.id, values);

    if (result.success) {
      if (result.data?.overpayment_amount && result.data.overpayment_amount > 0) {
        toast.success(`Payment recorded. $${result.data.overpayment_amount.toFixed(2)} credit created from overpayment.`);
      } else {
        toast.success('Payment recorded');
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          {invoice && (
            <DialogDescription>
              {invoice.invoice_number} — Remaining: ${remaining.toFixed(2)}
            </DialogDescription>
          )}
        </DialogHeader>

        {payments.length > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Payment History</div>
            <ul className="space-y-1">
              {payments.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground w-20 shrink-0">{p.payment_date}</span>
                    <span className="font-medium">${Number(p.amount).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground capitalize">{p.payment_method}</span>
                    {p.reference_number && (
                      <span className="text-xs text-muted-foreground truncate">#{p.reference_number}</span>
                    )}
                  </div>
                  {p.payment_method === 'deposit' ? (
                    <span className="text-xs text-muted-foreground">
                      Settled from deposit refund — void the refund to reverse
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleVoidPayment(p.id, p.amount)}>
                      Void
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

              <FormField control={form.control} name="payment_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="payment_method" render={({ field }) => (
                <FormItem>
                  <FormLabel>Method *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(methodLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="reference_number" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference #</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder="Check #, transaction ID" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ''} placeholder="Optional notes" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Record Payment</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

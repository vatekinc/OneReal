'use client';

import { useState, useEffect, Suspense } from 'react';
import { useTenantInvoices } from '@onereal/tenant-portal';
import {
  Card, CardContent,
  Button,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@onereal/ui';
import { toast } from 'sonner';
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { calculateConvenienceFee } from '@onereal/payments/lib/fees';
import { createClient } from '@onereal/database';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  processing: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

export default function TenantPaymentsPage() {
  return (
    <Suspense>
      <TenantPaymentsContent />
    </Suspense>
  );
}

function TenantPaymentsContent() {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('all');
  const { data: invoices, isLoading } = useTenantInvoices(filter);
  const [onlinePayEnabled, setOnlinePayEnabled] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);

  // Payment method dialog state
  const [payDialog, setPayDialog] = useState<{ invoiceId: string; orgId: string; amount: number } | null>(null);

  useEffect(() => {
    if (!invoices || invoices.length === 0) return;
    const orgId = invoices[0].org_id;
    if (!orgId) return;

    const checkOnline = async () => {
      const supabase = createClient() as any;
      const { data: org } = await supabase
        .from('organizations')
        .select('plan_id, plans(features), stripe_account_status')
        .eq('id', orgId)
        .single();

      const features = (org as any)?.plans?.features;
      const connected = (org as any)?.stripe_account_status === 'active';
      setOnlinePayEnabled(features?.online_payments === true && connected);
    };
    checkOnline();
  }, [invoices]);

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      toast.success('Payment submitted successfully!');
    } else if (searchParams.get('payment') === 'canceled') {
      toast.info('Payment was canceled.');
    }
  }, [searchParams]);

  function handlePayClick(inv: any) {
    const remaining = Number(inv.amount) - Number(inv.amount_paid || 0);
    setPayDialog({ invoiceId: inv.id, orgId: inv.org_id, amount: remaining });
  }

  async function handleMethodSelect(method: 'card' | 'us_bank_account') {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    setPayDialog(null);

    const result = await createCheckoutSession(payDialog.orgId, {
      type: 'payment',
      invoiceId: payDialog.invoiceId,
      paymentMethod: method,
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

  const cardFee = payDialog ? calculateConvenienceFee(payDialog.amount, 'card') : 0;
  const achFee = payDialog ? calculateConvenienceFee(payDialog.amount, 'us_bank_account') : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'open' | 'paid' | 'all')}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !invoices || invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No invoices found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      {onlinePayEnabled && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.description || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(inv.amount).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.status === 'processing' ? 'processing' : inv.displayStatus] ?? ''}`}>
                            {inv.status === 'processing' ? 'Processing' : inv.displayStatus}
                          </span>
                        </TableCell>
                        {onlinePayEnabled && (
                          <TableCell>
                            {['open', 'partially_paid'].includes(inv.status) && (
                              <Button
                                size="sm"
                                onClick={() => handlePayClick(inv)}
                                disabled={payingInvoiceId === inv.id}
                              >
                                {payingInvoiceId === inv.id ? 'Redirecting...' : 'Pay Now'}
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment method selector dialog */}
      <Dialog open={!!payDialog} onOpenChange={(open) => !open && setPayDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Payment Method</DialogTitle>
            <DialogDescription>
              Select how you&apos;d like to pay ${payDialog?.amount.toLocaleString()}.
              A processing fee applies based on the method chosen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 pt-2">
            <button
              onClick={() => handleMethodSelect('card')}
              className="flex items-center gap-4 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
            >
              <CreditCard className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Credit / Debit Card</p>
                <p className="text-sm text-muted-foreground">
                  Fee: ${cardFee.toFixed(2)} (2.9% + $0.30)
                </p>
              </div>
              <p className="font-semibold text-sm">
                ${((payDialog?.amount ?? 0) + cardFee).toFixed(2)}
              </p>
            </button>
            <button
              onClick={() => handleMethodSelect('us_bank_account')}
              className="flex items-center gap-4 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
            >
              <Landmark className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Bank Account (ACH)</p>
                <p className="text-sm text-muted-foreground">
                  Fee: ${achFee.toFixed(2)} (0.8%, max $5)
                </p>
              </div>
              <p className="font-semibold text-sm">
                ${((payDialog?.amount ?? 0) + achFee).toFixed(2)}
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

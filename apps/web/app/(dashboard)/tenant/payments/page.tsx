'use client';

import { useState, useEffect, Suspense } from 'react';
import { useTenantInvoices } from '@onereal/tenant-portal';
import {
  Card, CardContent, CardHeader, CardTitle,
  Button,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { toast } from 'sonner';
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { createClient } from '@onereal/database';
import { useSearchParams } from 'next/navigation';

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

  // Check if online payments are available based on first invoice's org
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

  // Show toast on redirect back
  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      toast.success('Payment submitted successfully!');
    } else if (searchParams.get('payment') === 'canceled') {
      toast.info('Payment was canceled.');
    }
  }, [searchParams]);

  async function handlePayOnline(invoiceId: string, orgId: string) {
    setPayingInvoiceId(invoiceId);
    const result = await createCheckoutSession(orgId, {
      type: 'payment',
      invoiceId,
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

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
                <>
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
                                onClick={() => handlePayOnline(inv.id, inv.org_id)}
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
                {onlinePayEnabled && (
                  <p className="text-xs text-muted-foreground mt-2">
                    A processing fee (2.9% + $0.30) will be added at checkout.
                  </p>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

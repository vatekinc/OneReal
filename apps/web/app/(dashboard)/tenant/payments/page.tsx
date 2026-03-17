'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useTenantInvoices } from '@onereal/tenant-portal';
import {
  Card, CardContent,
  Button,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Switch,
} from '@onereal/ui';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { initiatePlaidTransfer } from '@onereal/payments/actions/initiate-plaid-transfer';
import { getTenantBankAccount, toggleAutoPay } from '@onereal/payments/actions/get-tenant-bank-account';
import { calculateConvenienceFee } from '@onereal/payments/lib/fees';
import { createClient } from '@onereal/database';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';
import dynamic from 'next/dynamic';

const PlaidLinkButton = dynamic(
  () => import('../../../../components/payments/plaid-link-button').then((m) => ({ default: m.PlaidLinkButton })),
  { ssr: false, loading: () => <Button variant="outline" disabled>Loading...</Button> }
);

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  processing: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

interface OrgPaymentConfig {
  stripeActive: boolean;
  plaidActive: boolean;
}

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export default function TenantPaymentsPage() {
  return (
    <Suspense>
      <TenantPaymentsContent />
    </Suspense>
  );
}

function TenantPaymentsContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('all');
  const { data: invoices, isLoading } = useTenantInvoices(filter);
  const [onlinePayEnabled, setOnlinePayEnabled] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [orgConfig, setOrgConfig] = useState<OrgPaymentConfig>({ stripeActive: false, plaidActive: false });
  const [tenantBank, setTenantBank] = useState<TenantBankInfo | null>(null);

  // Payment method dialog state
  const [payDialog, setPayDialog] = useState<{ invoiceId: string; orgId: string; amount: number } | null>(null);

  // Plaid Link state — stored separately so it survives dialog close
  const [plaidLinkIntent, setPlaidLinkIntent] = useState<{ invoiceId: string; orgId: string; amount: number } | null>(null);

  const orgId = invoices?.[0]?.org_id || null;

  // Fetch org payment config and tenant bank
  useEffect(() => {
    if (!orgId) return;

    const checkConfig = async () => {
      const supabase = createClient() as any;
      const { data: org } = await supabase
        .from('organizations')
        .select('plan_id, plans(features), stripe_account_status, plaid_status')
        .eq('id', orgId)
        .single();

      const features = (org as any)?.plans?.features;
      const stripeActive = (org as any)?.stripe_account_status === 'active';
      const plaidActive = (org as any)?.plaid_status === 'active';
      const hasOnlinePayments = features?.online_payments === true;

      setOnlinePayEnabled(hasOnlinePayments && (stripeActive || plaidActive));
      setOrgConfig({ stripeActive, plaidActive });
    };
    checkConfig();
  }, [orgId]);

  // Fetch tenant's linked bank account
  const refreshTenantBank = useCallback(async () => {
    if (!orgId) return;
    const result = await getTenantBankAccount(orgId);
    if (result.success) {
      setTenantBank(result.data);
    }
  }, [orgId]);

  useEffect(() => {
    refreshTenantBank();
  }, [refreshTenantBank]);

  const hasToasted = useRef(false);
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      if (!hasToasted.current) {
        hasToasted.current = true;
        toast.success('Payment submitted successfully!');
      }
      // Webhook may not have processed yet — poll until status updates
      queryClient.invalidateQueries({ queryKey: ['tenant-invoices'] });
      let attempts = 0;
      const poll = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['tenant-invoices'] });
        attempts++;
        if (attempts >= 5) clearInterval(poll);
      }, 2000);
      return () => clearInterval(poll);
    } else if (paymentStatus === 'canceled') {
      if (!hasToasted.current) {
        hasToasted.current = true;
        toast.info('Payment was canceled.');
      }
    }
  }, [searchParams, queryClient]);

  function handlePayClick(inv: any) {
    const remaining = Number(inv.amount) - Number(inv.amount_paid || 0);
    setPayDialog({ invoiceId: inv.id, orgId: inv.org_id, amount: remaining });
  }

  async function handleCardSelect() {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    setPayDialog(null);

    const result = await createCheckoutSession(payDialog.orgId, {
      type: 'payment',
      invoiceId: payDialog.invoiceId,
      paymentMethod: 'card',
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

  async function handleStripeAchSelect() {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    setPayDialog(null);

    const result = await createCheckoutSession(payDialog.orgId, {
      type: 'payment',
      invoiceId: payDialog.invoiceId,
      paymentMethod: 'us_bank_account',
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

  async function handlePlaidAchSelect() {
    if (!payDialog) return;

    // If no bank linked, close dialog and show Plaid Link outside
    if (!tenantBank) {
      setPlaidLinkIntent(payDialog);
      setPayDialog(null);
      return;
    }

    // Bank already linked — confirm and pay
    await executePlaidPayment(payDialog);
  }

  async function executePlaidPayment(intent: { invoiceId: string; orgId: string } | null) {
    const data = intent || plaidLinkIntent;
    if (!data) return;
    setPayingInvoiceId(data.invoiceId);
    setPayDialog(null);
    setPlaidLinkIntent(null);

    const result = await initiatePlaidTransfer(data.orgId, data.invoiceId);
    if (result.success) {
      toast.success('Payment initiated! ACH transfers take 1-3 business days.');
      queryClient.invalidateQueries({ queryKey: ['tenant-invoices'] });
    } else {
      toast.error(result.error);
    }
    setPayingInvoiceId(null);
  }

  function handlePlaidLinkSuccess() {
    refreshTenantBank();
    // After linking, auto-execute the payment
    executePlaidPayment(null);
  }

  function handlePlaidLinkCancel() {
    setPlaidLinkIntent(null);
  }

  async function handleAutoPayToggle(enabled: boolean) {
    if (!orgId) return;
    const result = await toggleAutoPay(orgId, enabled);
    if (result.success) {
      refreshTenantBank();
      toast.success(enabled ? 'Auto-pay enabled' : 'Auto-pay disabled');
    } else {
      toast.error(result.error);
    }
  }

  // Fee calculations for dialog
  const cardFee = payDialog ? calculateConvenienceFee(payDialog.amount, 'card') : 0;
  const achMethod = orgConfig.plaidActive ? 'plaid_ach' as const : 'us_bank_account' as const;
  const achFee = payDialog ? calculateConvenienceFee(payDialog.amount, achMethod) : 0;
  const achLabel = orgConfig.plaidActive ? '$1.00 flat' : '0.8%, max $5';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>

      {/* Auto-pay toggle (only if bank is linked and Plaid active) */}
      {tenantBank && orgConfig.plaidActive && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="font-medium">Auto-Pay</p>
              <p className="text-sm text-muted-foreground">
                Automatically pay invoices from {tenantBank.institution_name} ****{tenantBank.account_mask}
              </p>
            </div>
            <Switch
              checked={tenantBank.auto_pay_enabled}
              onCheckedChange={handleAutoPayToggle}
            />
          </CardContent>
        </Card>
      )}

      {/* Plaid Link flow — rendered OUTSIDE dialog so iframe isn't blocked */}
      {plaidLinkIntent && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="font-medium">Link your bank account to pay via ACH</p>
            <p className="text-sm text-muted-foreground">
              Connect your bank to pay ${plaidLinkIntent.amount.toLocaleString()} + $1.00 fee via ACH transfer.
            </p>
            <div className="flex gap-2">
              <PlaidLinkButton
                role="tenant"
                orgId={plaidLinkIntent.orgId}
                onSuccess={handlePlaidLinkSuccess}
              >
                Link Bank Account
              </PlaidLinkButton>
              <Button variant="ghost" size="sm" onClick={handlePlaidLinkCancel}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
            {/* Card option (Stripe only) */}
            {orgConfig.stripeActive && (
              <button
                onClick={handleCardSelect}
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
            )}

            {/* ACH option — routes to Plaid or Stripe based on org config */}
            {(orgConfig.stripeActive || orgConfig.plaidActive) && (
              <button
                onClick={orgConfig.plaidActive ? handlePlaidAchSelect : handleStripeAchSelect}
                className="flex items-center gap-4 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
              >
                <Landmark className="h-6 w-6 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Bank Account (ACH)</p>
                  <p className="text-sm text-muted-foreground">
                    Fee: ${achFee.toFixed(2)} ({achLabel})
                  </p>
                  {orgConfig.plaidActive && tenantBank && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {tenantBank.institution_name} ****{tenantBank.account_mask}
                    </p>
                  )}
                </div>
                <p className="font-semibold text-sm">
                  ${((payDialog?.amount ?? 0) + achFee).toFixed(2)}
                </p>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

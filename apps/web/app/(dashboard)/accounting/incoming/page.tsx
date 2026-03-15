'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useTenants } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { GenerateInvoicesDialog } from '@/components/billing/generate-invoices-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
} from '@onereal/ui';
import { Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice } from '@onereal/types';

type TabValue = 'open' | 'paid' | 'all';

export default function IncomingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  // Map tab to status filter — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: invoicesRaw, isLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'receivable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    tenantId: tenantFilter || undefined,
    search: search || undefined,
  });

  // Filter out void for "all" tab
  const invoices = tab === 'all'
    ? (invoicesRaw ?? []).filter((inv: any) => inv.status !== 'void')
    : (invoicesRaw ?? []);

  function handlePay(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setPaymentDialogOpen(true);
  }

  function handleEdit(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  }

  async function handleVoid(invoice: Invoice) {
    if (!confirm(`Void invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    const result = await voidInvoice(invoice.id);
    if (result.success) {
      toast.success('Invoice voided');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleNewInvoice() {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Incoming</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
            <Zap className="h-4 w-4" /> Generate Invoices
          </Button>
          <Button className="gap-2" onClick={handleNewInvoice}>
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={(v) => setTenantFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {tab === 'open' ? 'No open invoices' : tab === 'paid' ? 'No paid invoices' : 'No invoices yet'}
          </p>
          <Button onClick={handleNewInvoice}>Create your first invoice</Button>
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          direction="receivable"
          onPay={handlePay}
          onEdit={handleEdit}
          onVoid={handleVoid}
        />
      )}

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        defaultDirection="receivable"
      />
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={selectedInvoice}
      />
      <GenerateInvoicesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </div>
  );
}

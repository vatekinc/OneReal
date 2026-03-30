'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useProviders } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { deleteInvoice } from '@onereal/billing/actions/delete-invoice';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { GenerateExpensesDialog } from '@/components/accounting/generate-expenses-dialog';
import { resolveDateRange } from '@/lib/date-range';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  cn,
} from '@onereal/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice } from '@onereal/types';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

type TabValue = 'open' | 'paid' | 'all';

export default function OutgoingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [dateRange, setDateRange] = useState('current_month');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');

  const resolvedDates = useMemo(() => resolveDateRange(dateRange), [dateRange]);

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | 'clone'>('create');

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });
  const providers = (providersData ?? []) as any[];

  // Map tab to status filter — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: invoicesRaw, isLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'payable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    providerId: vendorFilter || undefined,
    search: search || undefined,
    from: resolvedDates?.from,
    to: resolvedDates?.to,
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
    setDialogMode('edit');
    setInvoiceDialogOpen(true);
  }

  function handleClone(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setDialogMode('clone');
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

  async function handleDelete(invoice: Invoice) {
    if (!confirm(`Delete invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    const result = await deleteInvoice(invoice.id);
    if (result.success) {
      toast.success('Invoice deleted');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleNewInvoice() {
    setSelectedInvoice(null);
    setDialogMode('create');
    setInvoiceDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outgoing</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {DATE_RANGES.map((r) => (
              <Button
                key={r.value}
                variant={dateRange === r.value ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setDateRange(r.value)}
                className={cn('text-xs', dateRange !== r.value && 'text-muted-foreground')}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
              <RefreshCw className="h-4 w-4" /> Generate Bills
            </Button>
            <Button className="gap-2" onClick={handleNewInvoice}>
              <Plus className="h-4 w-4" /> New Bill
            </Button>
          </div>
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
          placeholder="Search bills..."
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
        <Select value={vendorFilter} onValueChange={(v) => setVendorFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Vendors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.company_name ? ` (${p.company_name})` : ''}
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
            {tab === 'open' ? 'No open bills' : tab === 'paid' ? 'No paid bills' : 'No bills yet'}
          </p>
          <Button onClick={handleNewInvoice}>Create your first bill</Button>
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          direction="payable"
          onPay={handlePay}
          onEdit={handleEdit}
          onClone={handleClone}
          onVoid={handleVoid}
          onDelete={handleDelete}
        />
      )}

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        defaultDirection="payable"
        mode={dialogMode}
      />
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={selectedInvoice}
      />
      <GenerateExpensesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </div>
  );
}

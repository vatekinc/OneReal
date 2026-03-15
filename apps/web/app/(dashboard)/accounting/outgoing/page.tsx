'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoices } from '@onereal/billing';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { useProviders } from '@onereal/contacts';
import { voidInvoice } from '@onereal/billing/actions/void-invoice';
import { deleteInvoice } from '@onereal/billing/actions/delete-invoice';
import { deleteExpense } from '@onereal/accounting/actions/delete-expense';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { InvoiceDialog } from '@/components/billing/invoice-dialog';
import { PaymentDialog } from '@/components/billing/payment-dialog';
import { ExpenseDialog } from '@/components/accounting/expense-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Invoice, Expense } from '@onereal/types';

type TabValue = 'open' | 'paid' | 'expenses';

export default function OutgoingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('open');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: providersData } = useProviders({ orgId: activeOrg?.id ?? null });

  // Bills (payable invoices) — 'open' fetches both open + partially_paid from the hook
  const statusFilter = tab === 'open' ? 'open' : tab === 'paid' ? 'paid' : undefined;
  const { data: invoicesRaw, isLoading: billsLoading } = useInvoices({
    orgId: activeOrg?.id ?? null,
    direction: 'payable',
    status: statusFilter,
    propertyId: propertyFilter || undefined,
    search: search || undefined,
  });

  const bills = invoicesRaw ?? [];

  // Expenses (existing manual entries)
  const { data: expensesData, isLoading: expensesLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    search: search || undefined,
  });
  const expenses = (expensesData ?? []) as any[];

  function handlePay(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setPaymentDialogOpen(true);
  }

  function handleEditBill(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  }

  async function handleVoidBill(invoice: Invoice) {
    if (!confirm(`Void bill ${invoice.invoice_number}?`)) return;
    const result = await voidInvoice(invoice.id);
    if (result.success) {
      toast.success('Bill voided');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeleteBill(invoice: Invoice) {
    if (!confirm(`Delete bill ${invoice.invoice_number}? This cannot be undone.`)) return;
    const result = await deleteInvoice(invoice.id);
    if (result.success) {
      toast.success('Bill deleted');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleNewBill() {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  }

  function handleNewExpense() {
    setEditingExpense(null);
    setExpenseDialogOpen(true);
  }

  function handleEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setExpenseDialogOpen(true);
  }

  async function handleDeleteExpense(id: string) {
    if (!confirm('Delete this expense?')) return;
    const result = await deleteExpense(id);
    if (result.success) {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  const showBills = tab === 'open' || tab === 'paid';
  const isLoading = showBills ? billsLoading : expensesLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outgoing</h1>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={handleNewBill}>
            <Plus className="h-4 w-4" /> New Bill
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleNewExpense}>
            <Plus className="h-4 w-4" /> Quick Expense
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="open">Open Bills</TabsTrigger>
          <TabsTrigger value="paid">Paid Bills</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={showBills ? 'Search bills...' : 'Search expenses...'}
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
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : showBills ? (
        bills.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground mb-4">
              {tab === 'open' ? 'No open bills' : 'No paid bills'}
            </p>
            <Button onClick={handleNewBill}>Create your first bill</Button>
          </div>
        ) : (
          <InvoiceTable
            invoices={bills}
            direction="payable"
            onPay={handlePay}
            onEdit={handleEditBill}
            onVoid={handleVoidBill}
            onDelete={handleDeleteBill}
          />
        )
      ) : (
        expenses.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground mb-4">No expenses recorded yet</p>
            <Button onClick={handleNewExpense}>Add your first expense</Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((exp: any) => (
                  <TableRow key={exp.id}>
                    <TableCell>{new Date(exp.transaction_date).toLocaleDateString()}</TableCell>
                    <TableCell>{exp.properties?.name ?? '\u2014'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{exp.expense_type.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>{exp.service_providers?.name ?? '\u2014'}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{exp.description}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      ${Number(exp.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditExpense(exp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteExpense(exp.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        defaultDirection="payable"
      />
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={selectedInvoice}
      />
      <ExpenseDialog
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        expense={editingExpense}
      />
    </div>
  );
}

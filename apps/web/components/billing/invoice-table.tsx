'use client';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button,
} from '@onereal/ui';
import { Pencil, DollarSign, Ban } from 'lucide-react';
import type { Invoice } from '@onereal/types';

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  open: { label: 'Open', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  partially_paid: { label: 'Partial', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  void: { label: 'Void', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

interface InvoiceTableProps {
  invoices: (Invoice & { displayStatus: string; tenants?: any; service_providers?: any; properties?: any })[];
  direction: 'receivable' | 'payable';
  onPay: (invoice: Invoice) => void;
  onEdit: (invoice: Invoice) => void;
  onVoid: (invoice: Invoice) => void;
}

export function InvoiceTable({ invoices, direction, onPay, onEdit, onVoid }: InvoiceTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>{direction === 'receivable' ? 'Tenant' : 'Vendor'}</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => {
            const cfg = statusConfig[inv.displayStatus] || statusConfig.open;
            const isPastDue = inv.displayStatus === 'overdue';
            const canPay = inv.status !== 'paid' && inv.status !== 'void';
            const canVoid = Number(inv.amount_paid) === 0 && inv.status !== 'void';
            const canEdit = inv.status !== 'void';

            return (
              <TableRow key={inv.id}>
                <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                <TableCell>
                  {direction === 'receivable'
                    ? inv.tenants
                      ? `${inv.tenants.first_name} ${inv.tenants.last_name}`
                      : '\u2014'
                    : inv.service_providers?.name ?? inv.service_providers?.company_name ?? '\u2014'}
                </TableCell>
                <TableCell>{inv.properties?.name ?? '\u2014'}</TableCell>
                <TableCell className={isPastDue ? 'text-destructive' : ''}>
                  {new Date(inv.due_date).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  ${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right">
                  ${Number(inv.amount_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canPay && (
                      <Button variant="ghost" size="icon" onClick={() => onPay(inv)} title="Record Payment">
                        <DollarSign className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => onEdit(inv)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canVoid && (
                      <Button variant="ghost" size="icon" onClick={() => onVoid(inv)} title="Void">
                        <Ban className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

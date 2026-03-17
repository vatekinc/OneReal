'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
} from '@onereal/ui';
import type { AgingBucket } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getBadgeVariant(bucket: string): string {
  const lower = bucket.toLowerCase();
  if (lower.includes('current')) return 'bg-green-100 text-green-800';
  if (lower.includes('1-30')) return 'bg-yellow-100 text-yellow-800';
  if (lower.includes('31-60')) return 'bg-orange-100 text-orange-800';
  if (lower.includes('61-90')) return 'bg-red-100 text-red-800';
  if (lower.includes('90+') || lower.includes('90 ')) return 'bg-red-200 text-red-900';
  return 'bg-gray-100 text-gray-800';
}

export function InvoiceAgingTable({ data }: { data: AgingBucket[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No outstanding receivable invoices.
      </div>
    );
  }

  const totalInvoices = data.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const totalAmount = data.reduce((sum, row) => sum + (row.total_amount ?? 0), 0);
  const totalOutstanding = data.reduce((sum, row) => sum + (row.total_outstanding ?? 0), 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Aging Period</TableHead>
          <TableHead className="text-right"># Invoices</TableHead>
          <TableHead className="text-right">Total Amount</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.bucket}>
            <TableCell>
              <Badge className={getBadgeVariant(row.bucket)}>{row.bucket}</Badge>
            </TableCell>
            <TableCell className="text-right">{row.count ?? 0}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.total_amount ?? 0)}</TableCell>
            <TableCell className="text-right">
              {formatCurrency(row.total_outstanding ?? 0)}
            </TableCell>
          </TableRow>
        ))}
        {/* Totals footer row */}
        <TableRow className="border-t-2 font-bold">
          <TableCell className="font-bold">Total</TableCell>
          <TableCell className="text-right font-bold">{totalInvoices}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalAmount)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalOutstanding)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

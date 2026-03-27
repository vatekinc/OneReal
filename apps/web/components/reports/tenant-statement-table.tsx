'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@onereal/ui';
import type { TenantStatementRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const typeBadge: Record<string, { label: string; className: string }> = {
  charge: { label: 'Charge', className: 'bg-yellow-100 text-yellow-800' },
  late_fee: { label: 'Late Fee', className: 'bg-red-100 text-red-800' },
  payment: { label: 'Payment', className: 'bg-green-100 text-green-800' },
  credit: { label: 'Credit', className: 'bg-blue-100 text-blue-800' },
  credit_applied: { label: 'Credit Applied', className: 'bg-purple-100 text-purple-800' },
};

export function TenantStatementTable({ data }: { data: TenantStatementRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No transactions found for this period.
      </div>
    );
  }

  const totalCharges = data.reduce((sum, r) => sum + r.charge_amount, 0);
  const totalPayments = data.reduce((sum, r) => sum + r.payment_amount, 0);
  const endingBalance = data[data.length - 1].running_balance;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Charges</TableHead>
          <TableHead className="text-right">Payments/Credits</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const badge = typeBadge[row.txn_type] ?? { label: row.txn_type, className: '' };
          return (
            <TableRow key={`${row.txn_date}-${row.sort_key}-${i}`}>
              <TableCell className="whitespace-nowrap">{formatDate(row.txn_date)}</TableCell>
              <TableCell><Badge className={badge.className}>{badge.label}</Badge></TableCell>
              <TableCell className="max-w-[200px] truncate">{row.description}</TableCell>
              <TableCell>{row.reference}</TableCell>
              <TableCell className="text-right">{row.charge_amount > 0 ? formatCurrency(row.charge_amount) : '—'}</TableCell>
              <TableCell className="text-right">{row.payment_amount > 0 ? formatCurrency(row.payment_amount) : '—'}</TableCell>
              <TableCell className="text-right">{formatCurrency(row.running_balance)}</TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-t-2 font-bold">
          <TableCell colSpan={4} className="font-bold">Totals</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCharges)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalPayments)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(endingBalance)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

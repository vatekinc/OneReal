'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@onereal/ui';
import type { RentRollRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function netDueColor(n: number): string {
  if (n > 0) return 'text-red-600';
  if (n < 0) return 'text-green-600';
  return '';
}

export function RentRollTable({ data, leaseStatus = 'active' }: { data: RentRollRow[]; leaseStatus?: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No {leaseStatus === 'active' ? 'active' : 'inactive'} leases found.
      </div>
    );
  }

  const totalRent = data.reduce((sum, r) => sum + r.total_monthly_rent, 0);
  const totalPastDue = data.reduce((sum, r) => sum + r.past_due, 0);
  const totalCurrentDue = data.reduce((sum, r) => sum + r.current_due, 0);
  const totalFutureDue = data.reduce((sum, r) => sum + r.future_due, 0);
  const totalCredit = data.reduce((sum, r) => sum + r.credit_balance, 0);
  const totalNet = data.reduce((sum, r) => sum + r.net_due, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Tenants</TableHead>
          <TableHead className="text-right">Monthly Rent</TableHead>
          <TableHead className="text-right">Past Due</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">Future</TableHead>
          <TableHead className="text-right">Credits</TableHead>
          <TableHead className="text-right">Net Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.property_id}>
            <TableCell className="font-medium">{row.property_name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{row.tenants}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.total_monthly_rent)}</TableCell>
            <TableCell className={`text-right ${row.past_due > 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(row.past_due)}
            </TableCell>
            <TableCell className="text-right">{formatCurrency(row.current_due)}</TableCell>
            <TableCell className="text-right text-muted-foreground">{formatCurrency(row.future_due)}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.credit_balance)}</TableCell>
            <TableCell className={`text-right ${netDueColor(row.net_due)}`}>{formatCurrency(row.net_due)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 font-bold">
          <TableCell className="font-bold">Total</TableCell>
          <TableCell />
          <TableCell className="text-right font-bold">{formatCurrency(totalRent)}</TableCell>
          <TableCell className={`text-right font-bold ${totalPastDue > 0 ? 'text-red-600' : ''}`}>
            {formatCurrency(totalPastDue)}
          </TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCurrentDue)}</TableCell>
          <TableCell className="text-right font-bold text-muted-foreground">{formatCurrency(totalFutureDue)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCredit)}</TableCell>
          <TableCell className={`text-right font-bold ${netDueColor(totalNet)}`}>{formatCurrency(totalNet)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

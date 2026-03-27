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

  const totalLeases = data.reduce((sum, r) => sum + r.lease_count, 0);
  const totalRent = data.reduce((sum, r) => sum + r.total_monthly_rent, 0);
  const totalBalance = data.reduce((sum, r) => sum + r.balance_due, 0);
  const totalCredit = data.reduce((sum, r) => sum + r.credit_balance, 0);
  const totalNet = data.reduce((sum, r) => sum + r.net_due, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant</TableHead>
          <TableHead className="text-right">Leases</TableHead>
          <TableHead className="text-right">Monthly Rent</TableHead>
          <TableHead className="text-right">Balance Due</TableHead>
          <TableHead className="text-right">Credit Balance</TableHead>
          <TableHead className="text-right">Net Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.tenant_id}>
            <TableCell>{row.last_name}, {row.first_name}</TableCell>
            <TableCell className="text-right">{row.lease_count}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.total_monthly_rent)}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.balance_due)}</TableCell>
            <TableCell className="text-right">{formatCurrency(row.credit_balance)}</TableCell>
            <TableCell className={`text-right ${netDueColor(row.net_due)}`}>{formatCurrency(row.net_due)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 font-bold">
          <TableCell className="font-bold">Total</TableCell>
          <TableCell className="text-right font-bold">{totalLeases}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalRent)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalBalance)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalCredit)}</TableCell>
          <TableCell className={`text-right font-bold ${netDueColor(totalNet)}`}>{formatCurrency(totalNet)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

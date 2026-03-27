'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@onereal/ui';
import type { PropertyStatementRow } from '@onereal/types';

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const typeBadge: Record<string, { label: string; className: string }> = {
  rent_charge: { label: 'Rent Charge', className: 'bg-green-100 text-green-800' },
  rent_payment: { label: 'Rent Payment', className: 'bg-emerald-100 text-emerald-800' },
  credit_issued: { label: 'Credit Issued', className: 'bg-blue-100 text-blue-800' },
  credit_applied: { label: 'Credit Applied', className: 'bg-purple-100 text-purple-800' },
  expense_bill: { label: 'Expense Bill', className: 'bg-red-100 text-red-800' },
  expense_payment: { label: 'Expense Payment', className: 'bg-orange-100 text-orange-800' },
  income: { label: 'Income', className: 'bg-gray-100 text-gray-800' },
  expense: { label: 'Expense', className: 'bg-gray-100 text-gray-800' },
};

export function PropertyStatementTable({ data }: { data: PropertyStatementRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No transactions found for this period.
      </div>
    );
  }

  const totalIncome = data.reduce((sum, r) => sum + r.income_amount, 0);
  const totalExpenses = data.reduce((sum, r) => sum + r.expense_amount, 0);
  const net = totalIncome - totalExpenses;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Tenant/Vendor</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expense</TableHead>
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
              <TableCell>{row.tenant_or_vendor ?? '—'}</TableCell>
              <TableCell className="max-w-[200px] truncate">{row.description}</TableCell>
              <TableCell className="text-right">{row.income_amount > 0 ? formatCurrency(row.income_amount) : '—'}</TableCell>
              <TableCell className="text-right">{row.expense_amount > 0 ? formatCurrency(row.expense_amount) : '—'}</TableCell>
              <TableCell className="text-right">{formatCurrency(row.running_balance)}</TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-t-2 font-bold">
          <TableCell colSpan={4} className="font-bold">Totals</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalIncome)}</TableCell>
          <TableCell className="text-right font-bold">{formatCurrency(totalExpenses)}</TableCell>
          <TableCell className={`text-right font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(net)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

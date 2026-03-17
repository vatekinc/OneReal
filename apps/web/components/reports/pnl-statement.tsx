'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@onereal/ui';
import type { ProfitAndLossReport } from '@onereal/types';

function formatCategory(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PnlStatement({ data }: { data: ProfitAndLossReport }) {
  const incomeCategories = data.income_categories ?? [];
  const expenseCategories = data.expense_categories ?? [];

  if (incomeCategories.length === 0 && expenseCategories.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No financial data for this period.
      </div>
    );
  }

  const netIncome = data.net_income ?? (data.total_income ?? 0) - (data.total_expenses ?? 0);
  const netIncomeColor = netIncome >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Income Section */}
        <TableRow>
          <TableCell className="font-bold">Income</TableCell>
          <TableCell />
        </TableRow>
        {incomeCategories.map((item) => (
          <TableRow key={`income-${item.category}`}>
            <TableCell className="pl-6">{formatCategory(item.category)}</TableCell>
            <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t">
          <TableCell className="font-semibold">Total Income</TableCell>
          <TableCell className="text-right font-semibold">
            {formatCurrency(data.total_income ?? 0)}
          </TableCell>
        </TableRow>

        {/* Expenses Section */}
        <TableRow className="border-t-2">
          <TableCell className="font-bold">Expenses</TableCell>
          <TableCell />
        </TableRow>
        {expenseCategories.map((item) => (
          <TableRow key={`expense-${item.category}`}>
            <TableCell className="pl-6">{formatCategory(item.category)}</TableCell>
            <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t">
          <TableCell className="font-semibold">Total Expenses</TableCell>
          <TableCell className="text-right font-semibold">
            {formatCurrency(data.total_expenses ?? 0)}
          </TableCell>
        </TableRow>

        {/* Net Income Row */}
        <TableRow className="border-t-2">
          <TableCell className={`font-bold text-base ${netIncomeColor}`}>Net Income</TableCell>
          <TableCell className={`text-right font-bold text-base ${netIncomeColor}`}>
            {formatCurrency(netIncome)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

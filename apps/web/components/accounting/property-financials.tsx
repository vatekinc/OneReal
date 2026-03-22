import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@onereal/ui';
import { cn } from '@onereal/ui';
import type { PropertyFinancial } from '@onereal/types';

interface PropertyFinancialsProps {
  data: PropertyFinancial[];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function roiColor(roi: number): string {
  if (roi >= 20) return 'text-green-600';
  if (roi >= 10) return 'text-amber-600';
  return 'text-red-600';
}

export function PropertyFinancials({ data }: PropertyFinancialsProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No property financial data available.
      </div>
    );
  }

  const totals = data.reduce(
    (acc, row) => ({
      income: acc.income + row.income,
      expenses: acc.expenses + row.expenses,
      net: acc.net + row.net,
    }),
    { income: 0, expenses: 0, net: 0 },
  );

  const totalRoi = totals.income > 0
    ? Math.round((totals.net / totals.income) * 100 * 100) / 100
    : 0;

  const maxAbsNet = Math.max(...data.map((r) => Math.abs(r.net)), 1);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">ROI</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const barWidth = Math.round((Math.abs(row.net) / maxAbsNet) * 100);
          return (
            <TableRow key={row.property_id} className="hover:bg-muted/50">
              <TableCell className="font-medium">{row.property_name}</TableCell>
              <TableCell className="text-right text-green-600">
                {formatCurrency(row.income)}
              </TableCell>
              <TableCell className="text-right text-red-600">
                {formatCurrency(row.expenses)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-2 w-16 rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-2 rounded-full',
                        row.net >= 0 ? 'bg-green-500' : 'bg-red-500',
                      )}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{formatCurrency(row.net)}</span>
                </div>
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', roiColor(row.roi))}>
                {row.roi.toFixed(1)}%
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Portfolio Total</TableCell>
          <TableCell className="text-right font-semibold text-green-600">
            {formatCurrency(totals.income)}
          </TableCell>
          <TableCell className="text-right font-semibold text-red-600">
            {formatCurrency(totals.expenses)}
          </TableCell>
          <TableCell className="text-right font-semibold">
            {formatCurrency(totals.net)}
          </TableCell>
          <TableCell className={cn('text-right font-semibold tabular-nums', roiColor(totalRoi))}>
            {totalRoi.toFixed(1)}%
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

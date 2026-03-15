import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@onereal/ui';
import type { PropertyFinancial } from '@onereal/types';

interface PropertyFinancialsProps {
  data: PropertyFinancial[];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

  // Average ROI across properties that have ROI data (purchase price set)
  const propertiesWithRoi = data.filter((r) => r.roi !== 0);
  const totalRoi = propertiesWithRoi.length > 0
    ? propertiesWithRoi.reduce((sum, r) => sum + r.roi, 0) / propertiesWithRoi.length
    : 0;

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
        {data.map((row) => (
          <TableRow key={row.property_id}>
            <TableCell className="font-medium">{row.property_name}</TableCell>
            <TableCell className="text-right text-green-600">
              {formatCurrency(row.income)}
            </TableCell>
            <TableCell className="text-right text-red-600">
              {formatCurrency(row.expenses)}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(row.net)}
            </TableCell>
            <TableCell className="text-right text-amber-600">
              {row.roi.toFixed(1)}%
            </TableCell>
          </TableRow>
        ))}
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
          <TableCell className="text-right font-semibold text-amber-600">
            {totalRoi.toFixed(1)}%
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

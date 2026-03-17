'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { CashFlowPoint } from '@onereal/types';

function formatMonth(value: string): string {
  const [, month] = value.split('-');
  const date = new Date(2000, Number(month) - 1);
  return date.toLocaleString('default', { month: 'short' });
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No cash flow data available for this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" tickFormatter={formatMonth} className="text-xs" />
        <YAxis tickFormatter={formatCurrency} className="text-xs" />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Legend />
        <Line
          type="monotone"
          dataKey="net"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#22c55e"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

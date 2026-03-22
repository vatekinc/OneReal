'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { CashFlowPoint } from '@onereal/types';

interface CashFlowChartProps {
  data: CashFlowPoint[];
}

function formatMonth(value: string): string {
  const [, month] = value.split('-');
  const date = new Date(2000, Number(month) - 1);
  return date.toLocaleString('default', { month: 'short' });
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No cash flow data available for this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" tickFormatter={formatMonth} className="text-xs" />
        <YAxis tickFormatter={formatCurrency} className="text-xs" />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as CashFlowPoint;
            return (
              <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                <p className="mb-1 font-medium">{formatMonth(String(label))}</p>
                <p className="text-green-600">Income: {formatCurrency(point.income)}</p>
                <p className="text-red-600">Expenses: {formatCurrency(point.expenses)}</p>
                <p>Net: {formatCurrency(point.net)}</p>
                <p className="text-blue-600">Cumulative: {formatCurrency(point.cumulative)}</p>
              </div>
            );
          }}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="income"
          stroke="#22c55e"
          fill="url(#incomeGradient)"
          strokeWidth={2}
          dot={false}
          name="Income"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          stroke="#ef4444"
          fill="url(#expenseGradient)"
          strokeWidth={2}
          dot={false}
          name="Expenses"
        />
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Cumulative"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';
import type { CollectionRatePoint } from '@onereal/types';

function formatMonth(value: string): string {
  const [, month] = value.split('-');
  const date = new Date(2000, Number(month) - 1);
  return date.toLocaleString('default', { month: 'short' });
}

function getBarColor(rate: number): string {
  if (rate >= 90) return '#22c55e';
  if (rate >= 70) return '#eab308';
  return '#ef4444';
}

function tooltipFormatter(value: number, name: string, props: { payload?: CollectionRatePoint }) {
  if (name === 'collection_rate') {
    const payload = props.payload;
    const lines: [string, string][] = [
      [`${value.toFixed(1)}%`, 'Collection Rate'],
    ];
    if (payload?.invoiced_amount != null) {
      lines.push([`$${payload.invoiced_amount.toLocaleString()}`, 'Invoiced']);
    }
    if (payload?.collected_amount != null) {
      lines.push([`$${payload.collected_amount.toLocaleString()}`, 'Collected']);
    }
    return lines;
  }
  return [`${value}`, name];
}

export function RentCollectionChart({ data }: { data: CollectionRatePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No collection data available for this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" tickFormatter={formatMonth} className="text-xs" />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
          className="text-xs"
        />
        <Tooltip
          formatter={(value, name, props) =>
            tooltipFormatter(Number(value), String(name), props as { payload?: CollectionRatePoint })
          }
        />
        <Legend />
        <Bar dataKey="collection_rate" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getBarColor(entry.collection_rate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

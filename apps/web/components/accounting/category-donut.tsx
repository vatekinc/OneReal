'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import type { CategoryBreakdown } from '@onereal/types';

interface CategoryDonutProps {
  data: CategoryBreakdown[];
  title: string;
}

const COLORS = [
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#06b6d4',
  '#e11d48',
];

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function CategoryDonut({ data, title }: CategoryDonutProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No {title.toLowerCase()} data available.
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={70}
          >
            {data.map((entry, index) => (
              <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [
              formatCurrency(value),
              formatCategory(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className="mt-2 space-y-1 px-2">
        {data.map((entry, index) => (
          <li key={entry.category} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="flex-1 truncate">{formatCategory(entry.category)}</span>
            <span className="text-muted-foreground">{entry.percentage.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

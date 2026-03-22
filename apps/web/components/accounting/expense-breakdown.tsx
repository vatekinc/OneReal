import type { CategoryBreakdown } from '@onereal/types';
import { cn } from '@onereal/ui';

interface ExpenseBreakdownProps {
  data: CategoryBreakdown[];
}

const BAR_COLORS = [
  'bg-slate-600',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-slate-400',
];

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function ExpenseBreakdown({ data }: ExpenseBreakdownProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No expense data available.
      </div>
    );
  }

  // Sort by amount descending, cap at 6 categories
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  let items: CategoryBreakdown[];

  if (sorted.length > 6) {
    const top5 = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const otherAmount = rest.reduce((sum, r) => sum + r.amount, 0);
    const otherPercentage = rest.reduce((sum, r) => sum + r.percentage, 0);
    items = [...top5, { category: 'other', amount: otherAmount, percentage: otherPercentage }];
  } else {
    items = sorted;
  }

  const maxAmount = items[0]?.amount ?? 1;

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.category} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{formatCategory(item.category)}</span>
            <span className="text-muted-foreground">
              {formatCurrency(item.amount)} · {item.percentage.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className={cn('h-2 rounded-full', BAR_COLORS[index % BAR_COLORS.length])}
              style={{ width: `${(item.amount / maxAmount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

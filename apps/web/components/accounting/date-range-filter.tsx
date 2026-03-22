'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { cn, Button } from '@onereal/ui';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

export function DateRangeFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRange = searchParams.get('range') ?? 'current_year';

  function handleRangeChange(range: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('from');
    params.delete('to');
    params.set('range', range);
    router.push(`/accounting?${params.toString()}`);
  }

  return (
    <div className="flex gap-1.5">
      {DATE_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={activeRange === r.value ? 'default' : 'secondary'}
          size="sm"
          onClick={() => handleRangeChange(r.value)}
          className={cn('text-xs', activeRange !== r.value && 'text-muted-foreground')}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}

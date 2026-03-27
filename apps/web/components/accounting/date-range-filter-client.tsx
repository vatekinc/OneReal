'use client';

import { useState, useEffect } from 'react';
import { cn, Button, Input } from '@onereal/ui';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

function computeDateRange(range: string): { from?: string; to?: string } {
  const now = new Date();
  const toDate = now.toISOString().split('T')[0];

  switch (range) {
    case 'current_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: first.toISOString().split('T')[0], to: toDate };
    }
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: first.toISOString().split('T')[0], to: last.toISOString().split('T')[0] };
    }
    case 'ytd': {
      const first = new Date(now.getFullYear(), 0, 1);
      return { from: first.toISOString().split('T')[0], to: toDate };
    }
    case 'current_year': {
      const first = new Date(now.getFullYear(), 0, 1);
      return { from: first.toISOString().split('T')[0], to: toDate };
    }
    case '3yr': {
      const d = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      return { from: d.toISOString().split('T')[0], to: toDate };
    }
    case '5yr': {
      const d = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      return { from: d.toISOString().split('T')[0], to: toDate };
    }
    case 'all':
      return {};
    default:
      return {};
  }
}

export interface DateRangeValue {
  from?: string;
  to?: string;
}

interface DateRangeFilterClientProps {
  onChange: (value: DateRangeValue) => void;
  defaultRange?: string;
}

export function DateRangeFilterClient({ onChange, defaultRange = 'current_month' }: DateRangeFilterClientProps) {
  const [activeRange, setActiveRange] = useState(defaultRange);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Compute and emit on preset change
  function handlePresetChange(range: string) {
    setActiveRange(range);
    if (range !== 'custom') {
      const dates = computeDateRange(range);
      onChange(dates);
    }
  }

  // Emit on custom date change
  function handleCustomFromChange(value: string) {
    setCustomFrom(value);
    onChange({ from: value || undefined, to: customTo || undefined });
  }

  function handleCustomToChange(value: string) {
    setCustomTo(value);
    onChange({ from: customFrom || undefined, to: value || undefined });
  }

  // Emit initial value on mount
  useEffect(() => {
    onChange(computeDateRange(defaultRange));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DATE_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={activeRange === r.value ? 'default' : 'secondary'}
          size="sm"
          onClick={() => handlePresetChange(r.value)}
          className={cn('text-xs', activeRange !== r.value && 'text-muted-foreground')}
        >
          {r.label}
        </Button>
      ))}
      {activeRange === 'custom' && (
        <div className="flex items-center gap-2 ml-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => handleCustomFromChange(e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => handleCustomToChange(e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
        </div>
      )}
    </div>
  );
}

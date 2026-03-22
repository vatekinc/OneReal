import type { AgingBucket } from '@onereal/types';
import { cn } from '@onereal/ui';

interface InvoiceAgingCardProps {
  data: AgingBucket[];
}

const BUCKET_CONFIG: Record<string, { label: string; dotColor: string; textColor: string }> = {
  current: { label: 'Current', dotColor: 'bg-green-500', textColor: 'text-green-600' },
  '1-30': { label: '1\u201330 days', dotColor: 'bg-yellow-500', textColor: 'text-yellow-600' },
  '31-60': { label: '31\u201360 days', dotColor: 'bg-orange-500', textColor: 'text-orange-600' },
  '61-90': { label: '61\u201390 days', dotColor: 'bg-red-500', textColor: 'text-red-600' },
  '90+': { label: '90+ days', dotColor: 'bg-red-700', textColor: 'text-red-700' },
};

const BUCKET_ORDER = ['current', '1-30', '31-60', '61-90', '90+'];

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function InvoiceAgingCard({ data }: InvoiceAgingCardProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No outstanding invoices.
      </div>
    );
  }

  const bucketMap = new Map(data.map((b) => [b.bucket, b]));

  return (
    <div className="space-y-3">
      {BUCKET_ORDER.map((key) => {
        const config = BUCKET_CONFIG[key]!;
        const bucket = bucketMap.get(key);
        const hasData = bucket && bucket.total_outstanding > 0;

        return (
          <div
            key={key}
            className={cn(
              'flex items-center gap-3 text-sm',
              !hasData && 'opacity-40',
            )}
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', config.dotColor)} />
            <span className="flex-1 font-medium">{config.label}</span>
            {hasData && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">
                {bucket.count}
              </span>
            )}
            <span className={cn('tabular-nums font-medium', hasData ? config.textColor : 'text-muted-foreground')}>
              {hasData ? formatCurrency(bucket.total_outstanding) : '$0'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

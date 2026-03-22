'use client';

import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { cn } from '@onereal/ui';
import type { CollectionRatePoint } from '@onereal/types';

interface CollectionRateCardProps {
  data: CollectionRatePoint[];
}

export function CollectionRateCard({ data }: CollectionRateCardProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No invoice data to calculate collection rate.
      </div>
    );
  }

  // Weighted average collection rate
  const totalInvoiced = data.reduce((sum, p) => sum + p.invoiced_amount, 0);
  const totalCollected = data.reduce((sum, p) => sum + p.collected_amount, 0);
  const avgRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  const rateColor =
    avgRate >= 90 ? 'text-green-600' : avgRate >= 70 ? 'text-amber-600' : 'text-red-600';
  const sparkColor =
    avgRate >= 90 ? '#22c55e' : avgRate >= 70 ? '#f59e0b' : '#ef4444';

  const chartData = data.map((p, i) => ({ i, rate: p.collection_rate }));
  const gradientId = `collection-${avgRate}`;

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <span className={cn('text-4xl font-bold tabular-nums', rateColor)}>
        {avgRate}%
      </span>
      <span className="text-xs text-muted-foreground">Avg collection rate</span>
      {chartData.length > 1 && (
        <div className="mt-2 h-[50px] w-full">
          <ResponsiveContainer width="100%" height={50}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="rate"
                stroke={sparkColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

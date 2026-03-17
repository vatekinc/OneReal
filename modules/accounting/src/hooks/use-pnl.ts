'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getProfitAndLoss } from '@onereal/database';

export function useProfitAndLoss(
  orgId: string | null,
  dateRange?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ['pnl', orgId, dateRange],
    queryFn: () => {
      const supabase = createClient();
      return getProfitAndLoss(supabase as any, orgId!, dateRange);
    },
    enabled: !!orgId,
  });
}

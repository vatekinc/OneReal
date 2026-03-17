'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getCashFlowTrend } from '@onereal/database';

export function useCashFlow(
  orgId: string | null,
  dateRange?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ['cash-flow', orgId, dateRange],
    queryFn: () => {
      const supabase = createClient();
      return getCashFlowTrend(supabase as any, orgId!, dateRange);
    },
    enabled: !!orgId,
  });
}

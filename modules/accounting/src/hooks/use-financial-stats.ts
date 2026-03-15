'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getFinancialStats } from '@onereal/database';

export function useFinancialStats(
  orgId: string | null,
  dateRange?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ['financial-stats', orgId, dateRange],
    queryFn: () => {
      const supabase = createClient();
      return getFinancialStats(supabase as any, orgId!, dateRange);
    },
    enabled: !!orgId,
  });
}

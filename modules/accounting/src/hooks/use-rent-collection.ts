'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getRentCollectionRate } from '@onereal/database';

export function useRentCollection(
  orgId: string | null,
  dateRange?: { from: string; to: string }
) {
  return useQuery({
    queryKey: ['rent-collection', orgId, dateRange],
    queryFn: () => {
      const supabase = createClient();
      return getRentCollectionRate(supabase as any, orgId!, dateRange);
    },
    enabled: !!orgId,
  });
}

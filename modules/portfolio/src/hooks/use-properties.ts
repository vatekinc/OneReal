'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getProperties, type PropertyFilters } from '@onereal/database';

export function useProperties(filters: Omit<PropertyFilters, 'orgId'> & { orgId: string | null }) {
  return useQuery({
    queryKey: ['properties', filters],
    queryFn: () => {
      const supabase = createClient();
      return getProperties(supabase as any, filters as PropertyFilters);
    },
    enabled: !!filters.orgId,
  });
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface ProviderFilters {
  orgId: string | null;
  search?: string;
  category?: string;
}

export function useProviders(filters: ProviderFilters) {
  return useQuery({
    queryKey: ['providers', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('service_providers')
        .select('*')
        .eq('org_id', filters.orgId)
        .order('name', { ascending: true });

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,company_name.ilike.%${filters.search}%`);
      }
      if (filters.category) {
        query = query.eq('category', filters.category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

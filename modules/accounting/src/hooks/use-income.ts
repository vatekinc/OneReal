'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface IncomeFilters {
  orgId: string | null;
  propertyId?: string;
  incomeType?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useIncome(filters: IncomeFilters) {
  return useQuery({
    queryKey: ['income', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('income')
        .select('*, properties(name), units(unit_number)')
        .eq('org_id', filters.orgId)
        .order('transaction_date', { ascending: false });

      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.incomeType) {
        query = query.eq('income_type', filters.incomeType);
      }
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`);
      }
      if (filters.from) {
        query = query.gte('transaction_date', filters.from);
      }
      if (filters.to) {
        query = query.lte('transaction_date', filters.to);
      }

      query = query.limit(500);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

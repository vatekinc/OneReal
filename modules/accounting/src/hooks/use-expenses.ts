'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface ExpenseFilters {
  orgId: string | null;
  propertyId?: string;
  expenseType?: string;
  search?: string;
  from?: string;
  to?: string;
  providerId?: string;
}

export function useExpenses(filters: ExpenseFilters) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('expenses')
        .select('*, properties(name), units(unit_number), service_providers(name, company_name)')
        .eq('org_id', filters.orgId)
        .order('transaction_date', { ascending: false });

      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.expenseType) {
        query = query.eq('expense_type', filters.expenseType);
      }
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`);
      }
      if (filters.providerId) {
        query = query.eq('provider_id', filters.providerId);
      }
      if (filters.from) {
        query = query.gte('transaction_date', filters.from);
      }
      if (filters.to) {
        query = query.lte('transaction_date', filters.to);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

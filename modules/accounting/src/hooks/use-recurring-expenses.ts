'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useRecurringExpenses(propertyId: string | null) {
  return useQuery({
    queryKey: ['recurring-expenses', propertyId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('recurring_expenses')
        .select('*, service_providers(name)')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });
}

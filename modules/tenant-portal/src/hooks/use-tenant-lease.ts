'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantLease() {
  return useQuery({
    queryKey: ['tenant-lease'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('leases')
        .select('*, units(unit_number, property_id, properties(name, address_line1)), lease_charges(*)')
        .in('status', ['active', 'month_to_month'])
        .order('start_date', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return data ?? null;
    },
  });
}

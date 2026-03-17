'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantMaintenanceRequests() {
  return useQuery({
    queryKey: ['tenant-maintenance-requests'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('maintenance_requests')
        .select('*, units(unit_number, property_id, properties(name))')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

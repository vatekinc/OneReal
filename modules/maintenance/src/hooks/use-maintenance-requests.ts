'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface MaintenanceFilters {
  orgId: string | null;
  status?: string;
  priority?: string;
  search?: string;
}

export function useMaintenanceRequests(filters: MaintenanceFilters) {
  return useQuery({
    queryKey: ['maintenance-requests', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('maintenance_requests')
        .select('*, units(unit_number, property_id, properties(name))')
        .eq('org_id', filters.orgId)
        .order('created_at', { ascending: false });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.priority) {
        query = query.eq('priority', filters.priority);
      }
      if (filters.search) {
        query = query.ilike('title', `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface TenantFilters {
  orgId: string | null;
  search?: string;
  propertyId?: string;
}

export function useTenants(filters: TenantFilters) {
  return useQuery({
    queryKey: ['tenants', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('tenants')
        .select('*, lease_tenants(lease_id, leases(id, status, unit_id, units(unit_number, property_id, properties(id, name))))')
        .eq('org_id', filters.orgId)
        .order('last_name', { ascending: true });

      if (filters.search) {
        query = query.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

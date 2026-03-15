'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface LeaseFilters {
  orgId: string | null;
  tenantId?: string;
  propertyId?: string;
  unitId?: string;
  status?: string;
}

export function useLeases(filters: LeaseFilters) {
  return useQuery({
    queryKey: ['leases', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('leases')
        .select('*, tenants(first_name, last_name), units(unit_number, property_id, properties(name))')
        .eq('org_id', filters.orgId)
        .order('start_date', { ascending: false });

      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.unitId) query = query.eq('unit_id', filters.unitId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;

      // Client-side property filtering (since property_id is on units, not leases)
      let result = data ?? [];
      if (filters.propertyId) {
        result = result.filter((lease: any) => lease.units?.property_id === filters.propertyId);
      }

      return result;
    },
    enabled: !!filters.orgId,
  });
}

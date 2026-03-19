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
        .select('*, lease_tenants(tenant_id, tenants(id, first_name, last_name)), units(unit_number, property_id, properties(name))')
        .eq('org_id', filters.orgId)
        .order('start_date', { ascending: false });

      if (filters.unitId) query = query.eq('unit_id', filters.unitId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;

      let result = data ?? [];

      // Client-side property filtering (since property_id is on units, not leases)
      if (filters.propertyId) {
        result = result.filter((lease: any) => lease.units?.property_id === filters.propertyId);
      }

      // Client-side tenant filtering (through junction table)
      if (filters.tenantId) {
        result = result.filter((lease: any) =>
          lease.lease_tenants?.some((lt: any) => lt.tenant_id === filters.tenantId)
        );
      }

      // Compute displayStatus for month-to-month detection (read-only, no DB writes)
      const today = new Date().toISOString().split('T')[0];
      result = result.map((lease: any) => {
        let displayStatus = lease.status;

        if (lease.lease_type === 'month_to_month') {
          displayStatus = 'month_to_month';
        } else if (lease.status === 'active' && lease.end_date && lease.end_date < today) {
          displayStatus = 'expired';
        }

        return { ...lease, displayStatus };
      });

      return result;
    },
    enabled: !!filters.orgId,
  });
}

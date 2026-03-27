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

      // Use !inner joins to filter server-side when propertyId or tenantId is set
      const unitsRelation = filters.propertyId ? 'units!inner' : 'units';
      const leaseTenantsRelation = filters.tenantId ? 'lease_tenants!inner' : 'lease_tenants';

      let query = (supabase as any)
        .from('leases')
        .select(`*, ${leaseTenantsRelation}(tenant_id, tenants(id, first_name, last_name)), ${unitsRelation}(unit_number, property_id, properties(name))`)
        .eq('org_id', filters.orgId)
        .order('start_date', { ascending: false });

      if (filters.unitId) query = query.eq('unit_id', filters.unitId);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.propertyId) query = query.eq('units.property_id', filters.propertyId);
      if (filters.tenantId) query = query.eq('lease_tenants.tenant_id', filters.tenantId);

      const { data, error } = await query;
      if (error) throw error;

      // Compute displayStatus for month-to-month detection (read-only, no DB writes)
      const today = new Date().toISOString().split('T')[0];
      return (data ?? []).map((lease: any) => {
        let displayStatus = lease.status;

        if (lease.lease_type === 'month_to_month') {
          displayStatus = 'month_to_month';
        } else if (lease.status === 'active' && lease.end_date && lease.end_date < today) {
          displayStatus = 'expired';
        }

        return { ...lease, displayStatus };
      });
    },
    enabled: !!filters.orgId,
  });
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface CreditFilters {
  orgId: string | null;
  tenantId?: string;
  propertyId?: string;
  status?: string;
  source?: string;
}

export function useCredits(filters: CreditFilters) {
  return useQuery({
    queryKey: ['credits', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('credits')
        .select('*, tenants(first_name, last_name), properties(name), leases(start_date, end_date)')
        .eq('org_id', filters.orgId)
        .order('created_at', { ascending: false });

      if (filters.tenantId) {
        query = query.eq('tenant_id', filters.tenantId);
      }
      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.source && filters.source !== 'all') {
        query = query.eq('source', filters.source);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

export function useTenantCreditBalance(orgId: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['credit-balance', orgId, tenantId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any).rpc('get_tenant_credit_balance', {
        p_org_id: orgId,
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      return data?.[0] ?? { total_credits: 0, total_used: 0, available_balance: 0, active_count: 0 };
    },
    enabled: !!orgId && !!tenantId,
  });
}

export function useCreditApplications(invoiceId: string | null) {
  return useQuery({
    queryKey: ['credit-applications', invoiceId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('credit_applications')
        .select('*, credits(reason, source, tenant_id)')
        .eq('invoice_id', invoiceId)
        .eq('status', 'active')
        .order('applied_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!invoiceId,
  });
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface InvoiceFilters {
  orgId: string | null;
  direction?: 'receivable' | 'payable';
  status?: string; // 'open' | 'paid' | 'all' etc.
  propertyId?: string;
  tenantId?: string;
  providerId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('invoices')
        .select('*, tenants(first_name, last_name), service_providers(name, company_name), properties(name), units(unit_number)')
        .eq('org_id', filters.orgId)
        .order('due_date', { ascending: false });

      if (filters.direction) {
        query = query.eq('direction', filters.direction);
      }
      if (filters.status && filters.status !== 'all') {
        if (filters.status === 'open') {
          // "Open" tab shows both open and partially_paid invoices
          query = query.in('status', ['open', 'partially_paid']);
        } else {
          query = query.eq('status', filters.status);
        }
      }
      if (filters.propertyId) {
        query = query.eq('property_id', filters.propertyId);
      }
      if (filters.tenantId) {
        query = query.eq('tenant_id', filters.tenantId);
      }
      if (filters.providerId) {
        query = query.eq('provider_id', filters.providerId);
      }
      if (filters.search) {
        query = query.or(`description.ilike.%${filters.search}%,invoice_number.ilike.%${filters.search}%`);
      }
      if (filters.from) {
        query = query.gte('due_date', filters.from);
      }
      if (filters.to) {
        query = query.lte('due_date', filters.to);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Compute displayStatus: overdue if past due_date and still open/partially_paid
      const today = new Date().toISOString().split('T')[0];
      return (data ?? []).map((inv: any) => ({
        ...inv,
        displayStatus:
          (inv.status === 'open' || inv.status === 'partially_paid') && inv.due_date < today
            ? 'overdue'
            : inv.status,
      }));
    },
    enabled: !!filters.orgId,
  });
}

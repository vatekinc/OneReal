'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantInvoices(filter: 'open' | 'paid' | 'all' = 'all') {
  return useQuery({
    queryKey: ['tenant-invoices', filter],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('invoices')
        .select('*, leases(tenant_id, units(unit_number, properties(name)))')
        .order('due_date', { ascending: false });

      if (filter === 'open') {
        query = query.in('status', ['open', 'partially_paid']);
      } else if (filter === 'paid') {
        query = query.eq('status', 'paid');
      }

      const { data, error } = await query;
      if (error) throw error;

      // Compute displayStatus: overdue if open + past due_date
      const today = new Date().toISOString().split('T')[0];
      return (data ?? []).map((inv: any) => ({
        ...inv,
        displayStatus:
          (inv.status === 'open' || inv.status === 'partially_paid') && inv.due_date && inv.due_date < today
            ? 'overdue'
            : inv.status,
      }));
    },
  });
}

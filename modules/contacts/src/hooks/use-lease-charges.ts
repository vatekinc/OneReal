'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useLeaseCharges(leaseId: string | null) {
  return useQuery({
    queryKey: ['lease-charges', leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('lease_charges')
        .select('*')
        .eq('lease_id', leaseId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leaseId,
  });
}

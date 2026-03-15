'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function usePayments(invoiceId: string | null) {
  return useQuery({
    queryKey: ['payments', invoiceId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!invoiceId,
  });
}

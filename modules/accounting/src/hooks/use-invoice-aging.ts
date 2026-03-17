'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getInvoiceAging } from '@onereal/database';

export function useInvoiceAging(orgId: string | null) {
  return useQuery({
    queryKey: ['invoice-aging', orgId],
    queryFn: () => {
      const supabase = createClient();
      return getInvoiceAging(supabase as any, orgId!);
    },
    enabled: !!orgId,
  });
}

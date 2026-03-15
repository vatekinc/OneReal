'use client';

import { useQuery } from '@tanstack/react-query';
import { getGenerationPreview } from '../actions/generate-invoices';

export function useInvoiceGenerationPreview(
  orgId: string | null,
  month: number,
  year: number
) {
  return useQuery({
    queryKey: ['invoice-generation-preview', orgId, month, year],
    queryFn: async () => {
      const result = await getGenerationPreview(orgId!, month, year);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!orgId,
  });
}

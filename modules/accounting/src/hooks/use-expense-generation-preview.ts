'use client';

import { useQuery } from '@tanstack/react-query';
import { previewGenerateExpenses } from '../actions/generate-expenses';

export function useExpenseGenerationPreview(
  orgId: string | null,
  month: number,
  year: number
) {
  return useQuery({
    queryKey: ['expense-generation-preview', orgId, month, year],
    queryFn: async () => {
      const result = await previewGenerateExpenses(orgId!, month, year);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!orgId,
  });
}

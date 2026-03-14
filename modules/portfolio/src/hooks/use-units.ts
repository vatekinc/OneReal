'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getUnits } from '@onereal/database';

export function useUnits(propertyId: string | null) {
  return useQuery({
    queryKey: ['units', propertyId],
    queryFn: () => {
      const supabase = createClient();
      return getUnits(supabase as any, propertyId!);
    },
    enabled: !!propertyId,
  });
}

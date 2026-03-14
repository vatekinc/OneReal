'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getProperty } from '@onereal/database';

export function useProperty(propertyId: string | null) {
  return useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => {
      const supabase = createClient();
      return getProperty(supabase as any, propertyId!);
    },
    enabled: !!propertyId,
  });
}

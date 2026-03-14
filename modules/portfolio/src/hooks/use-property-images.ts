'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function usePropertyImages(propertyId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['property-images', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_images')
        .select('*')
        .eq('property_id', propertyId!)
        .order('sort_order');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });
}

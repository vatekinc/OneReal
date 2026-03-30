'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useSupportConversations() {
  return useQuery({
    queryKey: ['support-conversations'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .rpc('get_support_conversations');

      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: () => {
      if (typeof document !== 'undefined' && document.hidden) return false;
      return 60000;
    },
  });
}

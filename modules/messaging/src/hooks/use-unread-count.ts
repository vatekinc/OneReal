'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useUnreadCount() {
  return useQuery({
    queryKey: ['unread-message-count'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .rpc('get_unread_message_count');

      if (error) throw error;
      return (data as number) ?? 0;
    },
    refetchInterval: () => {
      if (typeof document !== 'undefined' && document.hidden) return false;
      return 60000;
    },
  });
}

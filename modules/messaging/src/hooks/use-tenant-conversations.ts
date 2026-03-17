'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useTenantConversations() {
  return useQuery({
    queryKey: ['tenant-conversations'],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('conversations')
        .select(`
          *,
          properties(id, name),
          units(id, unit_number),
          conversation_participants(
            id, user_id, last_read_at,
            profiles(id, first_name, last_name, avatar_url)
          ),
          messages(id, content, sender_id, created_at)
        `)
        .order('updated_at', { ascending: false })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' });

      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });
}

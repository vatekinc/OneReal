'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export function useConversations(orgId: string | null) {
  return useQuery({
    queryKey: ['conversations', orgId],
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
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
    refetchInterval: (query) => {
      if (typeof document !== 'undefined' && document.hidden) return false;
      return 60000;
    },
  });
}

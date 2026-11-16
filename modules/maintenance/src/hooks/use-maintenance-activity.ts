'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface MaintenanceActivity {
  id: string;
  request_id: string;
  author_id: string | null;
  author_name: string | null;
  kind: 'note' | 'change';
  body: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export function useMaintenanceActivity(requestId: string | null | undefined) {
  return useQuery({
    queryKey: ['maintenance-activity', requestId],
    queryFn: async (): Promise<MaintenanceActivity[]> => {
      const supabase = createClient();
      const { data, error } = await (supabase as any)
        .from('maintenance_request_activity')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!requestId,
  });
}

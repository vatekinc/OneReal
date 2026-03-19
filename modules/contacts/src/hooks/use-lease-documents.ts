'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';
import type { LeaseDocument } from '@onereal/types';

export function useLeaseDocuments(leaseId: string | null) {
  return useQuery({
    queryKey: ['lease-documents', leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const db = supabase as any;

      const { data, error } = await db
        .from('lease_documents')
        .select('*')
        .eq('lease_id', leaseId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      // Generate signed URLs for each document
      const docs = (data ?? []) as LeaseDocument[];
      const withUrls = await Promise.all(
        docs.map(async (doc) => {
          const { data: signedData } = await supabase.storage
            .from('lease-documents')
            .createSignedUrl(doc.document_url, 7200); // 2 hours

          return {
            ...doc,
            signedUrl: signedData?.signedUrl ?? '',
          };
        }),
      );

      return withUrls;
    },
    enabled: !!leaseId,
    refetchInterval: 3600000, // Refresh signed URLs every hour
  });
}

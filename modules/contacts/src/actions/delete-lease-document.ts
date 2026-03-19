'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteLeaseDocument(documentId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get document to find storage path
    const { data: doc, error: fetchError } = await db
      .from('lease_documents')
      .select('document_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !doc) {
      return { success: false, error: 'Document not found' };
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('lease-documents')
      .remove([doc.document_url]);

    if (storageError) {
      return { success: false, error: storageError.message };
    }

    // Delete DB record
    const { error: deleteError } = await db
      .from('lease_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete document' };
  }
}

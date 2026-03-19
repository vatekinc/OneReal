'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOCS_PER_LEASE = 25;

export async function uploadLeaseDocument(
  leaseId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string; filename: string; storage_path: string }>> {
  try {
    const file = formData.get('file') as File;
    if (!file) return { success: false, error: 'No file provided' };

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File must be less than 10MB' };
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { success: false, error: 'Only PDF, JPEG, PNG, and WebP files are accepted' };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get lease to find org_id
    const { data: lease, error: leaseError } = await db
      .from('leases')
      .select('org_id')
      .eq('id', leaseId)
      .single();

    if (leaseError || !lease) {
      return { success: false, error: 'Lease not found' };
    }

    // Check document count
    const { count } = await db
      .from('lease_documents')
      .select('id', { count: 'exact', head: true })
      .eq('lease_id', leaseId);

    if ((count ?? 0) >= MAX_DOCS_PER_LEASE) {
      return { success: false, error: `Maximum ${MAX_DOCS_PER_LEASE} documents per lease` };
    }

    // Upload to storage
    const ext = file.name.split('.').pop();
    const storagePath = `${lease.org_id}/${leaseId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('lease-documents')
      .upload(storagePath, file);

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Create DB record (store path, not URL)
    const { data, error } = await db
      .from('lease_documents')
      .insert({
        lease_id: leaseId,
        filename: file.name,
        document_url: storagePath,
        file_size: file.size,
        mime_type: file.type,
      })
      .select('id, filename, document_url')
      .single();

    if (error) {
      // Cleanup storage on DB error
      await supabase.storage.from('lease-documents').remove([storagePath]);
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id, filename: data.filename, storage_path: data.document_url } };
  } catch {
    return { success: false, error: 'Failed to upload document' };
  }
}

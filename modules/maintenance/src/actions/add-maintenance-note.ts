'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { getAuthorName } from '../lib/activity';

export async function addMaintenanceNote(
  requestId: string,
  body: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const text = body.trim();
    if (!text) return { success: false, error: 'Note cannot be empty' };
    if (text.length > 5000) return { success: false, error: 'Note is too long (max 5000 characters)' };

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: request, error: reqError } = await (supabase as any)
      .from('maintenance_requests')
      .select('id, org_id')
      .eq('id', requestId)
      .maybeSingle();
    if (reqError) return { success: false, error: reqError.message };
    if (!request) return { success: false, error: 'Request not found' };

    const { data, error } = await (supabase as any)
      .from('maintenance_request_activity')
      .insert({
        org_id: request.org_id,
        request_id: requestId,
        author_id: user.id,
        author_name: await getAuthorName(supabase, user.id, user.email),
        kind: 'note',
        body: text,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to add note' };
  }
}

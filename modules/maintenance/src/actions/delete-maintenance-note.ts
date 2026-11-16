'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteMaintenanceNote(noteId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await (supabase as any)
      .from('maintenance_request_activity')
      .delete()
      .eq('id', noteId)
      .eq('kind', 'note')
      .eq('author_id', user.id)
      .select('id');

    if (error) return { success: false, error: error.message };
    if (!data || data.length === 0) return { success: false, error: 'You can only delete your own notes' };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete note' };
  }
}

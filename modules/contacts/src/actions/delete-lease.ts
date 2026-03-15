'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteLease(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get the lease's unit_id before deleting
    const { data: lease } = await db
      .from('leases')
      .select('unit_id, status')
      .eq('id', id)
      .single();

    const { error } = await db.from('leases').delete().eq('id', id);
    if (error) return { success: false, error: error.message };

    // If the deleted lease was active, check if unit should become vacant
    if (lease?.status === 'active' && lease?.unit_id) {
      const { data: otherLeases } = await db
        .from('leases')
        .select('id')
        .eq('unit_id', lease.unit_id)
        .eq('status', 'active')
        .limit(1);

      if (!otherLeases || otherLeases.length === 0) {
        await db
          .from('units')
          .update({ status: 'vacant' })
          .eq('id', lease.unit_id);
      }
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete lease' };
  }
}

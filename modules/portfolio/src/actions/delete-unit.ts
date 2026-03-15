'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteUnit(unitId: string, propertyId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Prevent deleting last unit
    const { count } = await db
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if ((count ?? 0) <= 1) {
      return { success: false, error: 'Cannot delete the last unit of a property' };
    }

    const { error } = await db.from('units').delete().eq('id', unitId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete unit' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { unitSchema, type UnitFormValues } from '../schemas/unit-schema';

export async function updateUnit(
  unitId: string,
  values: UnitFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = unitSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db
      .from('units')
      .update(parsed.data)
      .eq('id', unitId)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to update unit' };
  }
}

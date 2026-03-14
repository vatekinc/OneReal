'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { unitSchema, type UnitFormValues } from '../schemas/unit-schema';

export async function createUnit(
  propertyId: string,
  values: UnitFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = unitSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    const { data, error } = await db
      .from('units')
      .insert({ ...parsed.data, property_id: propertyId })
      .select('id')
      .single();

    if (error) {
      if (error.message.includes('duplicate')) {
        return { success: false, error: 'A unit with that number already exists' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create unit' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';
import { propertySchema, type PropertyFormValues } from '../schemas/property-schema';

export async function updateProperty(
  propertyId: string,
  values: PropertyFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = propertySchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    const { data, error } = await db
      .from('properties')
      .update(parsed.data)
      .eq('id', propertyId)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to update property' };
  }
}

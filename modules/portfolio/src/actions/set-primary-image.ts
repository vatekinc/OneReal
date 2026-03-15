'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function setPrimaryImage(
  imageId: string,
  propertyId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    // Unset current primary
    await db
      .from('property_images')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
      .eq('is_primary', true);

    // Set new primary
    const { error } = await db
      .from('property_images')
      .update({ is_primary: true })
      .eq('id', imageId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to set primary image' };
  }
}

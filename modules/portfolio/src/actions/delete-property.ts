'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteProperty(propertyId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    // Get images to delete from storage
    const { data: images } = await db
      .from('property_images')
      .select('url')
      .eq('property_id', propertyId);

    // Delete images from Supabase Storage
    if (images && images.length > 0) {
      const paths = images
        .map((img: { url: string }) => {
          const url = new URL(img.url);
          const pathParts = url.pathname.split('/storage/v1/object/public/property-images/');
          return pathParts[1] || '';
        })
        .filter(Boolean);

      if (paths.length > 0) {
        await supabase.storage.from('property-images').remove(paths);
      }
    }

    // Delete property (CASCADE deletes units, images DB records)
    const { error } = await db
      .from('properties')
      .delete()
      .eq('id', propertyId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete property' };
  }
}

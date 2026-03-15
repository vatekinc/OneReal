'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteImage(imageId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    // Get image URL to delete from storage
    const { data: image, error: fetchError } = await db
      .from('property_images')
      .select('url')
      .eq('id', imageId)
      .single();

    if (fetchError || !image) {
      return { success: false, error: 'Image not found' };
    }

    // Extract storage path from URL
    const url = new URL(image.url);
    const pathParts = url.pathname.split('/storage/v1/object/public/property-images/');
    const storagePath = pathParts[1];

    if (storagePath) {
      await supabase.storage.from('property-images').remove([storagePath]);
    }

    // Delete DB record
    const { error } = await db.from('property_images').delete().eq('id', imageId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete image' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database';
import type { ActionResult } from '@onereal/types';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES_PER_PROPERTY = 20;

export async function uploadImage(
  propertyId: string,
  formData: FormData
): Promise<ActionResult<{ id: string; url: string }>> {
  try {
    const file = formData.get('file') as File;
    if (!file) return { success: false, error: 'No file provided' };

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File must be less than 5MB' };
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { success: false, error: 'Only JPEG, PNG, and WebP images are accepted' };
    }

    const supabase = await createServerSupabaseClient();
    const db = supabase as any;

    // Check image count
    const { count } = await db
      .from('property_images')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if ((count ?? 0) >= MAX_IMAGES_PER_PROPERTY) {
      return { success: false, error: `Maximum ${MAX_IMAGES_PER_PROPERTY} images per property` };
    }

    // Upload to storage
    const ext = file.name.split('.').pop();
    const path = `${propertyId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(path, file);

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('property-images')
      .getPublicUrl(path);

    // Check if this is the first image (make it primary)
    const isPrimary = (count ?? 0) === 0;

    // Create DB record
    const { data, error } = await db
      .from('property_images')
      .insert({
        property_id: propertyId,
        url: publicUrl,
        is_primary: isPrimary,
        sort_order: (count ?? 0),
      })
      .select('id, url')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id, url: data.url } };
  } catch (err) {
    return { success: false, error: 'Failed to upload image' };
  }
}

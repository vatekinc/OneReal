'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { providerSchema, type ProviderFormValues } from '../schemas/provider-schema';

export async function updateProvider(
  id: string,
  values: ProviderFormValues
): Promise<ActionResult> {
  try {
    const parsed = providerSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const { error } = await db
      .from('service_providers')
      .update(parsed.data)
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update service provider' };
  }
}

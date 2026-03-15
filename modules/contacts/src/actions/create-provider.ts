'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { providerSchema, type ProviderFormValues } from '../schemas/provider-schema';

export async function createProvider(
  orgId: string,
  values: ProviderFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = providerSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const { data, error } = await db
      .from('service_providers')
      .insert({ ...parsed.data, org_id: orgId })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create service provider' };
  }
}

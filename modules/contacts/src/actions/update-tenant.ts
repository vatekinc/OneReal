'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { tenantSchema, type TenantFormValues } from '../schemas/tenant-schema';

export async function updateTenant(
  id: string,
  values: TenantFormValues
): Promise<ActionResult> {
  try {
    const parsed = tenantSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const { error } = await db
      .from('tenants')
      .update(parsed.data)
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update tenant' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { maintenanceRequestSchema, type MaintenanceRequestFormValues } from '../schemas/maintenance-schema';

export async function createMaintenanceRequest(
  orgId: string,
  values: MaintenanceRequestFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = maintenanceRequestSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await (supabase as any)
      .from('maintenance_requests')
      .insert({
        org_id: orgId,
        unit_id: parsed.data.unit_id,
        reported_by: user.id,
        title: parsed.data.title,
        description: parsed.data.description || null,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: 'open',
        images: [],
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create maintenance request' };
  }
}

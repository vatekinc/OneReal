'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deletePlan(
  planId: string
): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    const { data: plan } = await db
      .from('plans')
      .select('is_default')
      .eq('id', planId)
      .single();

    if ((plan as any)?.is_default) {
      return { success: false, error: 'Cannot delete the default plan' };
    }

    const { count } = await db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', planId);

    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: `Cannot delete plan with ${count} organizations assigned. Reassign them first.`,
      };
    }

    const { error } = await db
      .from('plans')
      .delete()
      .eq('id', planId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete plan' };
  }
}

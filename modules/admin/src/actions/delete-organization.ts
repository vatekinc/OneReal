'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deleteOrganization(
  orgId: string
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Verify org exists
    const { data: org, error: fetchError } = await db
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single();

    if (fetchError || !org) {
      return { success: false, error: 'Organization not found' };
    }

    // Delete the organization — ON DELETE CASCADE handles all child records
    const { error } = await db
      .from('organizations')
      .delete()
      .eq('id', orgId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete organization' };
  }
}

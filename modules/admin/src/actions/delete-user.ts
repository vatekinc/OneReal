'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function deleteUser(
  userId: string
): Promise<ActionResult> {
  try {
    const adminUserId = await requireAdmin();

    // Prevent self-delete
    if (userId === adminUserId) {
      return { success: false, error: 'Cannot delete your own account' };
    }

    const db = createServiceRoleClient();

    // Check if user has a personal org where they're the sole member
    const { data: memberships } = await db
      .from('org_members')
      .select('org_id, organizations(type)')
      .eq('user_id', userId);

    for (const m of memberships ?? []) {
      const orgType = (m as any).organizations?.type;
      if (orgType === 'personal') {
        // Check if sole member
        const { count } = await db
          .from('org_members')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', m.org_id);

        if (count === 1) {
          // Delete the personal org (cascades to all its data)
          await db.from('organizations').delete().eq('id', m.org_id);
        }
      }
    }

    // Remove from all remaining org_members
    await db.from('org_members').delete().eq('user_id', userId);

    // Delete profile
    await db.from('profiles').delete().eq('id', userId);

    // Delete auth user
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to delete user' };
  }
}

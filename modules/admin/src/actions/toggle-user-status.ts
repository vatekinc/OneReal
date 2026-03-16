'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function toggleUserStatus(
  userId: string,
  ban: boolean
): Promise<ActionResult> {
  try {
    const adminUserId = await requireAdmin();

    // Prevent self-disable
    if (userId === adminUserId) {
      return { success: false, error: 'Cannot disable your own account' };
    }

    const db = createServiceRoleClient();

    // Ban or unban via Supabase Admin API
    if (ban) {
      const { error } = await db.auth.admin.updateUserById(userId, {
        ban_duration: '876000h', // ~100 years = effectively permanent
      });
      if (error) throw error;
    } else {
      const { error } = await db.auth.admin.updateUserById(userId, {
        ban_duration: 'none',
      });
      if (error) throw error;
    }

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update user status' };
  }
}

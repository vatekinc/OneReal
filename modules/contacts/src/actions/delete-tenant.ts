'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteTenant(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check for active leases via junction table
    const { data: activeLeaseTenants } = await db
      .from('lease_tenants')
      .select('lease_id, leases!inner(status)')
      .eq('tenant_id', id)
      .eq('leases.status', 'active')
      .limit(1);

    const activeLeases = activeLeaseTenants;

    if (activeLeases && activeLeases.length > 0) {
      return { success: false, error: 'Tenant has active leases. Terminate or expire leases first.' };
    }

    const { error } = await db.from('tenants').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to delete tenant' };
  }
}

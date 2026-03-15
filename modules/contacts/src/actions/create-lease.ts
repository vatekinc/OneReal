'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseSchema, type LeaseFormValues } from '../schemas/lease-schema';

export async function createLease(
  orgId: string,
  values: LeaseFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = leaseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Extract property_id (not stored on leases table)
    const { property_id, ...leaseData } = parsed.data;

    const { data, error } = await db
      .from('leases')
      .insert({ ...leaseData, org_id: orgId })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    // Unit occupancy sync: if lease is active, mark unit as occupied
    if (parsed.data.status === 'active') {
      await db
        .from('units')
        .update({ status: 'occupied' })
        .eq('id', parsed.data.unit_id);
    }

    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create lease' };
  }
}

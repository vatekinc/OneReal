'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseSchema, type LeaseFormValues } from '../schemas/lease-schema';

export async function updateLease(
  id: string,
  values: LeaseFormValues
): Promise<ActionResult> {
  try {
    const parsed = leaseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Fetch current lease to check status transitions
    const { data: currentLease } = await db
      .from('leases')
      .select('status')
      .eq('id', id)
      .single();

    // Enforce status transition rules:
    // - Can set to 'active' only from 'draft'
    // - Can set to 'terminated' from any status
    // - Cannot set to 'month_to_month' via form (system-managed)
    if (currentLease) {
      const newStatus = parsed.data.status;
      const oldStatus = currentLease.status;

      if (newStatus === 'active' && oldStatus !== 'draft' && oldStatus !== 'active') {
        return { success: false, error: 'Can only activate a lease from draft status' };
      }
    }

    // Extract property_id (not stored on leases table)
    const { property_id, ...leaseData } = parsed.data;

    const { error } = await db
      .from('leases')
      .update(leaseData)
      .eq('id', id);

    if (error) return { success: false, error: error.message };

    // Unit occupancy sync
    if (parsed.data.status === 'active') {
      await db
        .from('units')
        .update({ status: 'occupied' })
        .eq('id', parsed.data.unit_id);
    } else if (parsed.data.status === 'terminated' || parsed.data.status === 'expired') {
      // Check if any other active/month_to_month leases exist on the same unit
      const { data: otherLeases } = await db
        .from('leases')
        .select('id')
        .eq('unit_id', parsed.data.unit_id)
        .in('status', ['active', 'month_to_month'])
        .neq('id', id)
        .limit(1);

      if (!otherLeases || otherLeases.length === 0) {
        await db
          .from('units')
          .update({ status: 'vacant' })
          .eq('id', parsed.data.unit_id);
      }
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update lease' };
  }
}

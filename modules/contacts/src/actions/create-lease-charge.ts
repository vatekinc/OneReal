'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseChargeSchema, type LeaseChargeFormValues } from '../schemas/lease-charge-schema';

export async function createLeaseCharge(
  orgId: string,
  leaseId: string,
  values: LeaseChargeFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = leaseChargeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const insertData: Record<string, unknown> = {
      org_id: orgId,
      lease_id: leaseId,
      name: parsed.data.name,
      amount: parsed.data.amount,
      frequency: parsed.data.frequency,
      start_date: parsed.data.start_date,
      is_active: parsed.data.is_active,
    };

    // Only set end_date if provided (non-empty string)
    if (parsed.data.end_date) {
      insertData.end_date = parsed.data.end_date;
    }

    const { data, error } = await db
      .from('lease_charges')
      .insert(insertData)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create lease charge' };
  }
}

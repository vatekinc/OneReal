'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseChargeSchema, type LeaseChargeFormValues } from '../schemas/lease-charge-schema';

export async function updateLeaseCharge(
  id: string,
  values: LeaseChargeFormValues
): Promise<ActionResult> {
  try {
    const parsed = leaseChargeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('lease_charges')
      .update({
        name: parsed.data.name,
        amount: parsed.data.amount,
        frequency: parsed.data.frequency,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date || null,
        is_active: parsed.data.is_active,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update lease charge' };
  }
}

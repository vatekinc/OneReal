'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { applyCreditSchema, type ApplyCreditFormValues } from '../schemas/credit-schema';

export async function applyCredits(
  orgId: string,
  values: ApplyCreditFormValues
): Promise<ActionResult<{ total_applied: number; new_status: string }>> {
  try {
    const parsed = applyCreditSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('apply_credits_to_invoice', {
      p_org_id: orgId,
      p_invoice_id: parsed.data.invoice_id,
      p_applications: parsed.data.applications,
      p_applied_by: user.id,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data };
  } catch {
    return { success: false, error: 'Failed to apply credits' };
  }
}

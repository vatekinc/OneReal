'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { incomeSchema, type IncomeFormValues } from '../schemas/income-schema';

export async function updateIncome(
  incomeId: string,
  values: IncomeFormValues
): Promise<ActionResult> {
  try {
    const parsed = incomeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('income')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
      })
      .eq('id', incomeId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to update income' };
  }
}

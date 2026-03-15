'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { incomeSchema, type IncomeFormValues } from '../schemas/income-schema';

export async function createIncome(
  orgId: string,
  values: IncomeFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = incomeSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db
      .from('income')
      .insert({
        ...parsed.data,
        org_id: orgId,
        unit_id: parsed.data.unit_id || null,
      })
      .select('id')
      .single();

    if (error) {
      if (error.message.includes('duplicate')) {
        return { success: false, error: 'A duplicate income record already exists' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create income' };
  }
}

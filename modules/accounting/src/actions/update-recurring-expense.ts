'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { recurringExpenseSchema, type RecurringExpenseFormValues } from '../schemas/recurring-expense-schema';

export async function updateRecurringExpense(
  id: string,
  values: RecurringExpenseFormValues
): Promise<ActionResult> {
  try {
    const parsed = recurringExpenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('recurring_expenses')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
        provider_id: parsed.data.provider_id || null,
        end_date: parsed.data.end_date || null,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update recurring expense' };
  }
}

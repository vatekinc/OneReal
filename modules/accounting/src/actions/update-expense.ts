'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { expenseSchema, type ExpenseFormValues } from '../schemas/expense-schema';

export async function updateExpense(
  expenseId: string,
  values: ExpenseFormValues
): Promise<ActionResult> {
  try {
    const parsed = expenseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { error } = await db
      .from('expenses')
      .update({
        ...parsed.data,
        unit_id: parsed.data.unit_id || null,
      })
      .eq('id', expenseId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to update expense' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteExpense(
  expenseId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data: existing } = await db
      .from('expenses')
      .select('expense_type')
      .eq('id', expenseId)
      .single();

    if (existing?.expense_type === 'deposit_refund') {
      return {
        success: false,
        error: 'Refund expenses must be voided via the deposit refund record.',
      };
    }

    const { count: linkedCount } = await db
      .from('deposit_refund_deductions')
      .select('id, deposit_refunds!inner(status)', { count: 'exact', head: true })
      .eq('expense_id', expenseId)
      .eq('deposit_refunds.status', 'active');

    if (linkedCount && linkedCount > 0) {
      return {
        success: false,
        error: 'This expense is linked to an active deposit refund — void the refund first to delete.',
      };
    }

    const { error } = await db
      .from('expenses')
      .delete()
      .eq('id', expenseId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete expense' };
  }
}

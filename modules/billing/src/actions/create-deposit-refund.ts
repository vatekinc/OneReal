'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import {
  depositRefundSchema,
  type DepositRefundFormValues,
} from '../schemas/deposit-refund-schema';

export async function createDepositRefund(
  orgId: string,
  values: DepositRefundFormValues,
): Promise<ActionResult<{
  refund_id: string;
  expense_id: string;
  refund_number: string;
  balance_remaining: number;
  invoice_settlements_total: number;
}>> {
  try {
    const parsed = depositRefundSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('create_deposit_refund', {
      p_org_id: orgId,
      p_lease_id: parsed.data.lease_id,
      p_refund_amount: parsed.data.refund_amount,
      p_refund_date: parsed.data.refund_date,
      p_payment_method: parsed.data.payment_method,
      p_reference_number: parsed.data.reference_number ?? null,
      p_notes: parsed.data.notes ?? null,
      p_deduction_expense_ids: parsed.data.deduction_expense_ids,
      p_settle_invoice_ids: parsed.data.settle_invoice_ids,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch {
    return { success: false, error: 'Failed to create deposit refund' };
  }
}

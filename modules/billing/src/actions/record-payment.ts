'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { paymentSchema, type PaymentFormValues } from '../schemas/payment-schema';

export async function recordPayment(
  orgId: string,
  values: PaymentFormValues
): Promise<ActionResult<{ id: string; credit_id?: string; overpayment_amount?: number }>> {
  try {
    const parsed = paymentSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data, error } = await db.rpc('record_payment_with_overpayment', {
      p_org_id: orgId,
      p_invoice_id: parsed.data.invoice_id,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.payment_method,
      p_payment_date: parsed.data.payment_date,
      p_reference_number: parsed.data.reference_number || null,
      p_notes: parsed.data.notes || null,
      p_user_id: user.id,
    });

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        id: data.payment_id,
        credit_id: data.credit_id,
        overpayment_amount: data.overpayment_amount,
      },
    };
  } catch {
    return { success: false, error: 'Failed to record payment' };
  }
}

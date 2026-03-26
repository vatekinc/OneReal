'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function voidInvoice(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid, status, org_id')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (invoice.status === 'void') {
      return { success: false, error: 'Invoice is already void' };
    }

    // Check for credit applications and reverse them
    const { data: creditApps } = await db
      .from('credit_applications')
      .select('id')
      .eq('invoice_id', id)
      .eq('status', 'active');

    if (creditApps && creditApps.length > 0) {
      const { error: reverseError } = await db.rpc('reverse_invoice_credit_applications', {
        p_org_id: invoice.org_id,
        p_invoice_id: id,
      });
      if (reverseError) return { success: false, error: reverseError.message };
    }

    // Re-fetch invoice after potential credit reversal
    const { data: updatedInvoice } = await db
      .from('invoices')
      .select('amount_paid')
      .eq('id', id)
      .single();

    // Block void if there are still cash payments
    if (Number(updatedInvoice.amount_paid) > 0) {
      return { success: false, error: 'Cannot void an invoice that has cash payments. Remove payments first.' };
    }

    const { error } = await db
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to void invoice' };
  }
}

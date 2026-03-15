'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function voidInvoice(id: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check if invoice has payments
    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid, status')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (Number(invoice.amount_paid) > 0) {
      return { success: false, error: 'Cannot void an invoice that has payments' };
    }

    if (invoice.status === 'void') {
      return { success: false, error: 'Invoice is already void' };
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

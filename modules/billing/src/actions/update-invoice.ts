'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { invoiceSchema, type InvoiceFormValues } from '../schemas/invoice-schema';

export async function updateInvoice(
  id: string,
  values: InvoiceFormValues
): Promise<ActionResult> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check if amount is being reduced below amount_paid
    const { data: invoice, error: fetchError } = await db
      .from('invoices')
      .select('amount_paid')
      .eq('id', id)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    if (parsed.data.amount < Number(invoice.amount_paid)) {
      return { success: false, error: 'Cannot reduce amount below what has already been paid' };
    }

    // Exclude direction from update — cannot change after creation
    const { direction: _, ...updateData } = parsed.data;
    const { error } = await db
      .from('invoices')
      .update({
        ...updateData,
        unit_id: updateData.unit_id || null,
        tenant_id: updateData.tenant_id || null,
        provider_id: updateData.provider_id || null,
      })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update invoice' };
  }
}

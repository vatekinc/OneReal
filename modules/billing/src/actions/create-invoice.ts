'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { invoiceSchema, type InvoiceFormValues } from '../schemas/invoice-schema';

export async function createInvoice(
  orgId: string,
  values: InvoiceFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get next invoice number
    const { data: seqData, error: seqError } = await db.rpc('next_invoice_number', {
      p_org_id: orgId,
    });
    if (seqError) return { success: false, error: seqError.message };

    const { data, error } = await db
      .from('invoices')
      .insert({
        ...parsed.data,
        org_id: orgId,
        invoice_number: seqData,
        unit_id: parsed.data.unit_id || null,
        tenant_id: parsed.data.tenant_id || null,
        provider_id: parsed.data.provider_id || null,
        issued_date: parsed.data.issued_date || new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create invoice' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { paymentSchema, type PaymentFormValues } from '../schemas/payment-schema';

export async function recordPayment(
  orgId: string,
  values: PaymentFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = paymentSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // 1. Fetch invoice
    const { data: invoice, error: invoiceError } = await db
      .from('invoices')
      .select('*')
      .eq('id', parsed.data.invoice_id)
      .single();

    if (invoiceError) return { success: false, error: invoiceError.message };

    // 2. Validate payment amount
    const remaining = Number(invoice.amount) - Number(invoice.amount_paid);
    if (parsed.data.amount > remaining) {
      return { success: false, error: `Payment exceeds remaining balance of $${remaining.toFixed(2)}` };
    }

    if (invoice.status === 'void' || invoice.status === 'paid') {
      return { success: false, error: `Cannot pay a ${invoice.status} invoice` };
    }

    // 3. Auto-create income or expense record
    let incomeId: string | null = null;
    let expenseId: string | null = null;

    if (invoice.direction === 'receivable') {
      // Map description to income_type
      const desc = (invoice.description || '').toLowerCase();
      let incomeType = 'other';
      if (desc.includes('rent')) incomeType = 'rent';
      else if (desc.includes('deposit')) incomeType = 'deposit';

      const { data: incomeRow, error: incomeError } = await db
        .from('income')
        .insert({
          org_id: orgId,
          property_id: invoice.property_id,
          unit_id: invoice.unit_id || null,
          amount: parsed.data.amount,
          income_type: incomeType,
          description: `Payment for ${invoice.invoice_number}`,
          transaction_date: parsed.data.payment_date,
        })
        .select('id')
        .single();

      if (incomeError) return { success: false, error: incomeError.message };
      incomeId = incomeRow.id;
    } else {
      // payable → create expense
      const { data: expenseRow, error: expenseError } = await db
        .from('expenses')
        .insert({
          org_id: orgId,
          property_id: invoice.property_id,
          unit_id: invoice.unit_id || null,
          amount: parsed.data.amount,
          expense_type: 'maintenance',
          description: `Payment for ${invoice.invoice_number}`,
          transaction_date: parsed.data.payment_date,
          provider_id: invoice.provider_id || null,
        })
        .select('id')
        .single();

      if (expenseError) return { success: false, error: expenseError.message };
      expenseId = expenseRow.id;
    }

    // 4. Create payment row
    const { data: payment, error: paymentError } = await db
      .from('payments')
      .insert({
        org_id: orgId,
        invoice_id: parsed.data.invoice_id,
        amount: parsed.data.amount,
        payment_date: parsed.data.payment_date,
        payment_method: parsed.data.payment_method,
        reference_number: parsed.data.reference_number || null,
        notes: parsed.data.notes || null,
        income_id: incomeId,
        expense_id: expenseId,
      })
      .select('id')
      .single();

    if (paymentError) return { success: false, error: paymentError.message };

    // 5. Update invoice amount_paid and status
    const newAmountPaid = Number(invoice.amount_paid) + parsed.data.amount;
    const newStatus = newAmountPaid >= Number(invoice.amount) ? 'paid' : 'partially_paid';

    const { error: updateError } = await db
      .from('invoices')
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
      })
      .eq('id', parsed.data.invoice_id);

    if (updateError) return { success: false, error: updateError.message };

    return { success: true, data: { id: payment.id } };
  } catch {
    return { success: false, error: 'Failed to record payment' };
  }
}

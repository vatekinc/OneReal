'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

/**
 * Fetch eligible recurring expense templates for a given org + month/year.
 * Shared logic between generate and preview.
 */
async function fetchEligibleTemplates(
  db: any,
  orgId: string,
  month: number,
  year: number
) {
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

  // Fetch active templates within date range
  const { data: templates, error } = await db
    .from('recurring_expenses')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .lte('start_date', endOfMonth)
    .or(`end_date.is.null,end_date.gte.${startOfMonth}`);

  if (error) throw error;

  // Filter by frequency
  const eligible = (templates ?? []).filter((t: any) => {
    if (t.frequency === 'monthly') return true;
    if (t.frequency === 'yearly') {
      const startMonth = new Date(t.start_date + 'T00:00:00').getMonth() + 1;
      return startMonth === month;
    }
    return false;
  });

  return eligible;
}

/**
 * Check which templates already have generated invoices for this period.
 * Returns a Set of recurring_expense_id values that should be skipped.
 */
async function fetchExistingForPeriod(
  db: any,
  templateIds: string[],
  period: string
): Promise<Set<string>> {
  if (templateIds.length === 0) return new Set();

  const { data: existing } = await db
    .from('invoices')
    .select('recurring_expense_id')
    .in('recurring_expense_id', templateIds)
    .eq('generated_for_period', period);

  return new Set((existing ?? []).map((e: any) => e.recurring_expense_id));
}

export async function generateExpenses(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ generated: number; skipped: number }>> {
  try {
    if (month < 1 || month > 12) return { success: false, error: 'Invalid month' };

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const dueDate = `${year}-${String(month).padStart(2, '0')}-01`;

    const eligible = await fetchEligibleTemplates(db, orgId, month, year);
    if (eligible.length === 0) {
      return { success: true, data: { generated: 0, skipped: 0 } };
    }

    const templateIds = eligible.map((t: any) => t.id);
    const alreadyGenerated = await fetchExistingForPeriod(db, templateIds, period);

    let generated = 0;
    let skipped = 0;

    for (const template of eligible) {
      if (alreadyGenerated.has(template.id)) {
        skipped++;
        continue;
      }

      // Get next invoice number via RPC
      const { data: invoiceNumber, error: rpcError } = await db.rpc(
        'next_invoice_number',
        { p_org_id: template.org_id }
      );

      if (rpcError) {
        return { success: false, error: rpcError.message };
      }

      const { error: insertError } = await db.from('invoices').insert({
        org_id: template.org_id,
        invoice_number: invoiceNumber,
        direction: 'payable',
        status: 'open',
        property_id: template.property_id,
        unit_id: template.unit_id,
        amount: template.amount,
        amount_paid: 0,
        description: template.description,
        expense_type: template.expense_type,
        provider_id: template.provider_id,
        due_date: dueDate,
        issued_date: dueDate,
        recurring_expense_id: template.id,
        generated_for_period: period,
      });

      if (insertError) {
        // Unique constraint violation = concurrent generation, count as skipped
        if (insertError.code === '23505') {
          skipped++;
        } else {
          return { success: false, error: insertError.message };
        }
      } else {
        generated++;
      }
    }

    return { success: true, data: { generated, skipped } };
  } catch {
    return { success: false, error: 'Failed to generate expenses' };
  }
}

export async function previewGenerateExpenses(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number }>> {
  try {
    if (month < 1 || month > 12) return { success: false, error: 'Invalid month' };

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const eligible = await fetchEligibleTemplates(db, orgId, month, year);
    const templateIds = eligible.map((t: any) => t.id);
    const alreadyGenerated = await fetchExistingForPeriod(db, templateIds, period);

    const newEligible = eligible.filter((t: any) => !alreadyGenerated.has(t.id));

    return { success: true, data: { eligible: newEligible.length } };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}

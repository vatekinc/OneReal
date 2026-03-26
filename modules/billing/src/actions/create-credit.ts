'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { creditSchema, type CreditFormValues } from '../schemas/credit-schema';

export async function createCredit(
  orgId: string,
  values: CreditFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = creditSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // For advance_payment, create income record immediately
    let incomeId: string | null = null;
    if (parsed.data.source === 'advance_payment') {
      let propertyId = parsed.data.property_id;
      if (!propertyId && parsed.data.lease_id) {
        const { data: lease } = await db
          .from('leases')
          .select('unit_id, units(property_id)')
          .eq('id', parsed.data.lease_id)
          .single();
        propertyId = lease?.units?.property_id ?? null;
      }

      if (propertyId) {
        const { data: incomeRow, error: incomeError } = await db
          .from('income')
          .insert({
            org_id: orgId,
            property_id: propertyId,
            amount: parsed.data.amount,
            income_type: 'advance_payment',
            description: `Advance payment credit: ${parsed.data.reason}`,
            transaction_date: new Date().toISOString().split('T')[0],
          })
          .select('id')
          .single();

        if (incomeError) return { success: false, error: incomeError.message };
        incomeId = incomeRow.id;
      }
    }

    const { data, error } = await db
      .from('credits')
      .insert({
        org_id: orgId,
        tenant_id: parsed.data.tenant_id,
        lease_id: parsed.data.lease_id || null,
        property_id: parsed.data.property_id || null,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        source: parsed.data.source,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      // Rollback: delete orphaned income record if credit insert failed
      if (incomeId) {
        await db.from('income').delete().eq('id', incomeId);
      }
      return { success: false, error: error.message };
    }
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create credit' };
  }
}

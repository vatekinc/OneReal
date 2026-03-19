'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { leaseSchema, type LeaseFormValues } from '../schemas/lease-schema';

export async function createLease(
  orgId: string,
  values: LeaseFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = leaseSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Extract fields not stored on leases table
    const { property_id, tenant_ids, ...leaseData } = parsed.data;

    // For month-to-month leases, ensure end_date is null
    if (leaseData.lease_type === 'month_to_month') {
      leaseData.end_date = undefined as any;
    }

    const { data, error } = await db
      .from('leases')
      .insert({
        ...leaseData,
        org_id: orgId,
        end_date: leaseData.end_date || null,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    // Insert lease_tenants junction rows
    const leaseTenantsRows = tenant_ids.map((tid: string) => ({
      lease_id: data.id,
      tenant_id: tid,
    }));

    const { error: tenantError } = await db
      .from('lease_tenants')
      .insert(leaseTenantsRows);

    if (tenantError) return { success: false, error: tenantError.message };

    // Unit occupancy sync: if lease is active, mark unit as occupied
    if (parsed.data.status === 'active') {
      await db
        .from('units')
        .update({ status: 'occupied' })
        .eq('id', parsed.data.unit_id);
    }

    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to create lease' };
  }
}

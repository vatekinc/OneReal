'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface GenerateResult {
  created: number;
  skipped: number;
  skipReasons?: string[];
}

export async function generateInvoices(
  orgId: string,
  month: number, // 1-12
  year: number
): Promise<ActionResult<GenerateResult>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // 1. Fetch active leases with unit → property join
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, units(property_id)')
      .eq('org_id', orgId)
      .eq('status', 'active');

    if (leaseError) return { success: false, error: leaseError.message };
    if (!leases || leases.length === 0) {
      return { success: true, data: { created: 0, skipped: 0 } };
    }

    // 2. Check which leases already have invoices for this month
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0]; // last day

    const leaseIds = leases.map((l: any) => l.id);
    const { data: existing, error: existError } = await db
      .from('invoices')
      .select('lease_id')
      .in('lease_id', leaseIds)
      .gte('due_date', startOfMonth)
      .lte('due_date', endOfMonth);

    if (existError) return { success: false, error: existError.message };

    const existingLeaseIds = new Set((existing ?? []).map((e: any) => e.lease_id));

    // 3. Generate invoices for qualifying leases
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = monthNames[month - 1];

    let created = 0;
    let skipped = 0;
    const skipReasons: string[] = [];

    for (const lease of leases) {
      if (existingLeaseIds.has(lease.id)) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: invoice already exists for this month`);
        continue;
      }

      const dueDay = lease.payment_due_day ?? 1;
      const maxDay = new Date(year, month, 0).getDate();
      const safeDay = Math.min(dueDay, maxDay);
      const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
      const propertyId = lease.units?.property_id;

      if (!propertyId || !lease.rent_amount) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: missing ${!propertyId ? 'property' : 'rent amount'}`);
        continue;
      }

      // Get next invoice number
      const { data: invoiceNumber, error: seqError } = await db.rpc('next_invoice_number', {
        p_org_id: orgId,
      });
      if (seqError) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: invoice number error - ${seqError.message}`);
        continue;
      }

      const { error: insertError } = await db.from('invoices').insert({
        org_id: orgId,
        invoice_number: invoiceNumber,
        direction: 'receivable',
        status: 'open',
        lease_id: lease.id,
        tenant_id: lease.tenant_id,
        property_id: propertyId,
        unit_id: lease.unit_id,
        amount: lease.rent_amount,
        due_date: dueDate,
        issued_date: new Date().toISOString().split('T')[0],
        description: `Rent - ${monthName} ${year}`,
      });

      if (insertError) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: insert failed - ${insertError.message}`);
      } else {
        created++;
      }
    }

    return { success: true, data: { created, skipped, skipReasons } };
  } catch {
    return { success: false, error: 'Failed to generate invoices' };
  }
}

export async function getGenerationPreview(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number; existing: number }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active');

    if (leaseError) return { success: false, error: leaseError.message };

    const total = leases?.length ?? 0;
    if (total === 0) return { success: true, data: { eligible: 0, existing: 0 } };

    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

    const leaseIds = leases.map((l: any) => l.id);
    const { data: existing } = await db
      .from('invoices')
      .select('lease_id')
      .in('lease_id', leaseIds)
      .gte('due_date', startOfMonth)
      .lte('due_date', endOfMonth);

    const existingCount = existing?.length ?? 0;

    return { success: true, data: { eligible: total - existingCount, existing: existingCount } };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}

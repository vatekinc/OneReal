'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface GenerateResult {
  created: number;
  skipped: number;
  lateFees: number;
  skipReasons?: string[];
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export async function generateInvoices(
  orgId: string,
  month: number, // 1-12
  year: number
): Promise<ActionResult<GenerateResult>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    if (month < 1 || month > 12) return { success: false, error: 'Invalid month' };

    const db = supabase as any;
    const monthName = monthNames[month - 1];
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch active + month_to_month leases
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, end_date, auto_month_to_month, late_fee_type, late_fee_amount, late_fee_grace_days, units(property_id)')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    if (leaseError) return { success: false, error: leaseError.message };
    if (!leases || leases.length === 0) {
      // Still assess late fees even with no active leases
      const lateFees = await assessLateFees(db, orgId, today);
      return { success: true, data: { created: 0, skipped: 0, lateFees } };
    }

    // 2. Auto-update status for expired leases
    for (const lease of leases) {
      if (lease.end_date && lease.end_date < today && lease.auto_month_to_month !== false) {
        const { error: transitionError } = await db
          .from('leases')
          .update({ status: 'month_to_month' })
          .eq('id', lease.id)
          .eq('status', 'active');
        if (transitionError) {
          return { success: false, error: `Failed to transition lease ${lease.id} to month-to-month: ${transitionError.message}` };
        }
      } else if (lease.end_date && lease.end_date < today && lease.auto_month_to_month === false) {
        const { error: expireError } = await db
          .from('leases')
          .update({ status: 'expired' })
          .eq('id', lease.id)
          .eq('status', 'active');
        if (expireError) {
          return { success: false, error: `Failed to expire lease ${lease.id}: ${expireError.message}` };
        }
      }
    }

    // Re-fetch to get updated statuses (some may now be expired)
    const { data: activeLeases } = await db
      .from('leases')
      .select('id, tenant_id, unit_id, rent_amount, payment_due_day, units(property_id)')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    const eligibleLeases = activeLeases ?? [];

    // 3. Fetch lease charges for all eligible leases
    const leaseIds = eligibleLeases.map((l: any) => l.id);
    let allCharges: any[] = [];
    if (leaseIds.length > 0) {
      const { data: charges } = await db
        .from('lease_charges')
        .select('*')
        .in('lease_id', leaseIds)
        .eq('is_active', true);
      allCharges = charges ?? [];
    }

    // 4. Fetch existing invoices for idempotency checks
    let existingRentInvoices = new Set<string>();
    let existingChargeInvoices = new Set<string>(); // key: "chargeId-month-year"

    if (leaseIds.length > 0) {
      // Rent invoices: lease_id + month + lease_charge_id IS NULL
      const { data: existRent } = await db
        .from('invoices')
        .select('lease_id')
        .in('lease_id', leaseIds)
        .is('lease_charge_id', null)
        .gte('due_date', startOfMonth)
        .lte('due_date', endOfMonth);

      existingRentInvoices = new Set((existRent ?? []).map((e: any) => e.lease_id));

      // Charge invoices: lease_charge_id + month
      const chargeIds = allCharges.map((c: any) => c.id);
      if (chargeIds.length > 0) {
        const { data: existCharge } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', chargeIds)
          .gte('due_date', startOfMonth)
          .lte('due_date', endOfMonth);

        existingChargeInvoices = new Set(
          (existCharge ?? []).map((e: any) => `${e.lease_charge_id}-${month}-${year}`)
        );

        // Also check one-time charges that have ANY invoice (regardless of month)
        const oneTimeChargeIds = allCharges
          .filter((c: any) => c.frequency === 'one_time')
          .map((c: any) => c.id);

        if (oneTimeChargeIds.length > 0) {
          const { data: existOneTime } = await db
            .from('invoices')
            .select('lease_charge_id')
            .in('lease_charge_id', oneTimeChargeIds);

          for (const e of (existOneTime ?? [])) {
            existingChargeInvoices.add(`${e.lease_charge_id}-onetime`);
          }
        }
      }
    }

    // 5. Generate invoices
    let created = 0;
    let skipped = 0;
    const skipReasons: string[] = [];

    for (const lease of eligibleLeases) {
      const propertyId = lease.units?.property_id;
      const dueDay = lease.payment_due_day ?? 1;
      const maxDay = new Date(year, month, 0).getDate();
      const safeDay = Math.min(dueDay, maxDay);
      const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;

      if (!propertyId) {
        skipped++;
        skipReasons.push(`Lease ${lease.id}: missing property`);
        continue;
      }

      // 5a. Rent invoice
      if (lease.rent_amount && lease.rent_amount > 0) {
        if (!existingRentInvoices.has(lease.id)) {
          const result = await insertInvoiceRecord(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: lease.rent_amount,
            due_date: dueDate,
            description: `Rent - ${monthName} ${year}`,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: rent - ${result.error}`);
          }
        }
      }

      // 5b. Additional charges
      const leaseCharges = allCharges.filter((c: any) => c.lease_id === lease.id);

      for (const charge of leaseCharges) {
        // Check charge date range
        if (charge.start_date > endOfMonth) continue; // hasn't started yet
        if (charge.end_date && charge.end_date < startOfMonth) continue; // already ended

        if (charge.frequency === 'monthly') {
          const key = `${charge.id}-${month}-${year}`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await insertInvoiceRecord(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: `${charge.name} - ${monthName} ${year}`,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        } else if (charge.frequency === 'yearly') {
          // Only generate in the month matching start_date month
          const chargeMonth = new Date(charge.start_date + 'T00:00:00').getMonth() + 1;
          if (chargeMonth !== month) continue;

          const key = `${charge.id}-${month}-${year}`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await insertInvoiceRecord(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: `${charge.name} - ${year}`,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        } else if (charge.frequency === 'one_time') {
          const key = `${charge.id}-onetime`;
          if (existingChargeInvoices.has(key)) continue;

          const result = await insertInvoiceRecord(db, orgId, {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            property_id: propertyId,
            unit_id: lease.unit_id,
            amount: charge.amount,
            due_date: dueDate,
            description: charge.name,
            lease_charge_id: charge.id,
          });

          if (result.success) created++;
          else {
            skipped++;
            skipReasons.push(`Lease ${lease.id}: ${charge.name} - ${result.error}`);
          }
        }
      }
    }

    // 6. Assess late fees
    const lateFees = await assessLateFees(db, orgId, today);

    return { success: true, data: { created, skipped, lateFees, skipReasons } };
  } catch {
    return { success: false, error: 'Failed to generate invoices' };
  }
}

// Helper: create a single invoice with auto-generated invoice number
async function insertInvoiceRecord(
  db: any,
  orgId: string,
  data: {
    lease_id: string;
    tenant_id: string;
    property_id: string;
    unit_id: string;
    amount: number;
    due_date: string;
    description: string;
    lease_charge_id?: string;
    late_fee_for_invoice_id?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { data: invoiceNumber, error: seqError } = await db.rpc('next_invoice_number', {
    p_org_id: orgId,
  });
  if (seqError) return { success: false, error: `invoice number error - ${seqError.message}` };

  const insertData: Record<string, unknown> = {
    org_id: orgId,
    invoice_number: invoiceNumber,
    direction: 'receivable',
    status: 'open',
    lease_id: data.lease_id,
    tenant_id: data.tenant_id,
    property_id: data.property_id,
    unit_id: data.unit_id,
    amount: data.amount,
    due_date: data.due_date,
    issued_date: new Date().toISOString().split('T')[0],
    description: data.description,
  };

  if (data.lease_charge_id) insertData.lease_charge_id = data.lease_charge_id;
  if (data.late_fee_for_invoice_id) insertData.late_fee_for_invoice_id = data.late_fee_for_invoice_id;

  const { error: insertError } = await db.from('invoices').insert(insertData);
  if (insertError) return { success: false, error: `insert failed - ${insertError.message}` };

  return { success: true };
}

// Helper: assess late fees on overdue invoices
async function assessLateFees(
  db: any,
  orgId: string,
  today: string
): Promise<number> {
  // Find overdue receivable invoices that:
  // 1. Are open or partially_paid
  // 2. Are NOT themselves late fees
  // 3. Are past due date
  // 4. Have a lease with late fee configuration
  const { data: overdueInvoices } = await db
    .from('invoices')
    .select('id, invoice_number, lease_id, tenant_id, property_id, unit_id, amount, amount_paid, due_date')
    .eq('org_id', orgId)
    .eq('direction', 'receivable')
    .in('status', ['open', 'partially_paid'])
    .is('late_fee_for_invoice_id', null)
    .lt('due_date', today);

  if (!overdueInvoices || overdueInvoices.length === 0) return 0;

  // Get leases with late fee config
  const overdueLeaseIds = [...new Set(overdueInvoices.map((inv: any) => inv.lease_id).filter(Boolean))];
  if (overdueLeaseIds.length === 0) return 0;

  const { data: leasesWithFees } = await db
    .from('leases')
    .select('id, late_fee_type, late_fee_amount, late_fee_grace_days')
    .in('id', overdueLeaseIds)
    .not('late_fee_type', 'is', null);

  if (!leasesWithFees || leasesWithFees.length === 0) return 0;

  const leaseFeesMap = new Map(leasesWithFees.map((l: any) => [l.id, l]));

  // Check which overdue invoices already have late fee invoices
  const overdueIds = overdueInvoices.map((inv: any) => inv.id);
  const { data: existingLateFees } = await db
    .from('invoices')
    .select('late_fee_for_invoice_id')
    .in('late_fee_for_invoice_id', overdueIds);

  const hasLateFee = new Set((existingLateFees ?? []).map((e: any) => e.late_fee_for_invoice_id));

  let lateFeeCount = 0;

  for (const inv of overdueInvoices) {
    if (!inv.lease_id || !leaseFeesMap.has(inv.lease_id)) continue;
    if (hasLateFee.has(inv.id)) continue;

    const leaseConfig = leaseFeesMap.get(inv.lease_id);
    const graceDays = leaseConfig.late_fee_grace_days ?? 5;

    // Check grace period
    const dueDate = new Date(inv.due_date + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const daysPastDue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPastDue <= graceDays) continue;

    // Calculate late fee amount
    let feeAmount: number;
    if (leaseConfig.late_fee_type === 'flat') {
      feeAmount = Number(leaseConfig.late_fee_amount);
    } else {
      // Percentage on remaining balance
      const remaining = Number(inv.amount) - Number(inv.amount_paid);
      feeAmount = Math.round(remaining * (Number(leaseConfig.late_fee_amount) / 100) * 100) / 100;
    }

    if (feeAmount <= 0) continue;

    const result = await insertInvoiceRecord(db, orgId, {
      lease_id: inv.lease_id,
      tenant_id: inv.tenant_id,
      property_id: inv.property_id,
      unit_id: inv.unit_id,
      amount: feeAmount,
      due_date: today,
      description: `Late Fee - ${inv.invoice_number}`,
      late_fee_for_invoice_id: inv.id,
    });

    if (result.success) lateFeeCount++;
  }

  return lateFeeCount;
}

// Preview function (also updated)
export async function getGenerationPreview(
  orgId: string,
  month: number,
  year: number
): Promise<ActionResult<{ eligible: number; existing: number; lateFees: number }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const today = new Date().toISOString().split('T')[0];
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

    // Count eligible leases (active + month_to_month)
    const { data: leases, error: leaseError } = await db
      .from('leases')
      .select('id, rent_amount, end_date, auto_month_to_month')
      .eq('org_id', orgId)
      .in('status', ['active', 'month_to_month']);

    if (leaseError) return { success: false, error: leaseError.message };

    // Filter out leases that would be expired (not M2M)
    const eligibleLeases = (leases ?? []).filter((l: any) => {
      if (l.end_date && l.end_date < today && !l.auto_month_to_month) return false;
      return true;
    });

    const leaseIds = eligibleLeases.map((l: any) => l.id);

    // Count existing rent invoices for this month
    let existingRentCount = 0;
    if (leaseIds.length > 0) {
      const { data: existRent } = await db
        .from('invoices')
        .select('lease_id')
        .in('lease_id', leaseIds)
        .is('lease_charge_id', null)
        .gte('due_date', startOfMonth)
        .lte('due_date', endOfMonth);
      existingRentCount = existRent?.length ?? 0;
    }

    // Count eligible charges
    let totalChargeInvoices = 0;
    let existingChargeCount = 0;
    if (leaseIds.length > 0) {
      const { data: charges } = await db
        .from('lease_charges')
        .select('id, lease_id, frequency, start_date, end_date')
        .in('lease_id', leaseIds)
        .eq('is_active', true);

      const activeCharges = (charges ?? []).filter((c: any) => {
        if (c.start_date > endOfMonth) return false;
        if (c.end_date && c.end_date < startOfMonth) return false;

        if (c.frequency === 'monthly') return true;
        if (c.frequency === 'yearly') {
          const chargeMonth = new Date(c.start_date + 'T00:00:00').getMonth() + 1;
          return chargeMonth === month;
        }
        if (c.frequency === 'one_time') return true;
        return false;
      });

      totalChargeInvoices = activeCharges.length;

      // Check existing charge invoices — split by frequency to avoid double-counting
      const nonOneTimeIds = activeCharges
        .filter((c: any) => c.frequency !== 'one_time')
        .map((c: any) => c.id);

      if (nonOneTimeIds.length > 0) {
        // Monthly/yearly charges in this month
        const { data: existCharge } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', nonOneTimeIds)
          .gte('due_date', startOfMonth)
          .lte('due_date', endOfMonth);
        existingChargeCount = existCharge?.length ?? 0;
      }

      // One-time charges that already have any invoice (regardless of month)
      const oneTimeIds = activeCharges
        .filter((c: any) => c.frequency === 'one_time')
        .map((c: any) => c.id);
      if (oneTimeIds.length > 0) {
        const { data: existOneTime } = await db
          .from('invoices')
          .select('lease_charge_id')
          .in('lease_charge_id', oneTimeIds);
        existingChargeCount += existOneTime?.length ?? 0;
      }
    }

    // Count late fees eligible
    let lateFeeCount = 0;
    const { data: overdueInvoices } = await db
      .from('invoices')
      .select('id, lease_id, due_date')
      .eq('org_id', orgId)
      .eq('direction', 'receivable')
      .in('status', ['open', 'partially_paid'])
      .is('late_fee_for_invoice_id', null)
      .lt('due_date', today);

    if (overdueInvoices && overdueInvoices.length > 0) {
      const overdueLeaseIds = [...new Set(overdueInvoices.map((inv: any) => inv.lease_id).filter(Boolean))];
      if (overdueLeaseIds.length > 0) {
        const { data: leasesWithFees } = await db
          .from('leases')
          .select('id, late_fee_grace_days')
          .in('id', overdueLeaseIds)
          .not('late_fee_type', 'is', null);

        if (leasesWithFees && leasesWithFees.length > 0) {
          const leaseFeesMap = new Map(leasesWithFees.map((l: any) => [l.id, l]));
          const overdueIds = overdueInvoices.map((inv: any) => inv.id);

          const { data: existingLateFees } = await db
            .from('invoices')
            .select('late_fee_for_invoice_id')
            .in('late_fee_for_invoice_id', overdueIds);

          const hasLateFee = new Set((existingLateFees ?? []).map((e: any) => e.late_fee_for_invoice_id));

          for (const inv of overdueInvoices) {
            if (!inv.lease_id || !leaseFeesMap.has(inv.lease_id)) continue;
            if (hasLateFee.has(inv.id)) continue;

            const config = leaseFeesMap.get(inv.lease_id);
            const graceDays = config.late_fee_grace_days ?? 5;
            const dueDate = new Date(inv.due_date + 'T00:00:00');
            const todayDate = new Date(today + 'T00:00:00');
            const daysPastDue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysPastDue > graceDays) lateFeeCount++;
          }
        }
      }
    }

    const rentEligible = eligibleLeases.filter((l: any) => l.rent_amount && l.rent_amount > 0).length;
    const totalEligible = (rentEligible - existingRentCount) + (totalChargeInvoices - existingChargeCount);
    const totalExisting = existingRentCount + existingChargeCount;

    return {
      success: true,
      data: {
        eligible: Math.max(0, totalEligible),
        existing: totalExisting,
        lateFees: lateFeeCount,
      },
    };
  } catch {
    return { success: false, error: 'Failed to check generation preview' };
  }
}

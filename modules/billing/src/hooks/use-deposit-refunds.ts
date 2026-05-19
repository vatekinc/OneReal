'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';

export interface DepositRefundFilters {
  orgId: string | null;
  leaseId?: string;
  tenantId?: string;
  status?: 'active' | 'void';
}

export function useDepositRefunds(filters: DepositRefundFilters) {
  return useQuery({
    queryKey: ['deposit-refunds', filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = (supabase as any)
        .from('deposit_refunds')
        .select(`
          *,
          tenants(first_name, last_name),
          leases(start_date, end_date, units(unit_number, properties(name))),
          expense:expenses!deposit_refunds_expense_id_fkey(id, amount, transaction_date),
          deductions:deposit_refund_deductions(
            expense:expenses(id, amount, description, transaction_date, expense_type)
          ),
          settlements:deposit_refund_invoice_settlements(
            amount,
            invoice:invoices(invoice_number, description)
          )
        `)
        .eq('org_id', filters.orgId)
        .order('refund_date', { ascending: false });

      if (filters.leaseId) query = query.eq('lease_id', filters.leaseId);
      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.status) query = query.eq('status', filters.status);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!filters.orgId,
  });
}

export function useDepositSummary(orgId: string | null, leaseId: string | null) {
  return useQuery({
    queryKey: ['deposit-summary', orgId, leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await (supabase as any).rpc('get_lease_deposit_summary', {
        p_org_id: orgId,
        p_lease_id: leaseId,
      });
      if (error) throw error;
      return data?.[0] ?? { held: 0, refunded: 0, withheld: 0, balance: 0, refund_count: 0 };
    },
    enabled: !!orgId && !!leaseId,
  });
}

export interface EligibleExpense {
  id: string;
  amount: number;
  description: string;
  transaction_date: string;
  expense_type: string;
  lease_id: string | null;
  property_id: string;
}

/**
 * Lists expenses eligible to be linked as deductions on a deposit refund.
 * - Always includes expenses with lease_id = leaseId
 * - When includePropertyWindow=true, also includes expenses on the same
 *   property within the lease date window (+ 60 days).
 * - Excludes expenses already linked to active refunds.
 * - Excludes deposit_refund expenses themselves.
 */
export function useEligibleDeductions(
  orgId: string | null,
  leaseId: string | null,
  includePropertyWindow: boolean,
) {
  return useQuery({
    queryKey: ['deposit-eligible-deductions', orgId, leaseId, includePropertyWindow],
    queryFn: async () => {
      if (!orgId || !leaseId) return [] as EligibleExpense[];
      const supabase = createClient();
      const db = supabase as any;

      const { data: lease } = await db
        .from('leases')
        .select('start_date, end_date, units(property_id)')
        .eq('id', leaseId)
        .single();

      if (!lease) return [];

      const { data: linkedRows } = await db
        .from('deposit_refund_deductions')
        .select('expense_id, deposit_refunds!inner(status, org_id)')
        .eq('deposit_refunds.status', 'active')
        .eq('deposit_refunds.org_id', orgId);
      const linkedIds = new Set((linkedRows ?? []).map((r: any) => r.expense_id));

      let q = db
        .from('expenses')
        .select('id, amount, description, transaction_date, expense_type, lease_id, property_id')
        .eq('org_id', orgId)
        .neq('expense_type', 'deposit_refund')
        .order('transaction_date', { ascending: false });

      const propertyId = lease.units?.property_id;
      if (includePropertyWindow && propertyId) {
        const upperEnd = lease.end_date ?? new Date().toISOString().split('T')[0];
        const upperPlus60 = new Date(upperEnd);
        upperPlus60.setDate(upperPlus60.getDate() + 60);
        const upperStr = upperPlus60.toISOString().split('T')[0];
        q = q.or(
          `lease_id.eq.${leaseId},and(property_id.eq.${propertyId},transaction_date.gte.${lease.start_date},transaction_date.lte.${upperStr})`,
        );
      } else {
        q = q.eq('lease_id', leaseId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((e: any) => !linkedIds.has(e.id)) as EligibleExpense[];
    },
    enabled: !!orgId && !!leaseId,
  });
}

export interface EligibleInvoiceSettlement {
  id: string;
  invoice_number: string;
  description: string;
  amount: number;
  amount_paid: number;
  outstanding: number;
  due_date: string;
}

/**
 * Lists receivable invoices eligible to be settled from the deposit:
 * - direction='receivable', status in ('open','partially_paid')
 * - lease_id = leaseId
 * - excludes invoices already settled by an active refund
 * The RPC re-validates under lock; this picker is best-effort.
 */
export function useEligibleInvoiceSettlements(
  orgId: string | null,
  leaseId: string | null,
) {
  return useQuery({
    queryKey: ['deposit-eligible-invoices', orgId, leaseId],
    queryFn: async () => {
      if (!orgId || !leaseId) return [] as EligibleInvoiceSettlement[];
      const supabase = createClient();
      const db = supabase as any;

      const { data: linkedRows } = await db
        .from('deposit_refund_invoice_settlements')
        .select('invoice_id, deposit_refunds!inner(status, org_id)')
        .eq('deposit_refunds.status', 'active')
        .eq('deposit_refunds.org_id', orgId);
      const linkedIds = new Set((linkedRows ?? []).map((r: any) => r.invoice_id));

      const { data, error } = await db
        .from('invoices')
        .select('id, invoice_number, description, amount, amount_paid, due_date, status, direction, lease_id')
        .eq('org_id', orgId)
        .eq('direction', 'receivable')
        .eq('lease_id', leaseId)
        .eq('is_deposit', false)
        .in('status', ['open', 'partially_paid'])
        .order('due_date', { ascending: true });

      if (error) throw error;
      return (data ?? [])
        .filter((i: any) => !linkedIds.has(i.id))
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          description: i.description,
          amount: Number(i.amount),
          amount_paid: Number(i.amount_paid),
          outstanding: Number(i.amount) - Number(i.amount_paid),
          due_date: i.due_date,
        }))
        .filter((i: EligibleInvoiceSettlement) => i.outstanding > 0) as EligibleInvoiceSettlement[];
    },
    enabled: !!orgId && !!leaseId,
  });
}

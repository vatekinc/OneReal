import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantStatementRow, PropertyStatementRow, RentRollRow } from '@onereal/types';

type Client = SupabaseClient;

interface DateRange {
  from: string;
  to: string;
}

function dateParams(dateRange?: DateRange): { p_from: string | null; p_to: string | null } {
  return {
    p_from: dateRange?.from ?? null,
    p_to: dateRange?.to ?? null,
  };
}

export async function getTenantStatement(
  client: Client,
  orgId: string,
  tenantId: string,
  propertyId: string,
  dateRange?: DateRange,
): Promise<TenantStatementRow[]> {
  const { data, error } = await (client as any).rpc('get_tenant_statement', {
    p_org_id: orgId,
    p_tenant_id: tenantId,
    p_property_id: propertyId,
    ...dateParams(dateRange),
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    txn_date: row.txn_date,
    sort_key: Number(row.sort_key),
    txn_type: row.txn_type,
    description: row.description ?? '',
    reference: row.reference ?? '',
    charge_amount: Number(row.charge_amount) || 0,
    payment_amount: Number(row.payment_amount) || 0,
    running_balance: Number(row.running_balance) || 0,
  }));
}

export async function getPropertyStatement(
  client: Client,
  orgId: string,
  propertyId: string,
  dateRange?: DateRange,
): Promise<PropertyStatementRow[]> {
  const { data, error } = await (client as any).rpc('get_property_statement', {
    p_org_id: orgId,
    p_property_id: propertyId,
    ...dateParams(dateRange),
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    txn_date: row.txn_date,
    sort_key: Number(row.sort_key),
    txn_type: row.txn_type,
    tenant_or_vendor: row.tenant_or_vendor ?? null,
    description: row.description ?? '',
    income_amount: Number(row.income_amount) || 0,
    expense_amount: Number(row.expense_amount) || 0,
    running_balance: Number(row.running_balance) || 0,
  }));
}

export async function getRentRoll(
  client: Client,
  orgId: string,
  leaseStatus: string = 'active',
  propertyId?: string,
): Promise<RentRollRow[]> {
  const params: Record<string, any> = {
    p_org_id: orgId,
    p_lease_status: leaseStatus,
  };
  if (propertyId) params.p_property_id = propertyId;

  const { data, error } = await (client as any).rpc('get_rent_roll', params);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    tenant_id: row.tenant_id,
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    lease_count: Number(row.lease_count) || 0,
    total_monthly_rent: Number(row.total_monthly_rent) || 0,
    balance_due: Number(row.balance_due) || 0,
    credit_balance: Number(row.credit_balance) || 0,
    net_due: Number(row.net_due) || 0,
  }));
}

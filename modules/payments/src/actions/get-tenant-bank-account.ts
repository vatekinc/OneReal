'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export async function getTenantBankAccount(
  orgId: string
): Promise<ActionResult<TenantBankInfo | null>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: bank } = await (supabase as any)
      .from('tenant_bank_accounts')
      .select('id, institution_name, account_mask, account_name, auto_pay_enabled')
      .eq('tenant_id', user.id)
      .eq('org_id', orgId)
      .maybeSingle();

    return { success: true, data: bank || null };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to get bank account' };
  }
}

export async function toggleAutoPay(
  orgId: string,
  enabled: boolean
): Promise<ActionResult<void>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    await (supabase as any)
      .from('tenant_bank_accounts')
      .update({ auto_pay_enabled: enabled })
      .eq('tenant_id', user.id)
      .eq('org_id', orgId);

    return { success: true, data: undefined };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to toggle auto-pay' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface ConnectStatus {
  stripe_account_status: 'not_connected' | 'onboarding' | 'active' | 'restricted';
  stripe_account_id: string | null;
}

export async function getConnectStatus(
  orgId: string
): Promise<ActionResult<ConnectStatus>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: org } = await (supabase as any)
      .from('organizations')
      .select('stripe_account_id, stripe_account_status')
      .eq('id', orgId)
      .single();

    if (!org) return { success: false, error: 'Organization not found' };

    return {
      success: true,
      data: {
        stripe_account_status: (org as any).stripe_account_status || 'not_connected',
        stripe_account_id: (org as any).stripe_account_id || null,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to get connect status' };
  }
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
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

    const storedStatus = (org as any).stripe_account_status || 'not_connected';
    const accountId = (org as any).stripe_account_id || null;

    // If status is 'onboarding', verify with Stripe directly (webhooks may be missed)
    if (storedStatus === 'onboarding' && accountId) {
      try {
        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(accountId);
        const liveStatus = account.charges_enabled
          ? 'active'
          : account.details_submitted
            ? 'restricted'
            : 'onboarding';

        if (liveStatus !== storedStatus) {
          await (supabase as any)
            .from('organizations')
            .update({ stripe_account_status: liveStatus })
            .eq('id', orgId);
        }

        return {
          success: true,
          data: { stripe_account_status: liveStatus, stripe_account_id: accountId },
        };
      } catch {
        // Fall through to stored status if Stripe call fails
      }
    }

    return {
      success: true,
      data: { stripe_account_status: storedStatus, stripe_account_id: accountId },
    };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to get connect status' };
  }
}

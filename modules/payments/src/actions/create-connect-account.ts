'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import type { ActionResult } from '@onereal/types';

export async function createConnectAccount(
  orgId: string
): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const stripe = getStripe();

    const { data: org } = await db
      .from('organizations')
      .select('stripe_account_id')
      .eq('id', orgId)
      .single();

    let accountId = (org as any)?.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'US',
        email: user.email || undefined,
        metadata: { org_id: orgId },
      });
      accountId = account.id;

      await db.from('organizations').update({
        stripe_account_id: accountId,
        stripe_account_status: 'onboarding',
      }).eq('id', orgId);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${baseUrl}/settings?stripe=refresh`,
      return_url: `${baseUrl}/settings?stripe=success`,
    });

    return { success: true, data: { url: link.url } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create connect account' };
  }
}

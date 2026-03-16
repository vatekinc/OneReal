'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import type { ActionResult } from '@onereal/types';

export async function createPortalSession(
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
      .select('stripe_customer_id')
      .eq('id', orgId)
      .single();

    if (!(org as any)?.stripe_customer_id) {
      return { success: false, error: 'No subscription found' };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: (org as any).stripe_customer_id,
      return_url: `${baseUrl}/settings`,
    });

    return { success: true, data: { url: session.url } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create portal session' };
  }
}

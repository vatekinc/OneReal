'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getPlaidClient } from '../lib/plaid';
import { Products, CountryCode } from 'plaid';
import type { ActionResult } from '@onereal/types';

export async function createPlaidLinkToken(
  role: 'landlord' | 'tenant',
  orgId: string
): Promise<ActionResult<{ linkToken: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const plaid = getPlaidClient();
    const webhookUrl = process.env.PLAID_WEBHOOK_URL;

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'OneReal',
      products: [Products.Transfer],
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
    });

    return { success: true, data: { linkToken: response.data.link_token } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create link token' };
  }
}

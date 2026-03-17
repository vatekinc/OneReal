'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getPlaidClient } from '../lib/plaid';
import { encryptPlaidToken } from '../lib/plaid-crypto';
import type { ActionResult } from '@onereal/types';

interface ExchangeParams {
  publicToken: string;
  accountId: string;
  institutionName: string;
  accountMask: string;
  accountName: string;
}

export async function exchangePlaidToken(
  role: 'landlord' | 'tenant',
  orgId: string,
  params: ExchangeParams
): Promise<ActionResult<void>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const plaid = getPlaidClient();
    const db = supabase as any;

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: params.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;
    const encryptedToken = encryptPlaidToken(accessToken);

    if (role === 'landlord') {
      // Verify user is admin/landlord of this org
      const { data: membership } = await db
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .in('role', ['admin', 'landlord', 'property_manager'])
        .eq('status', 'active')
        .maybeSingle();

      if (!membership) return { success: false, error: 'Not authorized' };

      await db.from('organizations').update({
        plaid_access_token_encrypted: encryptedToken,
        plaid_account_id: params.accountId,
        plaid_item_id: itemId,
        plaid_institution_name: params.institutionName,
        plaid_account_mask: params.accountMask,
        plaid_status: 'active',
      }).eq('id', orgId);
    } else {
      // Tenant: upsert bank account (one per tenant per org)
      await db.from('tenant_bank_accounts').upsert({
        tenant_id: user.id,
        org_id: orgId,
        plaid_access_token_encrypted: encryptedToken,
        plaid_account_id: params.accountId,
        plaid_item_id: itemId,
        institution_name: params.institutionName,
        account_mask: params.accountMask,
        account_name: params.accountName,
      }, { onConflict: 'tenant_id,org_id' });
    }

    return { success: true, data: undefined };
  } catch (err: any) {
    const plaidError = err.response?.data;
    console.error('Plaid exchange error:', JSON.stringify(plaidError || err.message, null, 2));
    const message = plaidError?.error_message || err.message || 'Failed to exchange token';
    return { success: false, error: message };
  }
}

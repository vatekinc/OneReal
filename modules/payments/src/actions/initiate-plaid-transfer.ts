'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { createServiceRoleClient } from '@onereal/database/service-role';
import { getPlaidClient } from '../lib/plaid';
import { decryptPlaidToken } from '../lib/plaid-crypto';
import { TransferType, TransferNetwork, ACHClass } from 'plaid';
import type { ActionResult } from '@onereal/types';

export async function initiatePlaidTransfer(
  orgId: string,
  invoiceId: string
): Promise<ActionResult<{ transferId: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const plaid = getPlaidClient();

    // 1. Fetch invoice
    const { data: invoice } = await db
      .from('invoices')
      .select('id, amount, amount_paid, description, org_id, tenant_id, status, invoice_number, plaid_transfer_id')
      .eq('id', invoiceId)
      .single();

    if (!invoice) return { success: false, error: 'Invoice not found' };
    if (!['open', 'partially_paid'].includes((invoice as any).status)) {
      return { success: false, error: 'Invoice is not payable' };
    }
    if ((invoice as any).plaid_transfer_id) {
      return { success: false, error: 'Payment already in progress' };
    }

    // 2. Fetch tenant's linked bank account
    const { data: tenantBank } = await db
      .from('tenant_bank_accounts')
      .select('plaid_access_token_encrypted, plaid_account_id')
      .eq('tenant_id', user.id)
      .eq('org_id', orgId)
      .single();

    if (!tenantBank) return { success: false, error: 'No linked bank account' };

    // 3. Verify org has Plaid connected
    const { data: org } = await db
      .from('organizations')
      .select('plaid_status')
      .eq('id', orgId)
      .single();

    if ((org as any)?.plaid_status !== 'active') {
      return { success: false, error: 'Organization has not connected Plaid' };
    }

    // 4. Calculate amount (remaining balance + $1 fee)
    const remaining = Number((invoice as any).amount) - Number((invoice as any).amount_paid);
    const totalDebit = remaining + 1.0; // $1 flat fee

    // 5. Decrypt tenant's access token
    const accessToken = decryptPlaidToken((tenantBank as any).plaid_access_token_encrypted);

    // 6. Authorize the debit
    const authResponse = await plaid.transferAuthorizationCreate({
      access_token: accessToken,
      account_id: (tenantBank as any).plaid_account_id,
      type: TransferType.Debit,
      network: TransferNetwork.Ach,
      amount: totalDebit.toFixed(2),
      ach_class: ACHClass.Ppd,
      user: {
        legal_name: user.user_metadata?.full_name || user.email || 'Tenant',
      },
    });

    const authorization = authResponse.data.authorization;
    if (authorization.decision !== 'approved') {
      const reason = authorization.decision_rationale?.description || 'Authorization declined';
      return { success: false, error: reason };
    }

    // 7. Create the debit transfer (type/network/ach_class/user are deprecated in transferCreate)
    const transferResponse = await plaid.transferCreate({
      access_token: accessToken,
      account_id: (tenantBank as any).plaid_account_id,
      authorization_id: authorization.id,
      amount: totalDebit.toFixed(2),
      description: `Rent ${(invoice as any).invoice_number}`.slice(0, 15),
      metadata: {
        invoice_id: invoiceId,
        org_id: orgId,
        tenant_id: (invoice as any).tenant_id || '',
        leg: 'debit',
      },
    });

    const transferId = transferResponse.data.transfer.id;

    // 8. Update invoice status (use service role to bypass RLS)
    const adminDb = createServiceRoleClient() as any;
    await adminDb.from('invoices').update({
      plaid_transfer_id: transferId,
      payment_processor: 'plaid',
      convenience_fee: 1.0,
      status: 'processing',
    }).eq('id', invoiceId);

    return { success: true, data: { transferId } };
  } catch (err: any) {
    const plaidError = err.response?.data;
    console.error('Plaid transfer error:', JSON.stringify(plaidError || err.message, null, 2));
    const message = plaidError?.error_message || err.message || 'Failed to initiate transfer';
    return { success: false, error: message };
  }
}

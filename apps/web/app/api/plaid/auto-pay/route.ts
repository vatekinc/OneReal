import { createServiceRoleClient } from '@onereal/database/service-role';
import { getPlaidClient } from '@onereal/payments';
import { decryptPlaidToken } from '@onereal/payments/lib/plaid-crypto';
import { TransferType, TransferNetwork, ACHClass } from 'plaid';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Verify service role authorization
  const authHeader = req.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceRoleClient() as any;
  const plaid = getPlaidClient();

  // Find open invoices due within 2 days where tenant has auto-pay enabled
  const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: openInvoices } = await db
    .from('invoices')
    .select('id, amount, amount_paid, org_id, tenant_id, invoice_number')
    .eq('status', 'open')
    .eq('direction', 'receivable')
    .is('plaid_transfer_id', null)
    .lte('due_date', twoDaysFromNow);

  if (!openInvoices || openInvoices.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let errors = 0;

  for (const inv of openInvoices) {
    const invoice = inv as any;

    // Check if tenant has auto-pay enabled for this org
    const { data: bank } = await db
      .from('tenant_bank_accounts')
      .select('plaid_access_token_encrypted, plaid_account_id, auto_pay_enabled')
      .eq('tenant_id', invoice.tenant_id)
      .eq('org_id', invoice.org_id)
      .eq('auto_pay_enabled', true)
      .maybeSingle();

    if (!bank) continue;

    // Check org has Plaid active
    const { data: org } = await db
      .from('organizations')
      .select('plaid_status')
      .eq('id', invoice.org_id)
      .single();

    if ((org as any)?.plaid_status !== 'active') continue;

    try {
      const remaining = Number(invoice.amount) - Number(invoice.amount_paid);
      const totalDebit = remaining + 1.0; // $1 flat fee
      const accessToken = decryptPlaidToken((bank as any).plaid_access_token_encrypted);

      // Authorize
      const authResponse = await plaid.transferAuthorizationCreate({
        access_token: accessToken,
        account_id: (bank as any).plaid_account_id,
        type: TransferType.Debit,
        network: TransferNetwork.Ach,
        amount: totalDebit.toFixed(2),
        ach_class: ACHClass.Ppd,
        user: { legal_name: 'Tenant' },
      });

      if (authResponse.data.authorization.decision !== 'approved') {
        console.error(`Auto-pay declined for invoice ${invoice.id}: ${authResponse.data.authorization.decision_rationale?.description}`);
        errors++;
        continue;
      }

      // Create transfer
      const transferResponse = await plaid.transferCreate({
        access_token: accessToken,
        account_id: (bank as any).plaid_account_id,
        authorization_id: authResponse.data.authorization.id,
        type: TransferType.Debit,
        network: TransferNetwork.Ach,
        amount: totalDebit.toFixed(2),
        description: `Auto-pay - ${invoice.invoice_number}`,
        ach_class: ACHClass.Ppd,
        user: { legal_name: 'Tenant' },
        metadata: {
          invoice_id: invoice.id,
          org_id: invoice.org_id,
          tenant_id: invoice.tenant_id || '',
          leg: 'debit',
          auto_pay: 'true',
        },
      });

      // Update invoice
      await db.from('invoices').update({
        plaid_transfer_id: transferResponse.data.transfer.id,
        payment_processor: 'plaid',
        convenience_fee: 1.0,
        status: 'processing',
      }).eq('id', invoice.id);

      processed++;
    } catch (error: any) {
      console.error(`Auto-pay error for invoice ${invoice.id}:`, error.message);
      errors++;
    }
  }

  return NextResponse.json({ processed, errors });
}

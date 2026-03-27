import { createServiceRoleClient } from '@onereal/database/service-role';
import { getPlaidClient } from '@onereal/payments';
import { decryptPlaidToken } from '@onereal/payments/lib/plaid-crypto';
import { TransferType, TransferNetwork, ACHClass } from 'plaid'; // Used in transferAuthorizationCreate
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

  // Batch-fetch bank accounts and org statuses upfront to avoid N+1 queries
  const tenantIds = [...new Set(openInvoices.map((inv: any) => inv.tenant_id))];
  const orgIds = [...new Set(openInvoices.map((inv: any) => inv.org_id))];

  const [{ data: banks }, { data: orgs }] = await Promise.all([
    db.from('tenant_bank_accounts')
      .select('tenant_id, org_id, plaid_access_token_encrypted, plaid_account_id, auto_pay_enabled')
      .eq('auto_pay_enabled', true)
      .in('tenant_id', tenantIds)
      .in('org_id', orgIds),
    db.from('organizations')
      .select('id, plaid_status')
      .in('id', orgIds),
  ]);

  const bankMap = new Map((banks ?? []).map((b: any) => [`${b.tenant_id}:${b.org_id}`, b]));
  const orgMap = new Map((orgs ?? []).map((o: any) => [o.id, o]));

  let processed = 0;
  let errors = 0;

  for (const inv of openInvoices) {
    const invoice = inv as any;

    const bank = bankMap.get(`${invoice.tenant_id}:${invoice.org_id}`);
    if (!bank) continue;

    const org = orgMap.get(invoice.org_id);
    if (org?.plaid_status !== 'active') continue;

    try {
      const remaining = Number(invoice.amount) - Number(invoice.amount_paid);
      const totalDebit = remaining + 1.0; // $1 flat fee
      const accessToken = decryptPlaidToken(bank.plaid_access_token_encrypted);

      // Authorize
      const authResponse = await plaid.transferAuthorizationCreate({
        access_token: accessToken,
        account_id: bank.plaid_account_id,
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

      // Create transfer (type/network/ach_class/user deprecated in transferCreate)
      const transferResponse = await plaid.transferCreate({
        access_token: accessToken,
        account_id: bank.plaid_account_id,
        authorization_id: authResponse.data.authorization.id,
        amount: totalDebit.toFixed(2),
        description: `Auto ${invoice.invoice_number}`.slice(0, 15),
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

import { createServiceRoleClient } from '@onereal/database/service-role';
import { getPlaidClient } from '@onereal/payments';
import { decryptPlaidToken } from '@onereal/payments/lib/plaid-crypto';
import { verifyPlaidWebhook } from '../../../../lib/plaid-webhook-verify';
import { TransferType, TransferNetwork, ACHClass } from 'plaid';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.text();

  // Verify webhook authenticity
  const isValid = await verifyPlaidWebhook(body, req.headers);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
  }

  const payload = JSON.parse(body);
  const webhookType = payload.webhook_type;
  const webhookCode = payload.webhook_code;

  const db = createServiceRoleClient() as any;
  const plaid = getPlaidClient();

  try {
    if (webhookType === 'TRANSFER') {
      await handleTransferEvents(db, plaid);
    } else if (webhookType === 'ITEM') {
      await handleItemEvent(db, webhookCode, payload);
    }
  } catch (error: any) {
    console.error(`Plaid webhook error (${webhookType}/${webhookCode}):`, error);
  }

  return NextResponse.json({ received: true });
}

async function handleTransferEvents(db: any, plaid: any) {
  // Get sync cursor
  const { data: cursorRow } = await db
    .from('platform_config')
    .select('value')
    .eq('key', 'plaid_transfer_sync_cursor')
    .single();

  const afterId = Number((cursorRow as any)?.value || '0');

  // Fetch new events since last cursor
  const syncResponse = await plaid.transferEventSync({
    after_id: afterId,
    count: 25,
  });

  const events = syncResponse.data.transfer_events;
  if (!events || events.length === 0) return;

  for (const event of events) {
    // Idempotency check
    const eventId = `plaid_${event.event_id}`;
    const { data: existing } = await db
      .from('payment_events')
      .select('id')
      .eq('plaid_event_id', eventId)
      .maybeSingle();

    if (existing) continue;

    // Insert event for audit
    const { data: eventRow } = await db
      .from('payment_events')
      .insert({
        stripe_event_id: eventId,
        plaid_event_id: eventId,
        event_type: `plaid.transfer.${event.event_type}`,
        payload: event as any,
      })
      .select('id')
      .single();

    try {
      const transferId = event.transfer_id;
      const eventType = event.event_type;

      if (eventType === 'settled') {
        await handleTransferSettled(db, plaid, transferId);
      } else if (eventType === 'failed') {
        await handleTransferFailed(db, transferId);
      } else if (eventType === 'returned') {
        await handleTransferReturned(db, transferId);
      }

      if (eventRow) {
        await db.from('payment_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', (eventRow as any).id);
      }
    } catch (error: any) {
      console.error(`Error processing Plaid event ${event.event_id}:`, error);
      if (eventRow) {
        await db.from('payment_events')
          .update({ error: error.message })
          .eq('id', (eventRow as any).id);
      }
    }
  }

  // Update sync cursor to the last event ID
  const lastEventId = events[events.length - 1].event_id;
  await db.from('platform_config')
    .update({ value: String(lastEventId), updated_at: new Date().toISOString() })
    .eq('key', 'plaid_transfer_sync_cursor');
}

async function handleTransferSettled(db: any, plaid: any, transferId: string) {
  // Find invoice linked to this debit transfer
  const { data: invoice } = await db
    .from('invoices')
    .select('id, amount, amount_paid, org_id, property_id, unit_id, tenant_id, status, invoice_number')
    .eq('plaid_transfer_id', transferId)
    .maybeSingle();

  if (!invoice) return; // May be a credit leg settlement — no-op

  // Only process if invoice is still in 'processing' (debit leg settled)
  if ((invoice as any).status !== 'processing') return;

  const remaining = Number((invoice as any).amount) - Number((invoice as any).amount_paid);
  const newAmountPaid = Number((invoice as any).amount_paid) + remaining;

  // 1. Create income record (first, to get ID for payment linkage)
  const { data: incomeRecord } = await db.from('income').insert({
    org_id: (invoice as any).org_id,
    property_id: (invoice as any).property_id,
    unit_id: (invoice as any).unit_id || null,
    amount: remaining,
    income_type: 'rent',
    description: `Plaid ACH payment for ${(invoice as any).invoice_number}`,
    transaction_date: new Date().toISOString().split('T')[0],
  }).select('id').single();

  // 2. Create payment record (linked to income)
  await db.from('payments').insert({
    org_id: (invoice as any).org_id,
    invoice_id: (invoice as any).id,
    amount: remaining,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'plaid',
    reference_number: transferId,
    income_id: (incomeRecord as any)?.id || null,
  });

  // 3. Update invoice to paid
  await db.from('invoices').update({
    amount_paid: newAmountPaid,
    status: 'paid',
  }).eq('id', (invoice as any).id);

  // 4. Initiate credit leg to landlord
  try {
    await initiateCreditLeg(db, plaid, invoice, remaining);
  } catch (error: any) {
    console.error(`Failed to initiate credit leg for invoice ${(invoice as any).id}:`, error);
    // Invoice stays paid — credit leg failure is tracked separately
    await db.from('platform_config').upsert({
      key: `failed_credit_${transferId}`,
      value: JSON.stringify({
        invoice_id: (invoice as any).id,
        org_id: (invoice as any).org_id,
        amount: remaining,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    });
  }
}

async function initiateCreditLeg(db: any, plaid: any, invoice: any, amount: number) {
  const orgId = (invoice as any).org_id;

  // Fetch landlord's Plaid credentials
  const { data: org } = await db
    .from('organizations')
    .select('plaid_access_token_encrypted, plaid_account_id, plaid_status')
    .eq('id', orgId)
    .single();

  if (!org || (org as any).plaid_status !== 'active') {
    throw new Error('Organization Plaid account not active');
  }

  const accessToken = decryptPlaidToken((org as any).plaid_access_token_encrypted);

  // Authorize credit
  const authResponse = await plaid.transferAuthorizationCreate({
    access_token: accessToken,
    account_id: (org as any).plaid_account_id,
    type: TransferType.Credit,
    network: TransferNetwork.Ach,
    amount: amount.toFixed(2),
    ach_class: ACHClass.Ccd,
    user: {
      legal_name: 'Landlord',
    },
  });

  if (authResponse.data.authorization.decision !== 'approved') {
    throw new Error(`Credit authorization declined: ${authResponse.data.authorization.decision_rationale?.description}`);
  }

  // Create credit transfer
  await plaid.transferCreate({
    access_token: accessToken,
    account_id: (org as any).plaid_account_id,
    authorization_id: authResponse.data.authorization.id,
    type: TransferType.Credit,
    network: TransferNetwork.Ach,
    amount: amount.toFixed(2),
    description: `Rent deposit - ${(invoice as any).invoice_number}`,
    ach_class: ACHClass.Ccd,
    user: {
      legal_name: 'Landlord',
    },
    metadata: {
      invoice_id: (invoice as any).id,
      org_id: orgId,
      leg: 'credit',
    },
  });
}

async function handleTransferFailed(db: any, transferId: string) {
  await db.from('invoices').update({
    status: 'open',
    plaid_transfer_id: null,
    payment_processor: null,
  }).eq('plaid_transfer_id', transferId).eq('status', 'processing');
}

async function handleTransferReturned(db: any, transferId: string) {
  const { data: invoice } = await db
    .from('invoices')
    .select('id, amount_paid, status')
    .eq('plaid_transfer_id', transferId)
    .maybeSingle();

  if (!invoice) return;

  if ((invoice as any).status === 'paid') {
    // Reverse: delete payment and income records created for this transfer
    const { data: payment } = await db.from('payments')
      .select('income_id')
      .eq('reference_number', transferId)
      .maybeSingle();

    await db.from('payments')
      .delete()
      .eq('reference_number', transferId);

    // Also delete the corresponding income record
    if (payment?.income_id) {
      await db.from('income').delete().eq('id', payment.income_id);
    }

    await db.from('invoices').update({
      status: 'open',
      amount_paid: 0,
      plaid_transfer_id: null,
      payment_processor: null,
    }).eq('id', (invoice as any).id);
  } else if ((invoice as any).status === 'processing') {
    await db.from('invoices').update({
      status: 'open',
      plaid_transfer_id: null,
      payment_processor: null,
    }).eq('id', (invoice as any).id);
  }
}

async function handleItemEvent(db: any, code: string, payload: any) {
  const itemId = payload.item_id;
  if (!itemId) return;

  if (code === 'LOGIN_REQUIRED' || code === 'PENDING_EXPIRATION') {
    // Flag org's Plaid account if it matches
    await db.from('organizations').update({
      plaid_status: 'not_connected',
    }).eq('plaid_item_id', itemId);

    // Flag tenant bank accounts and disable auto-pay
    await db.from('tenant_bank_accounts').update({
      auto_pay_enabled: false,
    }).eq('plaid_item_id', itemId);
  }
}

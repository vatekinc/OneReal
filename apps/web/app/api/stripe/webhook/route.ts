import { createServiceRoleClient } from '@onereal/database/service-role';
import { getStripe } from '@onereal/payments';
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = createServiceRoleClient() as any;

  // Idempotency check
  const { data: existing } = await db
    .from('payment_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true });
  }

  // Insert unprocessed event
  const { data: eventRow } = await db
    .from('payment_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event.data.object as any,
    })
    .select('id')
    .single();

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(db, stripe, event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(db, event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(db, event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(db, event.data.object as Stripe.Subscription);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(db, event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(db, event.data.object as Stripe.PaymentIntent);
        break;
      case 'account.updated':
        await handleAccountUpdated(db, event.data.object as Stripe.Account);
        break;
    }

    if (eventRow) {
      await db.from('payment_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', (eventRow as any).id);
    }
  } catch (error: any) {
    console.error(`Webhook error processing ${event.type}:`, error);
    if (eventRow) {
      await db.from('payment_events')
        .update({ error: error.message })
        .eq('id', (eventRow as any).id);
    }
  }

  return NextResponse.json({ received: true });
}

// --- Subscription handlers ---

async function handleCheckoutCompleted(
  db: any,
  stripe: any,
  session: Stripe.Checkout.Session
) {
  if (session.mode === 'subscription') {
    const orgId = session.metadata?.org_id;
    const planId = session.metadata?.plan_id;
    if (!orgId) return;

    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    const interval = subscription.items.data[0]?.price?.recurring?.interval;

    // Find the plan that matches this price ID
    let targetPlanId = planId;
    if (!targetPlanId) {
      const priceId = subscription.items.data[0]?.price?.id;
      const { data: plan } = await db
        .from('plans')
        .select('id')
        .or(`stripe_monthly_price_id.eq.${priceId},stripe_yearly_price_id.eq.${priceId}`)
        .single();
      if (plan) targetPlanId = (plan as any).id;
    }

    const updates: Record<string, any> = {
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subscription.id,
      subscription_status: 'active',
      subscription_period: interval === 'month' ? 'monthly' : 'yearly',
      subscription_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    };
    if (targetPlanId) updates.plan_id = targetPlanId;

    await db.from('organizations').update(updates).eq('id', orgId);
  } else if (session.mode === 'payment') {
    const invoiceId = session.metadata?.invoice_id;
    if (!invoiceId) return;

    // Check if invoice is already paid (idempotency)
    const { data: invoice } = await db
      .from('invoices')
      .select('id, amount, amount_paid, org_id, property_id, unit_id, status')
      .eq('id', invoiceId)
      .single();

    if (!invoice || ['paid', 'processing'].includes((invoice as any).status)) return;

    const paymentIntent = session.payment_intent as string;
    if (session.payment_status === 'processing') {
      // ACH: payment_status is 'processing' (card would be 'paid')
      await db.from('invoices').update({
        status: 'processing',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntent,
      }).eq('id', invoiceId);
    } else {
      // Card: process immediately
      await processRentPayment(db, invoice, paymentIntent, session.id);
    }
  }
}

async function processRentPayment(
  db: any,
  invoice: any,
  paymentIntentId: string,
  sessionId: string
) {
  const remaining = Number(invoice.amount) - Number(invoice.amount_paid);
  const newAmountPaid = Number(invoice.amount_paid) + remaining;
  const newStatus = newAmountPaid >= Number(invoice.amount) ? 'paid' : 'partially_paid';

  // 1. Create payment record
  await db.from('payments').insert({
    org_id: invoice.org_id,
    invoice_id: invoice.id,
    amount: remaining,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'online',
    reference_number: paymentIntentId,
  });

  // 2. Create income record
  await db.from('income').insert({
    org_id: invoice.org_id,
    property_id: invoice.property_id,
    unit_id: invoice.unit_id || null,
    amount: remaining,
    income_type: 'rent',
    description: `Online payment for invoice`,
    transaction_date: new Date().toISOString().split('T')[0],
  });

  // 3. Update invoice
  await db.from('invoices').update({
    amount_paid: newAmountPaid,
    status: newStatus,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: sessionId,
  }).eq('id', invoice.id);
}

async function handleInvoicePaid(db: any, stripeInvoice: Stripe.Invoice) {
  // Subscription recurring payment succeeded — update period end
  if (!stripeInvoice.subscription) return;
  const subId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription
    : stripeInvoice.subscription.id;

  const periodEnd = stripeInvoice.lines?.data?.[0]?.period?.end;
  if (!periodEnd) return;

  await db.from('organizations').update({
    subscription_status: 'active',
    subscription_current_period_end: new Date(periodEnd * 1000).toISOString(),
  }).eq('stripe_subscription_id', subId);
}

async function handleInvoicePaymentFailed(db: any, stripeInvoice: Stripe.Invoice) {
  if (!stripeInvoice.subscription) return;
  const subId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription
    : stripeInvoice.subscription.id;

  await db.from('organizations').update({
    subscription_status: 'past_due',
  }).eq('stripe_subscription_id', subId);
}

async function handleSubscriptionDeleted(db: any, subscription: Stripe.Subscription) {
  const { data: freePlan } = await db
    .from('plans')
    .select('id')
    .eq('is_default', true)
    .single();

  if (!freePlan) return;

  await db.from('organizations').update({
    plan_id: (freePlan as any).id,
    subscription_status: 'canceled',
    stripe_subscription_id: null,
    subscription_period: null,
    subscription_current_period_end: null,
  }).eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionUpdated(db: any, subscription: Stripe.Subscription) {
  const interval = subscription.items.data[0]?.price?.recurring?.interval;

  await db.from('organizations').update({
    subscription_status: subscription.status === 'active' ? 'active'
      : subscription.status === 'past_due' ? 'past_due'
      : subscription.status === 'canceled' ? 'canceled'
      : 'none',
    subscription_period: interval === 'month' ? 'monthly' : 'yearly',
    subscription_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  }).eq('stripe_subscription_id', subscription.id);
}

// --- Rent payment handlers (ACH confirmation) ---

async function handlePaymentIntentSucceeded(db: any, paymentIntent: Stripe.PaymentIntent) {
  // Find invoice in 'processing' state linked to this payment intent
  const { data: invoice } = await db
    .from('invoices')
    .select('id, amount, amount_paid, org_id, property_id, unit_id, status, stripe_checkout_session_id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('status', 'processing')
    .maybeSingle();

  if (!invoice) return;

  await processRentPayment(
    db,
    invoice,
    paymentIntent.id,
    (invoice as any).stripe_checkout_session_id
  );
}

async function handlePaymentIntentFailed(db: any, paymentIntent: Stripe.PaymentIntent) {
  await db.from('invoices').update({
    status: 'open',
  }).eq('stripe_payment_intent_id', paymentIntent.id).eq('status', 'processing');
}

// --- Connect account handler ---

async function handleAccountUpdated(db: any, account: Stripe.Account) {
  const status = account.charges_enabled ? 'active' : 'restricted';

  await db.from('organizations').update({
    stripe_account_status: status,
  }).eq('stripe_account_id', account.id);
}

'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import { calculateConvenienceFee, type PaymentMethod } from '../lib/fees';
import type { ActionResult } from '@onereal/types';

interface SubscriptionCheckoutOptions {
  type: 'subscription';
  planId: string;
  period: 'monthly' | 'yearly';
}

interface PaymentCheckoutOptions {
  type: 'payment';
  invoiceId: string;
  paymentMethod: PaymentMethod;
}

type CheckoutOptions = SubscriptionCheckoutOptions | PaymentCheckoutOptions;

export async function createCheckoutSession(
  orgId: string,
  options: CheckoutOptions
): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (options.type === 'subscription') {
      // Fetch plan pricing
      const { data: plan } = await db
        .from('plans')
        .select('id, name, stripe_monthly_price_id, stripe_yearly_price_id')
        .eq('id', options.planId)
        .single();

      if (!plan) return { success: false, error: 'Plan not found' };

      const priceId = options.period === 'monthly'
        ? (plan as any).stripe_monthly_price_id
        : (plan as any).stripe_yearly_price_id;

      if (!priceId) return { success: false, error: 'Plan pricing not configured in Stripe' };

      // Get or create Stripe Customer
      const { data: org } = await db
        .from('organizations')
        .select('stripe_customer_id')
        .eq('id', orgId)
        .single();

      let customerId = (org as any)?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { org_id: orgId },
        });
        customerId = customer.id;
        await db.from('organizations')
          .update({ stripe_customer_id: customerId })
          .eq('id', orgId);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/settings?subscription=success`,
        cancel_url: `${baseUrl}/settings?subscription=canceled`,
        metadata: { org_id: orgId, plan_id: options.planId },
      });

      return { success: true, data: { url: session.url! } };
    } else {
      // Rent payment checkout
      const { data: invoice } = await db
        .from('invoices')
        .select('id, amount, amount_paid, description, org_id, tenant_id, status')
        .eq('id', options.invoiceId)
        .single();

      if (!invoice) return { success: false, error: 'Invoice not found' };
      if (!['open', 'partially_paid'].includes((invoice as any).status)) {
        return { success: false, error: 'Invoice is not payable' };
      }

      // Get org's connected account
      const { data: org } = await db
        .from('organizations')
        .select('stripe_account_id, stripe_account_status')
        .eq('id', (invoice as any).org_id)
        .single();

      if (!(org as any)?.stripe_account_id || (org as any).stripe_account_status !== 'active') {
        return { success: false, error: 'Organization has not connected Stripe' };
      }

      const remaining = Number((invoice as any).amount) - Number((invoice as any).amount_paid);
      const method = options.paymentMethod;
      const fee = calculateConvenienceFee(remaining, method);

      // Only offer the method the tenant chose in the pre-checkout step
      const paymentMethodTypes: ('card' | 'us_bank_account' | 'link')[] =
        method === 'us_bank_account' ? ['us_bank_account'] : ['card', 'link'];

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: paymentMethodTypes,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: (invoice as any).description || 'Invoice Payment' },
              unit_amount: Math.round(remaining * 100),
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Processing fee' },
              unit_amount: Math.round(fee * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/tenant/payments?payment=success`,
        cancel_url: `${baseUrl}/tenant/payments?payment=canceled`,
        metadata: {
          invoice_id: options.invoiceId,
          org_id: (invoice as any).org_id,
          tenant_id: (invoice as any).tenant_id || '',
        },
      }, {
        stripeAccount: (org as any).stripe_account_id,
      });

      // Store session ID and fee on invoice
      await db.from('invoices').update({
        stripe_checkout_session_id: session.id,
        convenience_fee: fee,
      }).eq('id', options.invoiceId);

      return { success: true, data: { url: session.url! } };
    }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create checkout session' };
  }
}

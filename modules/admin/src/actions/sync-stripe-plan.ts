'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { getStripe } from '@onereal/payments';
import type { ActionResult } from '@onereal/types';

export async function syncStripePlan(
  planId: string
): Promise<ActionResult<void>> {
  try {
    const db = createServiceRoleClient() as any;
    const stripe = getStripe();

    const { data: plan, error } = await db
      .from('plans')
      .select('id, name, slug, monthly_price, yearly_price, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id')
      .eq('id', planId)
      .single();

    if (error || !plan) return { success: false, error: 'Plan not found' };

    const monthlyPrice = Number((plan as any).monthly_price) || 0;
    const yearlyPrice = Number((plan as any).yearly_price) || 0;

    // Skip sync for free plans
    if (monthlyPrice === 0 && yearlyPrice === 0) return { success: true, data: undefined };

    // Create Stripe Product if needed
    let productId = (plan as any).stripe_product_id;
    if (!productId) {
      const product = await stripe.products.create({
        name: (plan as any).name,
        metadata: { plan_id: planId, slug: (plan as any).slug },
      });
      productId = product.id;
      await db.from('plans').update({ stripe_product_id: productId }).eq('id', planId);
    } else {
      // Update product name if changed
      await stripe.products.update(productId, { name: (plan as any).name });
    }

    // Sync monthly price
    if (monthlyPrice > 0) {
      const oldPriceId = (plan as any).stripe_monthly_price_id;
      if (oldPriceId) {
        await stripe.prices.update(oldPriceId, { active: false });
      }
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: Math.round(monthlyPrice * 100),
        currency: 'usd',
        recurring: { interval: 'month' },
      });
      await db.from('plans').update({ stripe_monthly_price_id: price.id }).eq('id', planId);
    }

    // Sync yearly price
    if (yearlyPrice > 0) {
      const oldPriceId = (plan as any).stripe_yearly_price_id;
      if (oldPriceId) {
        await stripe.prices.update(oldPriceId, { active: false });
      }
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: Math.round(yearlyPrice * 100),
        currency: 'usd',
        recurring: { interval: 'year' },
      });
      await db.from('plans').update({ stripe_yearly_price_id: price.id }).eq('id', planId);
    }

    return { success: true, data: undefined };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to sync plan to Stripe' };
  }
}

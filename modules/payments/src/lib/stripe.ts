import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeInstance = new Stripe(apiKey, { apiVersion: '2025-02-24.acacia' });
  }
  return stripeInstance;
}

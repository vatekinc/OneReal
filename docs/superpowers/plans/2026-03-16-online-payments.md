# Online Payments Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe Connect payment processing for plan subscriptions and tenant rent collection.

**Architecture:** New `modules/payments/` module with Stripe SDK, server actions for checkout/connect/portal, a webhook handler in `apps/web/app/api/stripe/webhook/route.ts`, and UI updates to settings, tenant payments, and admin pages. Single migration adds columns to `plans`, `organizations`, `invoices` and creates `payment_events` table.

**Tech Stack:** Stripe Connect (Standard accounts), Stripe Checkout, Next.js Route Handlers, Supabase (service role for webhooks), React Query hooks

---

## Files to Create (14)

| File | Purpose |
|------|---------|
| `supabase/migrations/20260316000001_online_payments.sql` | Migration: plan pricing cols, org Stripe cols, invoice status + cols, payment_events table |
| `modules/payments/package.json` | Module package with `stripe` dependency |
| `modules/payments/tsconfig.json` | TypeScript config extending root |
| `modules/payments/src/index.ts` | Public exports |
| `modules/payments/src/lib/stripe.ts` | Stripe client singleton (server-side only) |
| `modules/payments/src/lib/fees.ts` | Convenience fee calculation |
| `modules/payments/src/actions/create-checkout-session.ts` | Create Stripe Checkout for subscription or rent payment |
| `modules/payments/src/actions/create-connect-account.ts` | Create Connected Account + onboarding link |
| `modules/payments/src/actions/create-portal-session.ts` | Stripe Customer Portal for subscription management |
| `modules/payments/src/actions/get-connect-status.ts` | Query org's Stripe Connect status |
| `modules/payments/src/hooks/use-connect-status.ts` | React hook polling connect status |
| `modules/payments/src/hooks/use-subscription-status.ts` | React hook reading subscription status from org context |
| `modules/admin/src/actions/sync-stripe-plan.ts` | Sync plan pricing to Stripe Products/Prices |
| `apps/web/app/api/stripe/webhook/route.ts` | Stripe webhook endpoint |

## Files to Modify (8)

| File | Change |
|------|--------|
| `packages/types/src/models.ts` | Add Stripe/subscription fields to Organization, Plan, Invoice; add PaymentEvent type; add `'processing'` to Invoice status |
| `packages/database/src/types.ts` | Add payment_events table type, new org/plan/invoice columns |
| `modules/admin/src/actions/create-plan.ts` | Call syncStripePlan after creating paid plans |
| `modules/admin/src/actions/update-plan.ts` | Call syncStripePlan after updating plan prices |
| `apps/web/app/(admin)/admin/plans/page.tsx` | Add Monthly/Yearly Price inputs to CRUD form |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Add Billing info card |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add upgrade button, billing info, Stripe Connect section |
| `apps/web/app/(dashboard)/tenant/payments/page.tsx` | Add "Pay Now" button, processing badge, fee disclosure |

---

## Chunk 1: Foundation (Tasks 1-4)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260316000001_online_payments.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Online Payments: plan pricing, org Stripe fields, invoice updates, payment_events

-- 1. Plans table: add pricing and Stripe IDs
ALTER TABLE plans ADD COLUMN monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN stripe_product_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_monthly_price_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_yearly_price_id TEXT;

-- 2. Organizations table: add Stripe Connect + subscription fields
ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_status TEXT DEFAULT 'not_connected';
ALTER TABLE organizations ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT DEFAULT 'none';
ALTER TABLE organizations ADD COLUMN subscription_period TEXT;
ALTER TABLE organizations ADD COLUMN subscription_current_period_end TIMESTAMPTZ;

-- Add CHECK constraints
ALTER TABLE organizations ADD CONSTRAINT organizations_stripe_account_status_check
  CHECK (stripe_account_status IN ('not_connected', 'onboarding', 'active', 'restricted'));
ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing'));
ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_period_check
  CHECK (subscription_period IN ('monthly', 'yearly'));

-- 3. Invoices table: add Stripe tracking + update status constraint
ALTER TABLE invoices ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE invoices ADD COLUMN convenience_fee DECIMAL(10,2) DEFAULT 0;

-- Drop and recreate status check to include 'processing'
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'processing', 'partially_paid', 'paid', 'void'));

-- 4. Payment events table (webhook audit log)
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS on payment_events — accessed only via service role in webhook handler
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260316000001_online_payments.sql
git commit -m "feat: add online payments database migration"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `packages/types/src/models.ts`
- Modify: `packages/database/src/types.ts`

- [ ] **Step 1: Update models.ts — Add to Plan interface**

Find the existing `Plan` interface and add after `is_default`:

```typescript
  monthly_price: number;
  yearly_price: number;
  stripe_product_id: string | null;
  stripe_monthly_price_id: string | null;
  stripe_yearly_price_id: string | null;
```

Also add to `PlanListItem`:

```typescript
  monthly_price: number;
  yearly_price: number;
```

- [ ] **Step 2: Update models.ts — Add to Organization interface**

Find the existing `Organization` interface and add after `plan_id`:

```typescript
  stripe_customer_id: string | null;
  stripe_account_id: string | null;
  stripe_account_status: 'not_connected' | 'onboarding' | 'active' | 'restricted';
  stripe_subscription_id: string | null;
  subscription_status: 'none' | 'active' | 'past_due' | 'canceled' | 'trialing';
  subscription_period: 'monthly' | 'yearly' | null;
  subscription_current_period_end: string | null;
```

- [ ] **Step 3: Update models.ts — Update Invoice interface**

Find the existing `Invoice` interface. Add `'processing'` to the status union type. Add after existing fields:

```typescript
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  convenience_fee: number;
```

- [ ] **Step 4: Update models.ts — Add PaymentEvent interface**

Add after the existing Payment interface:

```typescript
export interface PaymentEvent {
  id: string;
  stripe_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}
```

- [ ] **Step 5: Update types.ts — Add payment_events table type and new columns**

In `packages/database/src/types.ts`, add the following. Use the existing `plans` table entry as a pattern reference for Row/Insert/Update/Relationships shape.

**Add to `plans` table Row type:**
```typescript
monthly_price: number;
yearly_price: number;
stripe_product_id: string | null;
stripe_monthly_price_id: string | null;
stripe_yearly_price_id: string | null;
```
Add same to Insert (all optional with defaults) and Update (all optional).

**Add to `organizations` table Row type:**
```typescript
stripe_customer_id: string | null;
stripe_account_id: string | null;
stripe_account_status: string;
stripe_subscription_id: string | null;
subscription_status: string;
subscription_period: string | null;
subscription_current_period_end: string | null;
```
Add same to Insert (all optional with defaults) and Update (all optional).

**Add to `invoices` table Row type:**
```typescript
stripe_checkout_session_id: string | null;
stripe_payment_intent_id: string | null;
convenience_fee: number;
```
Add same to Insert (optional) and Update (optional). Add `'processing'` to the status union wherever it appears.

**Add new `payment_events` table entry:**
```typescript
payment_events: {
  Row: {
    id: string;
    stripe_event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    processed_at: string | null;
    error: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    stripe_event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    processed_at?: string | null;
    error?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    stripe_event_id?: string;
    event_type?: string;
    payload?: Record<string, unknown>;
    processed_at?: string | null;
    error?: string | null;
    created_at?: string;
  };
  Relationships: [];
};
```

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/models.ts packages/database/src/types.ts
git commit -m "feat: add online payments type definitions"
```

---

### Task 3: Create Payments Module Scaffold

**Files:**
- Create: `modules/payments/package.json`
- Create: `modules/payments/tsconfig.json`
- Create: `modules/payments/src/lib/stripe.ts`
- Create: `modules/payments/src/lib/fees.ts`
- Create: `modules/payments/src/index.ts`

- [ ] **Step 1: Create package.json**

Model after existing `modules/billing/package.json`:

```json
{
  "name": "@onereal/payments",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./actions/*": "./src/actions/*.ts",
    "./hooks/*": "./src/hooks/*.ts"
  },
  "dependencies": {
    "stripe": "^17.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Model after `modules/billing/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create stripe.ts — Stripe client singleton**

```typescript
import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeInstance = new Stripe(apiKey, { apiVersion: '2025-04-30.basil' });
  }
  return stripeInstance;
}
```

- [ ] **Step 4: Create fees.ts — Convenience fee calculator**

```typescript
/**
 * Calculate convenience fee using card rate (2.9% + $0.30).
 * Applied universally regardless of payment method chosen at checkout.
 */
export function calculateConvenienceFee(amount: number): number {
  const fee = amount * 0.029 + 0.3;
  return Math.round(fee * 100) / 100;
}
```

- [ ] **Step 5: Create index.ts — Public exports (placeholder, will grow)**

```typescript
export { getStripe } from './lib/stripe';
export { calculateConvenienceFee } from './lib/fees';
```

- [ ] **Step 6: Install stripe dependency and update lockfile**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm install
```

- [ ] **Step 7: Commit**

```bash
git add modules/payments/ pnpm-lock.yaml
git commit -m "feat: scaffold payments module with Stripe client and fee calculator"
```

---

### Task 4: Payments Server Actions

**Files:**
- Create: `modules/payments/src/actions/create-checkout-session.ts`
- Create: `modules/payments/src/actions/create-connect-account.ts`
- Create: `modules/payments/src/actions/create-portal-session.ts`
- Create: `modules/payments/src/actions/get-connect-status.ts`
- Modify: `modules/payments/src/index.ts`

- [ ] **Step 1: Create create-checkout-session.ts**

Handles both subscription upgrades (mode: 'subscription') and rent payments (mode: 'payment'). For subscriptions, creates/fetches Stripe Customer, then creates Checkout Session with the plan's Stripe Price ID. For rent payments, creates Checkout Session with rent amount + convenience fee as line items, routed to the landlord's Connected Account.

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import { calculateConvenienceFee } from '../lib/fees';
import type { ActionResult } from '@onereal/types';

interface SubscriptionCheckoutOptions {
  type: 'subscription';
  planId: string;
  period: 'monthly' | 'yearly';
}

interface PaymentCheckoutOptions {
  type: 'payment';
  invoiceId: string;
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
        .select('id, amount, amount_paid, description, org_id, status')
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
      const fee = calculateConvenienceFee(remaining);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'us_bank_account', 'link'],
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
```

- [ ] **Step 2: Create create-connect-account.ts**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import type { ActionResult } from '@onereal/types';

export async function createConnectAccount(
  orgId: string
): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const stripe = getStripe();

    const { data: org } = await db
      .from('organizations')
      .select('stripe_account_id')
      .eq('id', orgId)
      .single();

    let accountId = (org as any)?.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'US',
        email: user.email || undefined,
        metadata: { org_id: orgId },
      });
      accountId = account.id;

      await db.from('organizations').update({
        stripe_account_id: accountId,
        stripe_account_status: 'onboarding',
      }).eq('id', orgId);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${baseUrl}/settings?stripe=refresh`,
      return_url: `${baseUrl}/settings?stripe=success`,
    });

    return { success: true, data: { url: link.url } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create connect account' };
  }
}
```

- [ ] **Step 3: Create create-portal-session.ts**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getStripe } from '../lib/stripe';
import type { ActionResult } from '@onereal/types';

export async function createPortalSession(
  orgId: string
): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const stripe = getStripe();

    const { data: org } = await db
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', orgId)
      .single();

    if (!(org as any)?.stripe_customer_id) {
      return { success: false, error: 'No subscription found' };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: (org as any).stripe_customer_id,
      return_url: `${baseUrl}/settings`,
    });

    return { success: true, data: { url: session.url } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create portal session' };
  }
}
```

- [ ] **Step 4: Create get-connect-status.ts**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface ConnectStatus {
  stripe_account_status: 'not_connected' | 'onboarding' | 'active' | 'restricted';
  stripe_account_id: string | null;
}

export async function getConnectStatus(
  orgId: string
): Promise<ActionResult<ConnectStatus>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: org } = await (supabase as any)
      .from('organizations')
      .select('stripe_account_id, stripe_account_status')
      .eq('id', orgId)
      .single();

    if (!org) return { success: false, error: 'Organization not found' };

    return {
      success: true,
      data: {
        stripe_account_status: (org as any).stripe_account_status || 'not_connected',
        stripe_account_id: (org as any).stripe_account_id || null,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to get connect status' };
  }
}
```

- [ ] **Step 5: Update index.ts — Add all exports**

```typescript
export { getStripe } from './lib/stripe';
export { calculateConvenienceFee } from './lib/fees';
export { createCheckoutSession } from './actions/create-checkout-session';
export { createConnectAccount } from './actions/create-connect-account';
export { createPortalSession } from './actions/create-portal-session';
export { getConnectStatus } from './actions/get-connect-status';
```

- [ ] **Step 6: Commit**

```bash
git add modules/payments/src/actions/ modules/payments/src/index.ts
git commit -m "feat: add payments server actions (checkout, connect, portal, status)"
```

---

## Chunk 2: Webhook & Hooks (Tasks 5-7)

### Task 5: Webhook Route Handler

**Files:**
- Create: `apps/web/app/api/stripe/webhook/route.ts`

This is the most critical file. It handles all Stripe events, creates payment/income records for rent payments, manages subscription lifecycle, and updates Connect account status. Uses service role client (no auth context in webhooks).

- [ ] **Step 1: Create the webhook route handler**

```typescript
import { createServiceRoleClient } from '@onereal/database/server';
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
  stripe: Stripe,
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/stripe/webhook/route.ts
git commit -m "feat: add Stripe webhook handler with idempotent event processing"
```

---

### Task 6: Connect Status Hook

**Files:**
- Create: `modules/payments/src/hooks/use-connect-status.ts`
- Modify: `modules/payments/src/index.ts`

- [ ] **Step 1: Create use-connect-status.ts**

Polls `getConnectStatus` every 2s for 10s after mount (handles race condition when returning from Stripe onboarding).

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { getConnectStatus } from '../actions/get-connect-status';

export function useConnectStatus(orgId: string | null, pollOnMount = false) {
  const [status, setStatus] = useState<'not_connected' | 'onboarding' | 'active' | 'restricted'>('not_connected');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const result = await getConnectStatus(orgId);
    if (result.success) {
      setStatus(result.data.stripe_account_status);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();

    if (pollOnMount) {
      const interval = setInterval(refresh, 2000);
      const timeout = setTimeout(() => clearInterval(interval), 10000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [refresh, pollOnMount]);

  return { status, loading, refresh };
}
```

- [ ] **Step 2: Create use-subscription-status.ts**

```typescript
'use client';

import { useUser } from '@onereal/auth';

export function useSubscriptionStatus() {
  const { activeOrg } = useUser();

  return {
    status: (activeOrg as any)?.subscription_status ?? 'none',
    period: (activeOrg as any)?.subscription_period ?? null,
    periodEnd: (activeOrg as any)?.subscription_current_period_end ?? null,
    isPaid: (activeOrg as any)?.subscription_status === 'active',
    isPastDue: (activeOrg as any)?.subscription_status === 'past_due',
  };
}
```

- [ ] **Step 3: Add hook exports to index.ts**

Add to `modules/payments/src/index.ts`:

```typescript
export { useConnectStatus } from './hooks/use-connect-status';
export { useSubscriptionStatus } from './hooks/use-subscription-status';
```

- [ ] **Step 4: Commit**

```bash
git add modules/payments/src/hooks/ modules/payments/src/index.ts
git commit -m "feat: add useConnectStatus and useSubscriptionStatus hooks"
```

---

### Task 7: Stripe Plan Sync Action

**Files:**
- Create: `modules/admin/src/actions/sync-stripe-plan.ts`
- Modify: `modules/admin/src/actions/create-plan.ts`
- Modify: `modules/admin/src/actions/update-plan.ts`

- [ ] **Step 1: Create sync-stripe-plan.ts**

Creates/updates Stripe Products and Prices to match plan pricing. Deactivates old prices when updating.

```typescript
'use server';

import { createServiceRoleClient } from '@onereal/database/server';
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
    if (monthlyPrice === 0 && yearlyPrice === 0) return { success: true };

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

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to sync plan to Stripe' };
  }
}
```

- [ ] **Step 2: Update create-plan.ts — Add Stripe sync after creation**

After the successful plan insert (after `if (error)` check, before the default-flip logic), add:

```typescript
    // Sync to Stripe if plan has pricing
    const mp = Number(parsed.data.monthly_price ?? 0);
    const yp = Number(parsed.data.yearly_price ?? 0);
    if (mp > 0 || yp > 0) {
      const { syncStripePlan } = await import('./sync-stripe-plan');
      await syncStripePlan((data as any).id);
    }
```

Also add `monthly_price` and `yearly_price` to the Zod schema for plan creation (or pass them through the insert).

- [ ] **Step 3: Update update-plan.ts — Add Stripe sync after update**

After the successful plan update, add:

```typescript
    // Re-sync to Stripe if pricing might have changed
    const { syncStripePlan } = await import('./sync-stripe-plan');
    await syncStripePlan(planId);
```

- [ ] **Step 4: Commit**

```bash
git add modules/admin/src/actions/sync-stripe-plan.ts modules/admin/src/actions/create-plan.ts modules/admin/src/actions/update-plan.ts
git commit -m "feat: add Stripe plan sync on create/update"
```

---

## Chunk 3: Admin UI Updates (Tasks 8-9)

### Task 8: Admin Plans Page — Add Price Fields

**Files:**
- Modify: `apps/web/app/(admin)/admin/plans/page.tsx`

- [ ] **Step 1: Add price state variables**

In the component, find the existing form state (e.g., `formName`, `formSlug`, etc.). Add:

```typescript
const [formMonthlyPrice, setFormMonthlyPrice] = useState('');
const [formYearlyPrice, setFormYearlyPrice] = useState('');
```

- [ ] **Step 2: Add price inputs to the dialog form**

After the existing form fields (max_properties, features checkboxes), add:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div>
    <Label>Monthly Price ($)</Label>
    <Input
      type="number"
      step="0.01"
      min="0"
      placeholder="0.00"
      value={formMonthlyPrice}
      onChange={(e) => setFormMonthlyPrice(e.target.value)}
    />
  </div>
  <div>
    <Label>Yearly Price ($)</Label>
    <Input
      type="number"
      step="0.01"
      min="0"
      placeholder="0.00"
      value={formYearlyPrice}
      onChange={(e) => setFormYearlyPrice(e.target.value)}
    />
  </div>
</div>
```

- [ ] **Step 3: Include prices in create/update payloads**

When calling `createPlan` or `updatePlan`, include:

```typescript
monthly_price: parseFloat(formMonthlyPrice) || 0,
yearly_price: parseFloat(formYearlyPrice) || 0,
```

- [ ] **Step 4: Populate prices when editing**

When opening the edit dialog, populate the form:

```typescript
setFormMonthlyPrice(String(plan.monthly_price ?? 0));
setFormYearlyPrice(String(plan.yearly_price ?? 0));
```

- [ ] **Step 5: Add price columns to the table**

Add "Monthly" and "Yearly" columns to the plans table displaying formatted prices:

```tsx
<TableHead>Monthly</TableHead>
<TableHead>Yearly</TableHead>
```

```tsx
<TableCell>${Number(p.monthly_price).toFixed(2)}</TableCell>
<TableCell>${Number(p.yearly_price).toFixed(2)}</TableCell>
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(admin)/admin/plans/page.tsx
git commit -m "feat: add pricing fields to admin plans CRUD"
```

---

### Task 9: Admin Org Detail — Add Billing Card

**Files:**
- Modify: `apps/web/app/(admin)/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Update getOrgDetails data usage to include Stripe fields**

The existing `org` object from `getOrgDetails` should now include the Stripe fields (since we updated types). If `get-org-details.ts` doesn't select them, update the select to include:

```
stripe_account_status, subscription_status, subscription_period, subscription_current_period_end
```

- [ ] **Step 2: Add Billing card between Plan card and Tabs**

```tsx
{/* Billing */}
<Card>
  <CardHeader className="flex flex-row items-center justify-between pb-2">
    <CardTitle className="text-sm font-medium">Billing</CardTitle>
  </CardHeader>
  <CardContent className="space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Subscription</span>
      <Badge variant={
        org.subscription_status === 'active' ? 'default'
        : org.subscription_status === 'past_due' ? 'destructive'
        : 'secondary'
      }>
        {org.subscription_status || 'none'}
      </Badge>
    </div>
    {org.subscription_period && (
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Period</span>
        <span className="text-sm">{org.subscription_period}</span>
      </div>
    )}
    {org.subscription_current_period_end && (
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Next Billing</span>
        <span className="text-sm">
          {new Date(org.subscription_current_period_end).toLocaleDateString()}
        </span>
      </div>
    )}
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Stripe Connect</span>
      <Badge variant={
        org.stripe_account_status === 'active' ? 'default'
        : org.stripe_account_status === 'restricted' ? 'destructive'
        : 'secondary'
      }>
        {org.stripe_account_status || 'not_connected'}
      </Badge>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Update get-org-details.ts if needed**

Ensure the org select in `modules/admin/src/actions/get-org-details.ts` includes the new Stripe/subscription columns, and maps them into the result.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(admin)/admin/organizations/[id]/page.tsx modules/admin/src/actions/get-org-details.ts
git commit -m "feat: add billing info card to admin org detail page"
```

---

## Chunk 4: Dashboard & Tenant UI (Tasks 10-12)

### Task 10: Settings Page — Subscription Upgrade + Stripe Connect

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

This is the most complex UI change. The existing settings page has a "Current Plan" card. We expand it with:
1. Upgrade flow (for Free plan orgs)
2. Subscription management (for Paid plan orgs)
3. Stripe Connect section (for Paid plan orgs)

- [ ] **Step 1: Add imports**

```typescript
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { createConnectAccount } from '@onereal/payments/actions/create-connect-account';
import { createPortalSession } from '@onereal/payments/actions/create-portal-session';
import { getConnectStatus } from '@onereal/payments/actions/get-connect-status';
import { useSearchParams } from 'next/navigation';
```

- [ ] **Step 2: Add subscription and connect state**

```typescript
const searchParams = useSearchParams();
const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
const [upgrading, setUpgrading] = useState(false);
const [connectStatus, setConnectStatus] = useState<'not_connected' | 'onboarding' | 'active' | 'restricted'>('not_connected');
const [connectLoading, setConnectLoading] = useState(false);
const [paidPlan, setPaidPlan] = useState<any>(null);
```

Also add a useEffect to fetch the available paid plan for upgrade pricing display:

```typescript
useEffect(() => {
  const supabase = createClient() as any;
  supabase
    .from('plans')
    .select('id, name, monthly_price, yearly_price')
    .neq('slug', 'free')
    .order('monthly_price', { ascending: true })
    .limit(1)
    .single()
    .then(({ data }: any) => setPaidPlan(data));
}, []);
```

- [ ] **Step 3: Add connect status polling in useEffect**

After the existing plan fetch useEffect, add polling for connect status (especially after Stripe redirect):

```typescript
useEffect(() => {
  if (!activeOrg) return;
  const fetchConnect = async () => {
    const result = await getConnectStatus(activeOrg.id);
    if (result.success) setConnectStatus(result.data.stripe_account_status);
  };
  fetchConnect();

  // Poll if returning from Stripe onboarding
  if (searchParams.get('stripe') === 'success') {
    const interval = setInterval(fetchConnect, 2000);
    const timeout = setTimeout(() => clearInterval(interval), 10000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }
}, [activeOrg, searchParams]);
```

- [ ] **Step 4: Add upgrade handler**

```typescript
async function handleUpgrade() {
  if (!activeOrg || !paidPlan) return;
  setUpgrading(true);

  const result = await createCheckoutSession(activeOrg.id, {
    type: 'subscription',
    planId: paidPlan.id,
    period: billingPeriod,
  });

  if (result.success) {
    window.location.href = result.data.url;
  } else {
    toast.error(result.error);
    setUpgrading(false);
  }
}
```

- [ ] **Step 5: Add manage subscription handler**

```typescript
async function handleManageSubscription() {
  if (!activeOrg) return;
  const result = await createPortalSession(activeOrg.id);
  if (result.success) {
    window.location.href = result.data.url;
  } else {
    toast.error(result.error);
  }
}
```

- [ ] **Step 6: Add connect Stripe handler**

```typescript
async function handleConnectStripe() {
  if (!activeOrg) return;
  setConnectLoading(true);
  const result = await createConnectAccount(activeOrg.id);
  if (result.success) {
    window.location.href = result.data.url;
  } else {
    toast.error(result.error);
    setConnectLoading(false);
  }
}
```

- [ ] **Step 7: Update the Current Plan card JSX**

Replace the existing plan card content. Show upgrade UI for free plans, subscription management for paid plans:

```tsx
{plan && (
  <Card>
    <CardHeader><CardTitle>Current Plan</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">{plan.name}</span>
        <Badge variant="secondary">{plan.slug}</Badge>
      </div>

      {/* Plan details */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          Properties: {propertyCount}{' '}
          {plan.max_properties > 0 ? `of ${plan.max_properties}` : '(Unlimited)'}
        </p>
        <p>Online Payments: {plan.features?.online_payments ? 'Enabled' : 'Not included'}</p>
        <p>Messaging: {plan.features?.messaging ? 'Enabled' : 'Not included'}</p>
      </div>

      {/* Subscription status for paid plans */}
      {activeOrg.subscription_status === 'active' && activeOrg.subscription_current_period_end && (
        <div className="text-sm text-muted-foreground">
          <p>Billing: {activeOrg.subscription_period} &middot; Next billing: {new Date(activeOrg.subscription_current_period_end).toLocaleDateString()}</p>
        </div>
      )}

      {activeOrg.subscription_status === 'past_due' && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          Your subscription payment failed. Please update your payment method.
        </div>
      )}

      {/* Actions */}
      {(plan.slug === 'free' || activeOrg.subscription_status === 'none') && paidPlan ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBillingPeriod('monthly')}
            >
              Monthly (${Number(paidPlan.monthly_price).toFixed(2)}/mo)
            </Button>
            {Number(paidPlan.yearly_price) > 0 && (
              <Button
                variant={billingPeriod === 'yearly' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly (${Number(paidPlan.yearly_price).toFixed(2)}/yr)
              </Button>
            )}
          </div>
          <Button onClick={handleUpgrade} disabled={upgrading}>
            {upgrading ? 'Redirecting...' : `Upgrade to ${paidPlan.name}`}
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={handleManageSubscription}>
          Manage Subscription
        </Button>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 8: Add Stripe Connect card (after plan card, only for paid plans)**

```tsx
{plan?.features?.online_payments && (
  <Card>
    <CardHeader><CardTitle>Online Payments</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect your Stripe account to accept online rent payments from tenants.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Status:</span>
        <Badge variant={
          connectStatus === 'active' ? 'default'
          : connectStatus === 'restricted' ? 'destructive'
          : 'secondary'
        }>
          {connectStatus === 'not_connected' ? 'Not Connected'
          : connectStatus === 'onboarding' ? 'Setup Incomplete'
          : connectStatus === 'active' ? 'Connected'
          : 'Restricted'}
        </Badge>
      </div>
      {connectStatus !== 'active' && (
        <Button
          onClick={handleConnectStripe}
          disabled={connectLoading}
        >
          {connectStatus === 'not_connected'
            ? 'Connect Stripe Account'
            : connectStatus === 'onboarding'
            ? 'Complete Stripe Setup'
            : 'Update Stripe Account'}
        </Button>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 9: Add dashboard banners**

At the top of the settings page JSX (before the General card), add conditional banners:

```tsx
{/* Past due warning */}
{activeOrg.subscription_status === 'past_due' && (
  <div className="rounded-md border border-destructive bg-destructive/10 p-4">
    <p className="text-sm font-medium text-destructive">
      Your subscription payment failed. Please update your payment method to avoid losing access.
    </p>
    <Button size="sm" variant="destructive" className="mt-2" onClick={handleManageSubscription}>
      Update Payment Method
    </Button>
  </div>
)}

{/* Connect Stripe reminder */}
{plan?.features?.online_payments && connectStatus === 'not_connected' && activeOrg.subscription_status === 'active' && (
  <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
    <p className="text-sm text-muted-foreground">
      Connect your Stripe account to start accepting online rent payments from tenants.
    </p>
    <Button size="sm" variant="outline" className="mt-2" onClick={handleConnectStripe}>
      Connect Stripe Account
    </Button>
  </div>
)}
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/(dashboard)/settings/page.tsx
git commit -m "feat: add subscription upgrade and Stripe Connect to settings page"
```

---

### Task 11: Tenant Payments Page — Add "Pay Now" Button

**Files:**
- Modify: `apps/web/app/(dashboard)/tenant/payments/page.tsx`

- [ ] **Step 1: Read the existing file to understand current structure**

Check imports, component structure, how invoices are listed, existing hooks used.

- [ ] **Step 2: Add imports**

```typescript
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { getConnectStatus } from '@onereal/payments/actions/get-connect-status';
import { calculateConvenienceFee } from '@onereal/payments';
import { useSearchParams } from 'next/navigation';
```

- [ ] **Step 3: Add state for online payment availability**

```typescript
const searchParams = useSearchParams();
const [onlinePayEnabled, setOnlinePayEnabled] = useState(false);
const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
```

- [ ] **Step 4: Add effect to check if online payments are available**

This checks both the plan feature flag AND the org's Stripe Connect status:

```typescript
useEffect(() => {
  if (!lease) return;
  const checkOnline = async () => {
    const supabase = createClient() as any;
    const { data: org } = await supabase
      .from('organizations')
      .select('plan_id, plans(features), stripe_account_status')
      .eq('id', lease.org_id)
      .single();

    const features = (org as any)?.plans?.features;
    const connected = (org as any)?.stripe_account_status === 'active';
    setOnlinePayEnabled(features?.online_payments === true && connected);
  };
  checkOnline();
}, [lease]);
```

- [ ] **Step 5: Add pay handler**

```typescript
async function handlePayOnline(invoiceId: string) {
  setPayingInvoiceId(invoiceId);
  const result = await createCheckoutSession(lease!.org_id, {
    type: 'payment',
    invoiceId,
  });
  if (result.success) {
    window.location.href = result.data.url;
  } else {
    toast.error(result.error);
    setPayingInvoiceId(null);
  }
}
```

- [ ] **Step 6: Add "Pay Now" button and processing badge to invoice rows**

For each invoice in the list, add conditionally:

```tsx
{/* Status badge */}
{invoice.status === 'processing' ? (
  <Badge variant="secondary">Processing</Badge>
) : (
  <Badge variant={invoice.status === 'paid' ? 'default' : 'outline'}>
    {invoice.status}
  </Badge>
)}

{/* Pay Now button */}
{onlinePayEnabled && ['open', 'partially_paid'].includes(invoice.status) && (
  <Button
    size="sm"
    onClick={() => handlePayOnline(invoice.id)}
    disabled={payingInvoiceId === invoice.id}
  >
    {payingInvoiceId === invoice.id ? 'Redirecting...' : 'Pay Now'}
  </Button>
)}
```

- [ ] **Step 7: Add success/error toast on redirect back**

At the top of the component, after state declarations:

```typescript
useEffect(() => {
  if (searchParams.get('payment') === 'success') {
    toast.success('Payment submitted successfully!');
  } else if (searchParams.get('payment') === 'canceled') {
    toast.info('Payment was canceled.');
  }
}, [searchParams]);
```

- [ ] **Step 8: Add convenience fee disclosure**

Below the invoice table/list:

```tsx
{onlinePayEnabled && (
  <p className="text-xs text-muted-foreground mt-2">
    A processing fee (2.9% + $0.30) will be added at checkout.
  </p>
)}
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/(dashboard)/tenant/payments/page.tsx
git commit -m "feat: add Pay Now button to tenant payments page"
```

---

## Chunk 5: Build & Verify (Task 12)

### Task 12: Build Verification

- [ ] **Step 1: Install dependencies**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm install
```

- [ ] **Step 2: Build**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm build
```

Expected: All routes compile. New routes include `/api/stripe/webhook`. No TypeScript errors.

- [ ] **Step 3: Fix any build errors**

If there are import path issues, missing exports, or type errors, fix them.

- [ ] **Step 4: Apply migration to Supabase**

```bash
cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && npx supabase db push
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build issues for online payments module"
```

---

## Environment Setup Notes

Before testing, ensure these environment variables are set in `.env.local`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For local webhook testing, use Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The CLI will output a `whsec_...` value — use it as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

---

## Verification Checklist

1. Build passes with zero errors
2. `/admin/plans` — pricing fields visible, create/edit includes prices
3. `/admin/organizations/[id]` — Billing card shows subscription + connect status
4. `/settings` — Free plan shows Upgrade button with period toggle
5. `/settings` — After upgrade, shows Manage Subscription + Stripe Connect section
6. `/settings?stripe=success` — Connect status polls and updates
7. `/tenant/payments` — "Pay Now" button visible when org has online payments enabled + connected
8. `/tenant/payments` — Processing badge shown for ACH-pending invoices
9. `/api/stripe/webhook` — Returns 200 for valid events, 400 for invalid signatures
10. `payment_events` table logs all webhook events with idempotency

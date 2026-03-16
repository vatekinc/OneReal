# Online Payments Module — Design Spec

## Goal

Add online payment processing to OneReal via Stripe Connect. Two payment flows: (1) organizations pay recurring subscription fees for their plan, and (2) tenants pay rent and invoices online to their landlord's connected Stripe account.

## Architecture

OneReal registers as a Stripe Connect platform. Each landlord org becomes a Standard Connected Account via Stripe-hosted onboarding. Subscriptions use Stripe Subscriptions (auto-recurring). Rent payments use Stripe Checkout Sessions (one-time, routed to the connected account). A single webhook endpoint handles all Stripe events idempotently via a `payment_events` audit table.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Processor | Stripe Connect (Standard accounts) |
| Subscription billing | Recurring auto-charge via Stripe Subscriptions |
| Rent payment trigger | Tenant clicks "Pay Now" from portal (no auto-pay in v1) |
| Payment methods | Card + ACH bank transfer + Apple Pay / Google Pay |
| Fee bearer | Tenant pays convenience fee (processing fee as separate line item) |
| Platform fee on rent | None for now — revenue from subscriptions only |
| Landlord onboarding | Stripe-hosted onboarding (redirect flow) |
| Plan pricing | Admin-configurable (monthly_price, yearly_price in DB), synced to Stripe Products/Prices |
| ACH pending state | New `processing` invoice status; confirmed on `payment_intent.succeeded` |
| Admin override | Admin can assign plans without requiring payment |

## Out of Scope (v1)

- Auto-pay / saved payment methods for tenants
- Refunds
- Platform fee on rent payments
- PDF invoice generation / email receipts
- Email notifications for payment events
- Multi-currency support

---

## 1. Database Schema Changes

### 1.1 Plans table — add pricing columns

```sql
ALTER TABLE plans ADD COLUMN monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN stripe_product_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_monthly_price_id TEXT;
ALTER TABLE plans ADD COLUMN stripe_yearly_price_id TEXT;
```

- Free plan: `monthly_price=0, yearly_price=0` (no Stripe product needed)
- Paid plan: e.g., `monthly_price=29.00, yearly_price=290.00`
- When admin saves a plan with `price > 0`, a server action syncs to Stripe Products/Prices

### 1.2 Organizations table — add Stripe columns

```sql
ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_account_status TEXT DEFAULT 'not_connected'
  CHECK (stripe_account_status IN ('not_connected', 'onboarding', 'active', 'restricted'));
ALTER TABLE organizations ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT DEFAULT 'none'
  CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing'));
ALTER TABLE organizations ADD COLUMN subscription_period TEXT
  CHECK (subscription_period IN ('monthly', 'yearly'));
ALTER TABLE organizations ADD COLUMN subscription_current_period_end TIMESTAMPTZ;
```

- `stripe_customer_id` — Stripe Customer for subscription billing (org owner)
- `stripe_account_id` — Connected Account for receiving rent payments
- `stripe_account_status` — tracks onboarding progress
- Subscription fields track the org's plan payment status

### 1.3 Invoices table — add payment tracking columns

```sql
ALTER TABLE invoices ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE invoices ADD COLUMN convenience_fee DECIMAL(10,2) DEFAULT 0;
```

Update the status CHECK constraint to include `'processing'`:

```sql
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'processing', 'partially_paid', 'paid', 'void'));
```

### 1.4 New table: `payment_events`

```sql
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

- Provides idempotent webhook processing (UNIQUE on `stripe_event_id`)
- Audit trail for all Stripe events
- No RLS — accessed only via service role client in webhook handler

---

## 2. Stripe Connect Account Model

### 2.1 Entities and roles

| Entity | Stripe Role | Purpose |
|--------|-------------|---------|
| OneReal platform | Platform account | Owns the Stripe Connect platform. Collects subscription fees directly. |
| Org owner | Stripe Customer | Attached to org via `stripe_customer_id`. Card on file for subscription billing. |
| Landlord org | Connected Account (Standard) | Receives rent payments. Onboarded via Stripe-hosted flow for KYC/bank details. |
| Tenant | Ephemeral | Pays via Stripe Checkout. No stored payment methods in v1. |

### 2.2 Landlord onboarding flow

```
Org Settings → "Connect Stripe Account" button
  → Server: stripe.accounts.create({ type: 'standard' })
  → Server: stripe.accountLinks.create({ account, type: 'account_onboarding', ... })
  → Store stripe_account_id on org, set status = 'onboarding'
  → Redirect user to Stripe-hosted onboarding
  → Stripe redirects back to /settings?stripe=success
  → Webhook: account.updated → update stripe_account_status to 'active'
```

- If org is on Free plan, "Connect Stripe" button is disabled: "Upgrade to Paid plan to accept online payments"
- Status transitions: `not_connected → onboarding → active`
- If Stripe requires additional info later: `active → restricted` (via webhook)
- **Return URL race condition**: When Stripe redirects back to `/settings?stripe=success`, the `account.updated` webhook may not have fired yet. The settings page should poll `getConnectStatus()` every 2 seconds for up to 10 seconds after redirect, then show the current status. This avoids the user seeing stale "onboarding" status.

### 2.3 Feature gate integration

The existing `online_payments` feature flag in `plans.features` controls all payment UI:
- **Free plan** (`online_payments: false`): No Stripe Connect button, no "Pay Now" for tenants
- **Paid plan** (`online_payments: true`): Full payment functionality enabled

---

## 3. Subscription Payment Flow

### 3.1 Upgrade flow

```
Org owner → /settings → "Current Plan" card → clicks "Upgrade to Paid"
  → Chooses billing period: Monthly ($X/mo) or Yearly ($X/yr)
  → Server: create Stripe Customer (if none) using org owner's email
  → Server: stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripe_customer_id,
      line_items: [{ price: stripe_monthly_price_id or stripe_yearly_price_id, quantity: 1 }],
      success_url: '/settings?subscription=success',
      cancel_url: '/settings?subscription=canceled',
      metadata: { org_id }
    })
  → Redirect to Stripe Checkout
  → User enters payment details, submits
  → Stripe redirects back to success_url
  → Webhook: checkout.session.completed (mode=subscription) triggers:
    - Set org plan_id to paid plan
    - Set subscription_status = 'active'
    - Store stripe_subscription_id
    - Store subscription_current_period_end
```

### 3.2 Plan management

| Action | Behavior |
|--------|----------|
| **Upgrade (Free → Paid)** | Stripe Checkout → new subscription created |
| **Change period (monthly ↔ yearly)** | Stripe Subscription update via Customer Portal, prorated |
| **Downgrade (Paid → Free)** | Cancel subscription at period end. Features stay active until period ends. Stripe fires `customer.subscription.deleted` when the period actually ends → webhook reverts org to Free plan. |
| **Past due** | Stripe retries 3x over ~2 weeks. `subscription_status = 'past_due'`. If all retries fail → `canceled` → revert to Free plan. |
| **Manage card / cancel** | "Manage Subscription" button → Stripe Customer Portal |

### 3.3 Admin override

Admin can change an org's plan from `/admin/organizations/[id]` without payment. The `subscription_status` stays `'none'` for admin-assigned plans — only self-service upgrades create Stripe subscriptions.

---

## 4. Tenant Rent Payment Flow

### 4.1 Payment flow

```
Tenant → /tenant/payments → sees open/partially_paid invoices
  → Clicks "Pay Now" on an invoice
  → Server: stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'us_bank_account', 'link'],
      line_items: [
        { name: 'Rent for [unit] — [month]', amount: remaining_balance },
        { name: 'Processing fee', amount: convenience_fee }
      ],
      stripe_account: org's stripe_account_id (Connected Account),
      success_url: '/tenant/payments?payment=success',
      cancel_url: '/tenant/payments?payment=canceled',
      metadata: { invoice_id, org_id, tenant_id }
    })
  → Redirect to Stripe Checkout
  → Tenant pays with card, ACH, or digital wallet
  → Stripe redirects back
  → Webhook processes payment (see 4.3)
```

### 4.2 Convenience fee

Use a single flat convenience fee rate (card rate: 2.9% + $0.30) regardless of payment method chosen. This avoids the problem that Stripe Checkout lets users choose their payment method on the page — we don't know which method they'll pick at session creation time. Using the card rate as the universal fee keeps implementation simple and ensures costs are always covered. If the tenant uses ACH (lower Stripe fee), the landlord keeps the small difference.

Fee is disclosed as a separate line item on Stripe Checkout:

```
Rent for Unit 4B — March 2026    $1,500.00
Processing fee                       $43.80  (2.9% + $0.30)
─────────────────────────────────────────────
Total                             $1,543.80
```

- Fee formula: `(rent_amount * 0.029) + 0.30`, rounded to 2 decimal places
- Calculated at checkout session creation time using remaining balance
- Stored on `invoices.convenience_fee`
- Landlord receives full rent amount; tenant pays rent + fee

### 4.3 Webhook processing for rent payments

The webhook handler creates payment and income records directly using the service role client (bypassing RLS). It does NOT reuse the existing `recordPayment()` server action from `modules/billing/` because that action calls `supabase.auth.getUser()` which is unavailable in a webhook context (no authenticated user session). Instead, the webhook handler in `apps/web/app/api/stripe/webhook/route.ts` performs the same three writes inline using `createServiceRoleClient()`:

1. Insert `payments` row (method: `'online'`, reference: payment intent ID)
2. Insert `income` row (for landlord accounting)
3. Update `invoice.amount_paid` and status

These three writes should be performed sequentially with error handling — if any fails, the error is logged to `payment_events.error`. Since the handler is idempotent (checks `payment_events` for duplicates), Stripe will retry delivery and the handler will re-attempt on next delivery.

**Card payments (instant):**
1. `checkout.session.completed` fires
2. Create `payments` row, `income` row, update invoice (as above)
3. Set invoice status to `paid` or `partially_paid`
4. Store `stripe_payment_intent_id` and `stripe_checkout_session_id`

**ACH payments (3-5 day settlement):**
1. `checkout.session.completed` fires → set invoice status to `processing`, store checkout session ID
2. `payment_intent.succeeded` fires when funds clear → create payment/income records, mark `paid`
3. `payment_intent.payment_failed` fires if ACH fails → revert invoice to `open`

### 4.4 Partial payments

- "Pay Now" charges remaining balance: `invoice.amount - invoice.amount_paid` + convenience fee
- After payment, invoice status becomes `paid` (if fully covered) or `partially_paid`

### 4.5 Visibility guards

"Pay Now" button only appears when ALL conditions are met:
- Org's plan has `online_payments: true`
- Org's `stripe_account_status = 'active'`
- Invoice status is `open` or `partially_paid`

---

## 5. Webhook Handler

### 5.1 Single endpoint

`POST /api/stripe/webhook` — handles all Stripe events.

### 5.2 Processing flow

```
→ Read raw body (required for signature verification)
→ Verify signature via stripe.webhooks.constructEvent(body, sig, secret)
→ Check payment_events for duplicate stripe_event_id → return 200 if exists
→ Insert into payment_events (unprocessed)
→ Route by event.type:
   ├─ checkout.session.completed (mode=subscription) → activate subscription
   ├─ checkout.session.completed (mode=payment) → process rent payment
   ├─ invoice.paid → extend subscription period
   ├─ invoice.payment_failed → mark subscription past_due
   ├─ customer.subscription.deleted → revert to Free plan
   ├─ customer.subscription.updated → sync period/plan changes
   ├─ payment_intent.succeeded → confirm ACH rent payment
   ├─ payment_intent.payment_failed → revert invoice to open
   ├─ account.updated → update stripe_account_status
   └─ (unknown) → log and skip
→ Update payment_event.processed_at (or error if failed)
→ Return 200
```

### 5.3 Idempotency

- `payment_events.stripe_event_id` UNIQUE constraint prevents double-processing
- Handler checks for existing event before processing
- Always returns 200 to Stripe (even on processing errors) to prevent infinite retries — errors are logged in `payment_events.error` for investigation

---

## 6. API Routes & Server Actions

### 6.1 Next.js Route Handlers

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stripe/webhook` | POST | Stripe webhook (raw body, signature verification) |

The webhook MUST be a Route Handler because Stripe sends raw POST with signature headers.

### 6.2 Server Actions (modules/payments/)

| Action | Purpose |
|--------|---------|
| `createCheckoutSession(orgId, type, options)` | Create Stripe Checkout for subscription or rent payment |
| `createConnectAccount(orgId)` | Create Connected Account + return onboarding URL |
| `createPortalSession(orgId)` | Create Stripe Customer Portal session URL |
| `getConnectStatus(orgId)` | Return org's Stripe Connect status |

### 6.3 Server Actions (modules/admin/)

| Action | Purpose |
|--------|---------|
| `syncStripePlan(planId)` | Sync plan to Stripe Product/Prices when admin creates/updates plan |

### 6.4 Environment Variables

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

---

## 7. UI Changes

### 7.1 Org Settings Page (`/settings`)

**Free plan orgs:**
- Current plan info (existing)
- Period toggle: Monthly ($X/mo) / Yearly ($X/yr)
- "Upgrade to Paid" button → Stripe Checkout
- Stripe Connect section hidden

**Paid plan orgs (active subscription):**
- Plan info + billing period + next billing date
- "Manage Subscription" button → Stripe Customer Portal
- Stripe Connect section:
  - `not_connected`: "Connect Stripe Account" button + explanation
  - `onboarding`: "Complete Stripe Setup" button
  - `active`: Green "Stripe Connected" badge
  - `restricted`: Warning badge + "Update Stripe Account" button

### 7.2 Admin Plans Page (`/admin/plans`)

Add to existing CRUD form:
- Monthly Price input ($)
- Yearly Price input ($)
- Stripe sync indicator (shows if Product/Prices exist)
- Saving plan with price > 0 triggers auto-sync to Stripe

### 7.3 Admin Org Detail Page (`/admin/organizations/[id]`)

New "Billing" section:
- Subscription status, period, next billing date
- Stripe Connect account status
- Read-only (admin manages plan assignment, not Stripe billing)

### 7.4 Tenant Payments Page (`/tenant/payments`)

Add to existing invoice list:
- "Pay Now" button on `open` / `partially_paid` invoices (guarded by feature + connect status)
- "Processing" badge on `processing` invoices (no pay button)
- Convenience fee disclosure text
- Success/error state after Stripe redirect

### 7.5 Dashboard Banners

- Paid plan + Stripe not connected: "Connect your Stripe account to accept online payments from tenants"
- Subscription `past_due`: "Your subscription payment failed. Update your payment method."

---

## 8. Module Structure

### 8.1 New module: `modules/payments/`

This module handles all Stripe-specific logic (checkout sessions, Connect accounts, subscriptions). The existing `modules/billing/` continues to own manual invoice creation, invoice generation, and manual payment recording. The boundary: `billing` = internal invoice/payment CRUD, `payments` = Stripe integration layer.

```
modules/payments/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── lib/
    │   ├── stripe.ts                     # Stripe client singleton (server-side)
    │   └── fees.ts                       # Convenience fee calculation
    ├── actions/
    │   ├── create-checkout-session.ts
    │   ├── create-connect-account.ts
    │   ├── create-portal-session.ts
    │   └── get-connect-status.ts
    └── hooks/
        ├── use-connect-status.ts
        └── use-subscription-status.ts
```

### 8.2 API routes in `apps/web/`

```
apps/web/app/api/stripe/
└── webhook/route.ts
```

### 8.3 Dependencies

- `stripe` npm package (v17.x) — installed in `modules/payments/` and `apps/web/`

### 8.4 Files to modify

| File | Change |
|------|--------|
| `packages/types/src/models.ts` | Add subscription/connect fields to Organization, PaymentEvent type, add `'processing'` to Invoice status union |
| `packages/database/src/types.ts` | Add payment_events table, new org columns, invoice status |
| `modules/admin/src/actions/create-plan.ts` | Add Stripe Product/Price sync on create |
| `modules/admin/src/actions/update-plan.ts` | Sync price changes to Stripe |
| `apps/web/app/(dashboard)/settings/page.tsx` | Upgrade button, billing info, Stripe Connect section |
| `apps/web/app/(dashboard)/tenant/payments/page.tsx` | "Pay Now" button, processing status |
| `apps/web/app/(admin)/admin/plans/page.tsx` | Price fields in CRUD form |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Billing info section |

---

## 9. Security

### 9.1 Webhook security

- Signature verification via `stripe.webhooks.constructEvent()` on every request
- Raw body required (not JSON-parsed) for signature to match
- Invalid signatures rejected with 400

### 9.2 Authorization

| Action | Required role |
|--------|---------------|
| Upgrade subscription | Org admin |
| Connect Stripe account | Org admin |
| Pay invoice (tenant) | Tenant with active lease linked to invoice |
| Manage plan pricing | Platform admin (`is_platform_admin`) |
| Override org plan | Platform admin |

### 9.3 Data security

- No card numbers or bank details stored — Stripe handles all PCI-sensitive data
- Stripe IDs (`stripe_customer_id`, `stripe_account_id`, etc.) are safe to store
- `payment_events.payload` contains Stripe event data (no raw card numbers)
- All Stripe API calls are server-side only (secret key never exposed to client)
- `STRIPE_SECRET_KEY` stored in `.env.local` (dev) and Azure Key Vault (production)

### 9.4 RLS

- `payment_events`: No client access. Service role only in webhook handler.
- New org columns: Readable by org members via existing org RLS. Written only by server actions.

### 9.5 Error handling

| Scenario | Handling |
|----------|----------|
| Checkout abandoned | No state change. Invoice stays open. |
| Subscription payment fails | Stripe retries 3x. `past_due` status. All fail → `canceled` → revert to Free. |
| ACH returned/failed | Invoice reverts from `processing` to `open`. Tenant can retry. |
| Connect account restricted | Webhook updates status. "Pay Now" hidden. Banner shown to landlord. |
| Webhook delivery fails | Stripe retries up to 3 days. Idempotent handler is safe for late delivery. |
| Double-click "Pay Now" | New session per click, but webhook checks if invoice already paid. |

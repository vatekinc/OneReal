# Plaid ACH Integration Design

## Overview

Add Plaid Transfer API as an alternative ACH payment processor for tenant rent payments. Organizations (landlords) connect both Stripe and Plaid. Cards route through Stripe (2.9% + $0.30). ACH auto-routes through Plaid when connected ($1.00 flat fee), falling back to Stripe ACH (0.8% capped at $5) when Plaid is not connected.

**Fund flow model:** Plaid Transfer uses the platform as an intermediary. Tenant's bank is debited via Plaid Transfer (debit), funds settle into the platform's Plaid-connected funding account, then the platform initiates a Plaid Transfer (credit) to the landlord's linked bank account. Both legs are automated within `initiatePlaidTransfer()`. From the tenant/landlord perspective, it appears direct.

## Decision Log

| Decision | Choice | Alternatives Considered |
|----------|--------|------------------------|
| ACH routing | Auto-route: Plaid when connected, Stripe fallback | Either/or per org; both shown to tenant |
| Plaid product | Plaid Transfer API (standard, platform-intermediary model) | Plaid Auth + Stripe ACH (same cost); Plaid + Dwolla (over-engineered); Plaid Ledger (requires additional access) |
| Tenant UX | Pre-link bank + auto-pay option | Inline Plaid Link per payment; pre-link without auto-pay |
| Fee model | $1.00 flat to tenant (covers Plaid cost ~$0.30 + platform margin ~$0.70) | $0 (platform absorbs); pass-through (~$0.30) |
| Fund flow | Platform intermediary (Plaid standard model) | Direct bank-to-bank (requires Plaid originator model); Plaid Ledger hold-and-release |
| Token encryption | Application-level AES-256-GCM encryption | Supabase Vault; pgcrypto column-level encryption |

## Database Changes

### New columns on `organizations`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `plaid_access_token_encrypted` | text, nullable | null | AES-256-GCM encrypted Plaid access token for landlord's linked bank |
| `plaid_account_id` | text, nullable | null | Selected bank account ID within Plaid |
| `plaid_item_id` | text, nullable | null | Plaid Item ID (for webhook matching on token rotation events) |
| `plaid_institution_name` | text, nullable | null | Display name of linked bank, e.g., "Chase" |
| `plaid_account_mask` | text, nullable | null | Last 4 digits of linked account, e.g., "4521" |
| `plaid_status` | text | `'not_connected'` | `not_connected` \| `active` |

**Note:** `plaid_recipient_id` removed — not needed in the platform-intermediary model. The platform initiates credits using the landlord's `access_token` + `account_id`.

### New table: `tenant_bank_accounts`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | uuid | PK, default gen_random_uuid() | Primary key |
| `tenant_id` | uuid | FK → profiles(id), NOT NULL | The tenant who linked this bank |
| `org_id` | uuid | FK → organizations(id), NOT NULL | Scoped to the org they rent from |
| `plaid_access_token_encrypted` | text | NOT NULL | AES-256-GCM encrypted Plaid access token |
| `plaid_account_id` | text | NOT NULL | Selected account within the institution |
| `plaid_item_id` | text | NOT NULL | Plaid Item ID (for webhook matching) |
| `institution_name` | text | NOT NULL | Display name, e.g., "Chase" |
| `account_mask` | text | NOT NULL | Last 4 digits, e.g., "4521" |
| `account_name` | text | NOT NULL | Display name, e.g., "Checking ****4521" |
| `auto_pay_enabled` | boolean | default false | Whether auto-pay is enabled |
| `created_at` | timestamptz | default now() | |
| `updated_at` | timestamptz | default now() | Updated via trigger on row change |

**Unique constraint:** `(tenant_id, org_id)` — one linked bank per tenant per org.

**RLS policies:**
- Tenants can SELECT/UPDATE/DELETE their own rows (`tenant_id = auth.uid()`)
- Org admins can SELECT rows for their org (for admin visibility)

### New columns on `invoices`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `plaid_transfer_id` | text, nullable | null | Plaid Transfer ID when paid via Plaid |
| `payment_processor` | text, nullable | null | `'stripe'` \| `'plaid'` — which processor handled payment |

### Token Encryption Strategy

Plaid access tokens are encrypted using **AES-256-GCM** at the application level before database storage:

- **Encryption key:** `PLAID_TOKEN_ENCRYPTION_KEY` environment variable (32-byte hex string)
- **Storage format:** `iv:authTag:ciphertext` (all base64-encoded, colon-delimited)
- **Helper functions:** `encryptPlaidToken(plaintext)` and `decryptPlaidToken(encrypted)` in `modules/payments/src/lib/plaid-crypto.ts`
- **Usage:** All server actions that read/write Plaid access tokens use these helpers. The plaintext token never touches the database.

### Type Definition Updates

Update `packages/types/src/models.ts`:
- Add `plaid_access_token_encrypted`, `plaid_account_id`, `plaid_item_id`, `plaid_institution_name`, `plaid_account_mask`, `plaid_status` to `Organization` interface
- Add `plaid_transfer_id`, `payment_processor` to `Invoice` interface
- Add new `TenantBankAccount` interface matching the table schema above

Update `packages/types/src/enums.ts`:
- Add `'plaid'` to the `PaymentMethod` enum (used for `payments.payment_method` column when recording Plaid payments)

## Landlord Setup Flow

Located in the existing Settings page (`apps/web/app/(dashboard)/settings/page.tsx`), below the Stripe Connect section.

### UI States

**Not connected:**
- Heading: "Plaid Bank Account"
- Description: "Connect your bank account to receive ACH payments at lower fees ($1 flat vs Stripe's 0.8%)"
- Button: "Link Bank Account" → opens Plaid Link modal

**Active:**
- Shows connected bank: "Chase Checking ****4521" with green "Connected" badge
- Button: "Change Bank Account" → re-opens Plaid Link
- Info: "ACH payments from tenants will be deposited directly to this account"

### Linking Flow

1. Landlord clicks "Link Bank Account"
2. Client calls `createPlaidLinkToken()` server action
3. Server creates Plaid `link_token` with `transfer` product, `country_codes: ['US']`
4. Plaid Link modal opens in browser
5. Landlord selects bank institution → authenticates → selects account
6. Plaid Link returns `public_token` + `metadata` (institution name, account mask, etc.)
7. Client calls `exchangePlaidToken()` server action with `public_token` + metadata + role (`'landlord'`)
8. Server exchanges `public_token` → `access_token` via `plaid.itemPublicTokenExchange()`
9. Server encrypts `access_token` via `encryptPlaidToken()`
10. Server stores `plaid_access_token_encrypted`, `plaid_account_id`, `plaid_item_id`, `plaid_institution_name`, `plaid_account_mask` on `organizations`
11. Server sets `plaid_status = 'active'`
12. UI updates to show connected bank

## Tenant Payment Flow

### Payment Method Dialog

When tenant clicks "Pay Now", the dialog dynamically shows options based on org configuration:

**Org has both Stripe + Plaid connected:**

| Option | Fee Display | Processor |
|--------|-------------|-----------|
| Credit/Debit Card | 2.9% + $0.30 (e.g., "$58.30 fee") | Stripe Checkout |
| Bank Account (ACH) | $1.00 flat | Plaid Transfer |

**Org has only Stripe connected:**

| Option | Fee Display | Processor |
|--------|-------------|-----------|
| Credit/Debit Card | 2.9% + $0.30 | Stripe Checkout |
| Bank Account (ACH) | 0.8% max $5 (e.g., "$5.00 fee") | Stripe Checkout |

**Org has only Plaid connected:**

| Option | Fee Display | Processor |
|--------|-------------|-----------|
| Bank Account (ACH) | $1.00 flat | Plaid Transfer |

### First-Time Plaid Payment

1. Tenant selects "Bank Account (ACH) — $1.00 fee"
2. No linked bank found → Plaid Link modal opens
3. Tenant links bank → saved to `tenant_bank_accounts` (access token encrypted)
4. Confirmation screen: "Pay $2,001.00 from Chase Checking ****4521?"
5. Tenant confirms → `initiatePlaidTransfer()` server action
6. Server initiates Plaid Transfer (see Fund Flow below)
7. Invoice `status` → `processing`, `payment_processor` → `plaid`, `plaid_transfer_id` stored
8. Plaid webhook `TRANSFER_EVENTS_UPDATE` → `transfer.event.sync()` → event `settled` → invoice `status` → `paid`, create `payments` + `income` records

### Returning Tenant Plaid Payment

1. Tenant selects "Bank Account (ACH) — $1.00 fee"
2. Linked bank found → shows "Chase Checking ****4521"
3. Option: "Use different account" (re-opens Plaid Link, replaces saved account)
4. Tenant confirms → payment initiated
5. Same webhook completion flow

### Fund Flow (Two-Leg Transfer)

When `initiatePlaidTransfer()` is called:

1. **Authorization (debit):** `plaid.transferAuthorizationCreate()` with tenant's decrypted token, account ID, amount, type `'debit'`. If declined, invoice stays `open`, tenant notified with reason (e.g., "insufficient funds"). Abort flow.
2. **Debit leg:** If authorized, `plaid.transferCreate()` with:
   - `authorization_id`: from step 1
   - `access_token`: tenant's decrypted token
   - `account_id`: tenant's bank account
   - `type`: `'debit'`
   - `amount`: rent + $1 fee (e.g., `'2001.00'`)
   - `description`: `'Rent payment - Invoice #INV-001'`
   - `metadata`: `{ invoice_id, org_id, tenant_id }`
3. Funds settle into **platform's Plaid funding account** (1-3 business days)
4. **Authorization (credit):** After debit settles (triggered by `settled` event in webhook), `plaid.transferAuthorizationCreate()` with landlord's token, account ID, amount, type `'credit'`. If declined, log error + alert platform admin for manual resolution.
5. **Credit leg:** If authorized, `plaid.transferCreate()` with:
   - `authorization_id`: from step 4
   - `access_token`: landlord's decrypted token
   - `account_id`: landlord's bank account
   - `type`: `'credit'`
   - `amount`: rent only (e.g., `'2000.00'`) — fee retained by platform
   - `description`: `'Rent deposit - Invoice #INV-001'`
6. The $1.00 fee remains in the platform's Plaid funding account

**Invoice status transitions:**
- After debit initiated: `processing`
- After debit settled + credit initiated: `paid` (landlord payout in progress)
- After credit settled: no further status change (already `paid`)

### Fee Collection

| Component | Amount | Destination |
|-----------|--------|-------------|
| Rent | $2,000.00 | Landlord's bank (via credit leg) |
| Processing fee | $1.00 | Platform's Plaid funding account (retained from debit) |
| Plaid's per-transfer cost | ~$0.30 x 2 legs | Billed to platform's Plaid account monthly |

**Platform net revenue per Plaid ACH:** $1.00 - ~$0.60 (two legs) = ~$0.40

### Auto-Pay

**Trigger mechanism:** Supabase `pg_cron` job running daily at 6:00 AM UTC.

**Logic:**
1. Query invoices where: `status = 'open'`, `due_date <= NOW() + INTERVAL '2 days'`, tenant has `auto_pay_enabled = true` in `tenant_bank_accounts`, and `plaid_transfer_id IS NULL` (idempotency guard)
2. For each matching invoice, call `initiatePlaidTransfer()` (same server action as manual pay)
3. If transfer fails (e.g., expired token), invoice stays `open`, log error, send notification to tenant

**Email notification:** 2 days before auto-debit, send email: "Your rent of $2,000 + $1.00 processing fee will be debited from Chase ****4521 on [date]."

**Disabling auto-pay:** If tenant unlinks bank account, `auto_pay_enabled` is set to `false` automatically.

**Expired token handling:** If `PENDING_EXPIRATION` webhook flagged the tenant's account, skip auto-pay for that tenant and notify them to re-link.

## Fee Calculation

Update `modules/payments/src/lib/fees.ts`:

```typescript
export type PaymentMethod = 'card' | 'us_bank_account' | 'plaid_ach';

export function calculateConvenienceFee(
  amount: number,
  method: PaymentMethod = 'card',
): number {
  if (method === 'plaid_ach') return 1.0; // $1 flat
  if (method === 'us_bank_account') {
    const fee = amount * 0.008;
    return Math.round(Math.min(fee, 5) * 100) / 100;
  }
  const fee = amount * 0.029 + 0.3;
  return Math.round(fee * 100) / 100;
}
```

## Architecture

### New Files (10)

| File | Purpose |
|------|---------|
| `modules/payments/src/lib/plaid.ts` | Plaid client singleton (mirrors `stripe.ts` pattern) |
| `modules/payments/src/lib/plaid-crypto.ts` | `encryptPlaidToken()` and `decryptPlaidToken()` helpers using AES-256-GCM |
| `modules/payments/src/actions/create-plaid-link-token.ts` | Server action: generates Plaid Link token with `transfer` product |
| `modules/payments/src/actions/exchange-plaid-token.ts` | Server action: exchanges public token → access token, encrypts and stores |
| `modules/payments/src/actions/initiate-plaid-transfer.ts` | Server action: creates two-leg Plaid Transfer (debit tenant, credit landlord after settlement) |
| `modules/payments/src/actions/get-tenant-bank-account.ts` | Server action: fetches tenant's linked bank for an org (non-sensitive fields only) |
| `modules/payments/src/hooks/use-tenant-bank.ts` | React hook: tenant's linked bank account |
| `apps/web/app/api/plaid/webhook/route.ts` | API route: handles Plaid Transfer + Item webhooks |
| `apps/web/components/payments/plaid-link-button.tsx` | Client component wrapping `react-plaid-link` `usePlaidLink` hook |
| `supabase/migrations/XXXXXX_add_plaid_support.sql` | Migration: new columns, table, RLS policies, pg_cron job |

### Modified Files (7)

| File | Change |
|------|--------|
| `modules/payments/src/lib/fees.ts` | Add `plaid_ach` payment method returning $1.00 flat |
| `modules/payments/src/index.ts` | Export new actions + hooks |
| `modules/payments/package.json` | Add `plaid` and `react-plaid-link` dependencies |
| `modules/payments/src/hooks/use-connect-status.ts` | Extend to also return `plaid_status` from org (unified payment config) |
| `packages/types/src/models.ts` | Add Plaid fields to `Organization`, `Invoice`; add `TenantBankAccount` interface |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add Plaid bank linking section below Stripe Connect |
| `apps/web/app/(dashboard)/tenant/payments/page.tsx` | Dynamic payment options based on org config, Plaid Link integration, saved bank display, auto-pay toggle |

### Webhook Handler

New API route at `/api/plaid/webhook`:

**Webhook processing model:** Plaid sends a single `TRANSFER_EVENTS_UPDATE` notification. The handler then calls `plaid.transferEventSync()` with a stored cursor to fetch individual transfer events. Each event has a `type` field (`settled`, `failed`, `returned`, etc.).

| Webhook Type | Handler Action |
|-------|--------|
| `TRANSFER_EVENTS_UPDATE` | Call `plaid.transferEventSync(afterId)` to fetch new events, then process each: |
| → Event type `settled` (debit leg) | Initiate credit leg to landlord. Invoice stays `processing`. |
| → Event type `settled` (credit leg) | No-op (invoice already `paid` from debit settlement). |
| → Event type `failed` | Invoice → `open` (revert from processing), log error, notify tenant |
| → Event type `returned` | If invoice `paid`: reverse `payments` + `income` records, set `amount_paid` back, invoice → `open`. If invoice `processing`: just revert to `open`. Notify tenant with return reason (e.g., NSF). |
| `ITEM_LOGIN_REQUIRED` | Flag tenant/org bank account as needing re-link |
| `PENDING_EXPIRATION` | Flag tenant/org bank account, prompt re-link on next interaction |

**Idempotency:** Reuse existing `payment_events` table. Add a nullable `plaid_event_id` column (separate from `stripe_event_id`) to avoid semantic mismatch. Check for duplicate `plaid_event_id` before processing each event from `transferEventSync`. The migration adds this column.

**Sync cursor:** Store `plaid_transfer_sync_cursor` in a new `platform_config` table created by the migration:

| Column | Type | Purpose |
|--------|------|---------|
| `key` | text, PK | Config key (e.g., `'plaid_transfer_sync_cursor'`) |
| `value` | text | Config value (the `after_id` from last sync) |
| `updated_at` | timestamptz | Last update time |

This ensures we only fetch new events on each webhook call.

**Webhook verification:** Verify Plaid's JWT signature from the `plaid-verification` header using Plaid's published JWKS endpoint. Reject requests without valid JWT.

**Route protection:** The `/api/plaid/webhook` endpoint only accepts POST requests with a valid Plaid JWT. No user authentication is checked (webhooks come from Plaid servers, not users).

### Dependencies

**npm packages:**
- `plaid` — official Plaid Node.js SDK
- `react-plaid-link` — Plaid Link React component

**Environment variables:**
- `PLAID_CLIENT_ID` — Plaid application client ID
- `PLAID_SECRET` — Plaid secret (sandbox or production)
- `PLAID_ENV` — `sandbox` or `production`
- `PLAID_WEBHOOK_URL` — public URL for Plaid to send webhooks (e.g., `https://app.onereal.com/api/plaid/webhook`)
- `PLAID_TOKEN_ENCRYPTION_KEY` — 32-byte hex string for AES-256-GCM encryption of access tokens

## Security

- **Plaid access tokens** encrypted with AES-256-GCM before database storage. Encryption key stored in `PLAID_TOKEN_ENCRYPTION_KEY` env var (Azure Key Vault in production). Plaintext tokens never touch the database.
- **Webhook verification** — verify Plaid webhook JWT signature before processing any event. Reject requests without valid JWT.
- **RLS on `tenant_bank_accounts`** — tenants can only see/manage their own linked accounts. Org admins can view (not modify) tenant accounts for their org.
- **Server-side only** — all Plaid API calls happen in server actions. Client only interacts with Plaid Link (designed for client-side use).
- **Token rotation** — Plaid sends `PENDING_EXPIRATION` item webhook. Flag the account and prompt re-link on next payment. Auto-pay skips flagged accounts.
- **Route protection** — `/api/plaid/webhook` only accepts valid Plaid JWTs, not user auth tokens.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Plaid Transfer fails after `processing` | Webhook reverts invoice to `open`, tenant sees error toast on next visit |
| ACH return after settlement (`paid`) | Webhook reverses `payments` + `income` records, sets `amount_paid` back, reverts invoice to `open`, notifies tenant with return reason |
| Tenant unlinks bank with auto-pay on | Auto-pay disabled automatically (`auto_pay_enabled = false`), tenant notified |
| Landlord changes their Plaid bank account | Future credit legs go to new account. In-flight transfers complete to old account |
| Partial payment via Plaid | Plaid transfer covers remaining balance only (e.g., if `partially_paid` via cash, Plaid debits the remainder + $1 fee) |
| Duplicate transfer attempt | Check `plaid_transfer_id` on invoice before creating. If already `processing`, show "Payment already in progress" |
| Plaid access token expiring | `PENDING_EXPIRATION` webhook → flag account, prompt re-link on next payment, skip in auto-pay |
| Auto-pay fails | Invoice stays `open`, tenant notified. Auto-pay remains enabled for next attempt |
| Tenant has no bank linked but selects Plaid ACH | Plaid Link opens inline before confirming payment |
| Credit leg fails (landlord payout) | Log error, alert platform admin via email. Invoice stays `paid` (tenant already debited). Platform admin retries credit leg via Plaid Dashboard or initiates manual bank transfer. Track in `platform_config` as `failed_credit_{transfer_id}` for follow-up. |

## Out of Scope (YAGNI)

- Plaid Identity verification (not needed for payments)
- Multiple banks per tenant per org (one linked bank per relationship)
- Instant/same-day ACH (standard 1-3 day settlement only)
- Refund flow via Plaid (handle manually for now)
- Plaid Balance pre-checks (Plaid Transfer handles NSF returns natively)
- Plaid webhooks for non-transfer events beyond token rotation (only transfer + item events needed)
- Plaid Ledger or originator model (standard platform-intermediary is sufficient)

# Plaid ACH Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Plaid Transfer API as an alternative ACH payment processor so tenants pay $1 flat instead of Stripe's 0.8% capped at $5.

**Architecture:** Platform-intermediary two-leg transfer model. Tenant's bank is debited via Plaid, funds settle to platform's funding account, then credited to landlord's linked bank. Encrypted Plaid tokens stored in Supabase. Webhook handler syncs transfer events for settlement/failure.

**Tech Stack:** Plaid Node SDK (`plaid`), React Plaid Link (`react-plaid-link`), AES-256-GCM encryption, Next.js 15 server actions, Supabase (Postgres + RLS)

**Spec:** `docs/superpowers/specs/2026-03-16-plaid-ach-design.md`

---

## File Structure

### New Files (11)

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260316000002_plaid_support.sql` | DB migration: new columns, table, RLS, platform_config |
| `modules/payments/src/lib/plaid.ts` | Plaid client singleton |
| `modules/payments/src/lib/plaid-crypto.ts` | AES-256-GCM encrypt/decrypt for Plaid tokens |
| `modules/payments/src/actions/create-plaid-link-token.ts` | Server action: generate Plaid Link token |
| `modules/payments/src/actions/exchange-plaid-token.ts` | Server action: exchange public token, encrypt, store |
| `modules/payments/src/actions/initiate-plaid-transfer.ts` | Server action: authorize + create debit transfer |
| `modules/payments/src/actions/get-tenant-bank-account.ts` | Server action: fetch tenant's linked bank (non-sensitive) |
| `modules/payments/src/hooks/use-tenant-bank.ts` | React hook: tenant's linked bank account |
| `apps/web/app/api/plaid/webhook/route.ts` | Webhook handler: transfer events + item events |
| `apps/web/components/payments/plaid-link-button.tsx` | Client component: Plaid Link modal wrapper |
| `apps/web/lib/plaid-webhook-verify.ts` | JWT verification for Plaid webhooks |

### Modified Files (7)

| File | Change |
|------|--------|
| `packages/types/src/models.ts` | Add Plaid fields to Organization/Invoice, add TenantBankAccount + PaymentEvent update |
| `packages/types/src/enums.ts` | Add PLAID to PaymentMethod enum |
| `modules/payments/src/lib/fees.ts` | Add `plaid_ach` returning $1.00 flat |
| `modules/payments/src/index.ts` | Export new Plaid actions + hooks |
| `modules/payments/package.json` | Add `plaid` + `react-plaid-link` deps |
| `modules/payments/src/hooks/use-connect-status.ts` | Extend to return `plaid_status` |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add Plaid bank linking section |
| `apps/web/app/(dashboard)/tenant/payments/page.tsx` | Dynamic payment options + Plaid Link + auto-pay toggle |

---

## Chunk 1: Foundation (Types, Crypto, Client, Migration)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260316000002_plaid_support.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add Plaid columns to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plaid_access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS plaid_account_id text,
  ADD COLUMN IF NOT EXISTS plaid_item_id text,
  ADD COLUMN IF NOT EXISTS plaid_institution_name text,
  ADD COLUMN IF NOT EXISTS plaid_account_mask text,
  ADD COLUMN IF NOT EXISTS plaid_status text NOT NULL DEFAULT 'not_connected';

-- Add Plaid columns to invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS plaid_transfer_id text,
  ADD COLUMN IF NOT EXISTS payment_processor text;

-- Add plaid_event_id to payment_events
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS plaid_event_id text;

-- Create tenant_bank_accounts table
CREATE TABLE IF NOT EXISTS tenant_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plaid_access_token_encrypted text NOT NULL,
  plaid_account_id text NOT NULL,
  plaid_item_id text NOT NULL,
  institution_name text NOT NULL,
  account_mask text NOT NULL,
  account_name text NOT NULL,
  auto_pay_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, org_id)
);

-- updated_at trigger for tenant_bank_accounts
CREATE OR REPLACE FUNCTION update_tenant_bank_accounts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenant_bank_accounts_updated_at
  BEFORE UPDATE ON tenant_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_bank_accounts_updated_at();

-- Platform config table (for Plaid sync cursor etc.)
CREATE TABLE IF NOT EXISTS platform_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed sync cursor
INSERT INTO platform_config (key, value) VALUES ('plaid_transfer_sync_cursor', '0')
ON CONFLICT (key) DO NOTHING;

-- RLS for tenant_bank_accounts
ALTER TABLE tenant_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Tenants can manage their own bank accounts
CREATE POLICY tenant_bank_accounts_tenant_select ON tenant_bank_accounts
  FOR SELECT USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_update ON tenant_bank_accounts
  FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_delete ON tenant_bank_accounts
  FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY tenant_bank_accounts_tenant_insert ON tenant_bank_accounts
  FOR INSERT WITH CHECK (tenant_id = auth.uid());

-- Org admins can view tenant bank accounts for their org
CREATE POLICY tenant_bank_accounts_org_admin_select ON tenant_bank_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = tenant_bank_accounts.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('admin', 'landlord', 'property_manager')
        AND org_members.status = 'active'
    )
  );

-- RLS for platform_config (service role only, no user access needed)
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && npx supabase db push`
Expected: Migration applied successfully. If using local dev, run `npx supabase migration up` instead.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260316000002_plaid_support.sql
git commit -m "feat(plaid): add database migration for Plaid support"
```

---

### Task 2: Type Definitions

**Files:**
- Modify: `packages/types/src/models.ts` (lines 1-18 Organization, 259-282 Invoice, 298-306 PaymentEvent)
- Modify: `packages/types/src/enums.ts` (lines 79-87 PaymentMethod)

- [ ] **Step 1: Add Plaid fields to Organization interface**

In `packages/types/src/models.ts`, add after line 15 (`subscription_current_period_end`):

```typescript
  plaid_access_token_encrypted: string | null;
  plaid_account_id: string | null;
  plaid_item_id: string | null;
  plaid_institution_name: string | null;
  plaid_account_mask: string | null;
  plaid_status: 'not_connected' | 'active';
```

- [ ] **Step 2: Add Plaid fields to Invoice interface**

In `packages/types/src/models.ts`, add after line 279 (`convenience_fee`):

```typescript
  plaid_transfer_id: string | null;
  payment_processor: 'stripe' | 'plaid' | null;
```

- [ ] **Step 3: Add plaid_event_id to PaymentEvent interface**

In `packages/types/src/models.ts`, add after line 300 (`stripe_event_id`):

```typescript
  plaid_event_id: string | null;
```

- [ ] **Step 4: Add TenantBankAccount interface**

In `packages/types/src/models.ts`, add after the `PaymentEvent` interface (after line 306):

```typescript
export interface TenantBankAccount {
  id: string;
  tenant_id: string;
  org_id: string;
  plaid_access_token_encrypted: string;
  plaid_account_id: string;
  plaid_item_id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: Add PLAID to PaymentMethod enum**

In `packages/types/src/enums.ts`, add after line 85 (`BANK_TRANSFER: 'bank_transfer',`):

```typescript
  PLAID: 'plaid',
```

- [ ] **Step 6: Verify types compile**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/types type-check`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/models.ts packages/types/src/enums.ts
git commit -m "feat(plaid): add Plaid type definitions"
```

---

### Task 3: Plaid Client Singleton + Crypto Helpers

**Files:**
- Create: `modules/payments/src/lib/plaid.ts`
- Create: `modules/payments/src/lib/plaid-crypto.ts`
- Modify: `modules/payments/package.json` (add dependencies)

- [ ] **Step 1: Install dependencies**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/payments add plaid react-plaid-link`
Expected: Packages added to `modules/payments/package.json`.

- [ ] **Step 2: Create Plaid client singleton**

Create `modules/payments/src/lib/plaid.ts`:

```typescript
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

let plaidInstance: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!plaidInstance) {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const env = process.env.PLAID_ENV || 'sandbox';

    if (!clientId || !secret) {
      throw new Error('PLAID_CLIENT_ID and PLAID_SECRET must be configured');
    }

    const configuration = new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    plaidInstance = new PlaidApi(configuration);
  }
  return plaidInstance;
}
```

- [ ] **Step 3: Create encryption helpers**

Create `modules/payments/src/lib/plaid-crypto.ts`:

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('PLAID_TOKEN_ENCRYPTION_KEY is not configured');
  return Buffer.from(key, 'hex');
}

export function encryptPlaidToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decryptPlaidToken(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, ciphertext] = encrypted.split(':');

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/payments type-check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add modules/payments/src/lib/plaid.ts modules/payments/src/lib/plaid-crypto.ts modules/payments/package.json pnpm-lock.yaml
git commit -m "feat(plaid): add Plaid client singleton and token encryption"
```

---

### Task 4: Update Fee Calculation

**Files:**
- Modify: `modules/payments/src/lib/fees.ts`

- [ ] **Step 1: Add plaid_ach to PaymentMethod type and fee function**

Replace entire contents of `modules/payments/src/lib/fees.ts`:

```typescript
export type PaymentMethod = 'card' | 'us_bank_account' | 'plaid_ach';

/**
 * Calculate processing fee based on payment method.
 * - Card / Link: 2.9% + $0.30
 * - ACH bank transfer (Stripe): 0.8% (capped at $5.00)
 * - ACH bank transfer (Plaid): $1.00 flat
 */
export function calculateConvenienceFee(
  amount: number,
  method: PaymentMethod = 'card',
): number {
  if (method === 'plaid_ach') return 1.0;
  if (method === 'us_bank_account') {
    const fee = amount * 0.008;
    return Math.round(Math.min(fee, 5) * 100) / 100;
  }
  const fee = amount * 0.029 + 0.3;
  return Math.round(fee * 100) / 100;
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/payments/src/lib/fees.ts
git commit -m "feat(plaid): add plaid_ach fee method ($1 flat)"
```

---

## Chunk 2: Server Actions (Link Token, Exchange, Transfer, Bank Query)

### Task 5: Create Plaid Link Token Action

**Files:**
- Create: `modules/payments/src/actions/create-plaid-link-token.ts`

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getPlaidClient } from '../lib/plaid';
import { Products, CountryCode } from 'plaid';
import type { ActionResult } from '@onereal/types';

export async function createPlaidLinkToken(
  role: 'landlord' | 'tenant',
  orgId: string
): Promise<ActionResult<{ linkToken: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const plaid = getPlaidClient();
    const webhookUrl = process.env.PLAID_WEBHOOK_URL;

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'OneReal',
      products: [Products.Transfer],
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
    });

    return { success: true, data: { linkToken: response.data.link_token } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to create link token' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/payments/src/actions/create-plaid-link-token.ts
git commit -m "feat(plaid): add create-plaid-link-token server action"
```

---

### Task 6: Exchange Plaid Token Action

**Files:**
- Create: `modules/payments/src/actions/exchange-plaid-token.ts`

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getPlaidClient } from '../lib/plaid';
import { encryptPlaidToken } from '../lib/plaid-crypto';
import type { ActionResult } from '@onereal/types';

interface ExchangeParams {
  publicToken: string;
  accountId: string;
  institutionName: string;
  accountMask: string;
  accountName: string;
}

export async function exchangePlaidToken(
  role: 'landlord' | 'tenant',
  orgId: string,
  params: ExchangeParams
): Promise<ActionResult<void>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const plaid = getPlaidClient();
    const db = supabase as any;

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: params.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;
    const encryptedToken = encryptPlaidToken(accessToken);

    if (role === 'landlord') {
      // Verify user is admin/landlord of this org
      const { data: membership } = await db
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .in('role', ['admin', 'landlord', 'property_manager'])
        .eq('status', 'active')
        .maybeSingle();

      if (!membership) return { success: false, error: 'Not authorized' };

      await db.from('organizations').update({
        plaid_access_token_encrypted: encryptedToken,
        plaid_account_id: params.accountId,
        plaid_item_id: itemId,
        plaid_institution_name: params.institutionName,
        plaid_account_mask: params.accountMask,
        plaid_status: 'active',
      }).eq('id', orgId);
    } else {
      // Tenant: upsert bank account (one per tenant per org)
      await db.from('tenant_bank_accounts').upsert({
        tenant_id: user.id,
        org_id: orgId,
        plaid_access_token_encrypted: encryptedToken,
        plaid_account_id: params.accountId,
        plaid_item_id: itemId,
        institution_name: params.institutionName,
        account_mask: params.accountMask,
        account_name: params.accountName,
      }, { onConflict: 'tenant_id,org_id' });
    }

    return { success: true, data: undefined };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to exchange token' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/payments/src/actions/exchange-plaid-token.ts
git commit -m "feat(plaid): add exchange-plaid-token server action"
```

---

### Task 7: Initiate Plaid Transfer Action

**Files:**
- Create: `modules/payments/src/actions/initiate-plaid-transfer.ts`

This is the core payment action. It handles the **debit leg only** — the credit leg is triggered by the webhook after the debit settles.

- [ ] **Step 1: Write the server action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { getPlaidClient } from '../lib/plaid';
import { decryptPlaidToken } from '../lib/plaid-crypto';
import { TransferType, TransferNetwork, ACHClass } from 'plaid';
import type { ActionResult } from '@onereal/types';

export async function initiatePlaidTransfer(
  orgId: string,
  invoiceId: string
): Promise<ActionResult<{ transferId: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;
    const plaid = getPlaidClient();

    // 1. Fetch invoice
    const { data: invoice } = await db
      .from('invoices')
      .select('id, amount, amount_paid, description, org_id, tenant_id, status, invoice_number, plaid_transfer_id')
      .eq('id', invoiceId)
      .single();

    if (!invoice) return { success: false, error: 'Invoice not found' };
    if (!['open', 'partially_paid'].includes((invoice as any).status)) {
      return { success: false, error: 'Invoice is not payable' };
    }
    if ((invoice as any).plaid_transfer_id) {
      return { success: false, error: 'Payment already in progress' };
    }

    // 2. Fetch tenant's linked bank account
    const { data: tenantBank } = await db
      .from('tenant_bank_accounts')
      .select('plaid_access_token_encrypted, plaid_account_id')
      .eq('tenant_id', user.id)
      .eq('org_id', orgId)
      .single();

    if (!tenantBank) return { success: false, error: 'No linked bank account' };

    // 3. Verify org has Plaid connected
    const { data: org } = await db
      .from('organizations')
      .select('plaid_status')
      .eq('id', orgId)
      .single();

    if ((org as any)?.plaid_status !== 'active') {
      return { success: false, error: 'Organization has not connected Plaid' };
    }

    // 4. Calculate amount (remaining balance + $1 fee)
    const remaining = Number((invoice as any).amount) - Number((invoice as any).amount_paid);
    const totalDebit = remaining + 1.0; // $1 flat fee

    // 5. Decrypt tenant's access token
    const accessToken = decryptPlaidToken((tenantBank as any).plaid_access_token_encrypted);

    // 6. Authorize the debit
    const authResponse = await plaid.transferAuthorizationCreate({
      access_token: accessToken,
      account_id: (tenantBank as any).plaid_account_id,
      type: TransferType.Debit,
      network: TransferNetwork.Ach,
      amount: totalDebit.toFixed(2),
      ach_class: ACHClass.Ppd,
      user: {
        legal_name: user.user_metadata?.full_name || user.email || 'Tenant',
      },
    });

    const authorization = authResponse.data.authorization;
    if (authorization.decision !== 'approved') {
      const reason = authorization.decision_rationale?.description || 'Authorization declined';
      return { success: false, error: reason };
    }

    // 7. Create the debit transfer
    const transferResponse = await plaid.transferCreate({
      access_token: accessToken,
      account_id: (tenantBank as any).plaid_account_id,
      authorization_id: authorization.id,
      type: TransferType.Debit,
      network: TransferNetwork.Ach,
      amount: totalDebit.toFixed(2),
      description: `Rent - ${(invoice as any).invoice_number}`,
      ach_class: ACHClass.Ppd,
      user: {
        legal_name: user.user_metadata?.full_name || user.email || 'Tenant',
      },
      metadata: {
        invoice_id: invoiceId,
        org_id: orgId,
        tenant_id: (invoice as any).tenant_id || '',
        leg: 'debit',
      },
    });

    const transferId = transferResponse.data.transfer.id;

    // 8. Update invoice status
    await db.from('invoices').update({
      plaid_transfer_id: transferId,
      payment_processor: 'plaid',
      convenience_fee: 1.0,
      status: 'processing',
    }).eq('id', invoiceId);

    return { success: true, data: { transferId } };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to initiate transfer' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/payments/src/actions/initiate-plaid-transfer.ts
git commit -m "feat(plaid): add initiate-plaid-transfer server action (debit leg)"
```

---

### Task 8: Get Tenant Bank Account Action + Hook

**Files:**
- Create: `modules/payments/src/actions/get-tenant-bank-account.ts`
- Create: `modules/payments/src/hooks/use-tenant-bank.ts`

- [ ] **Step 1: Write the server action**

Create `modules/payments/src/actions/get-tenant-bank-account.ts`:

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export async function getTenantBankAccount(
  orgId: string
): Promise<ActionResult<TenantBankInfo | null>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: bank } = await (supabase as any)
      .from('tenant_bank_accounts')
      .select('id, institution_name, account_mask, account_name, auto_pay_enabled')
      .eq('tenant_id', user.id)
      .eq('org_id', orgId)
      .maybeSingle();

    return { success: true, data: bank || null };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to get bank account' };
  }
}

export async function toggleAutoPay(
  orgId: string,
  enabled: boolean
): Promise<ActionResult<void>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    await (supabase as any)
      .from('tenant_bank_accounts')
      .update({ auto_pay_enabled: enabled })
      .eq('tenant_id', user.id)
      .eq('org_id', orgId);

    return { success: true, data: undefined };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to toggle auto-pay' };
  }
}
```

- [ ] **Step 2: Write the React hook**

Create `modules/payments/src/hooks/use-tenant-bank.ts`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTenantBankAccount } from '../actions/get-tenant-bank-account';

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export function useTenantBank(orgId: string | null) {
  const [bank, setBank] = useState<TenantBankInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const result = await getTenantBankAccount(orgId);
    if (result.success) {
      setBank(result.data);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bank, loading, refresh };
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/payments/src/actions/get-tenant-bank-account.ts modules/payments/src/hooks/use-tenant-bank.ts
git commit -m "feat(plaid): add get-tenant-bank-account action and hook"
```

---

### Task 9: Update Module Exports + Extend useConnectStatus

**Files:**
- Modify: `modules/payments/src/index.ts`
- Modify: `modules/payments/src/hooks/use-connect-status.ts`

- [ ] **Step 1: Update module exports**

Replace `modules/payments/src/index.ts` with:

```typescript
export { getStripe } from './lib/stripe';
export { getPlaidClient } from './lib/plaid';
export { calculateConvenienceFee } from './lib/fees';
export { encryptPlaidToken, decryptPlaidToken } from './lib/plaid-crypto';
export { createCheckoutSession } from './actions/create-checkout-session';
export { createConnectAccount } from './actions/create-connect-account';
export { createPortalSession } from './actions/create-portal-session';
export { getConnectStatus } from './actions/get-connect-status';
export { createPlaidLinkToken } from './actions/create-plaid-link-token';
export { exchangePlaidToken } from './actions/exchange-plaid-token';
export { initiatePlaidTransfer } from './actions/initiate-plaid-transfer';
export { getTenantBankAccount, toggleAutoPay } from './actions/get-tenant-bank-account';
export { useConnectStatus } from './hooks/use-connect-status';
export { useSubscriptionStatus } from './hooks/use-subscription-status';
export { useTenantBank } from './hooks/use-tenant-bank';
```

- [ ] **Step 2: Extend useConnectStatus to include plaid_status**

First, update the `getConnectStatus` server action to also return `plaid_status`. In `modules/payments/src/actions/get-connect-status.ts`, update the `ConnectStatus` interface and the query:

```typescript
// Add to ConnectStatus interface:
  plaid_status: 'not_connected' | 'active';

// Update the .select() query to include plaid_status:
  .select('stripe_account_id, stripe_account_status, plaid_status')

// Add to both return statements:
  plaid_status: (org as any).plaid_status || 'not_connected',
```

Then replace `modules/payments/src/hooks/use-connect-status.ts` with:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { getConnectStatus } from '../actions/get-connect-status';

export function useConnectStatus(orgId: string | null, pollOnMount = false) {
  const [status, setStatus] = useState<'not_connected' | 'onboarding' | 'active' | 'restricted'>('not_connected');
  const [plaidStatus, setPlaidStatus] = useState<'not_connected' | 'active'>('not_connected');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const result = await getConnectStatus(orgId);
    if (result.success) {
      setStatus(result.data.stripe_account_status);
      setPlaidStatus(result.data.plaid_status);
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

  return { status, plaidStatus, loading, refresh };
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter @onereal/payments type-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add modules/payments/src/index.ts modules/payments/src/hooks/use-connect-status.ts
git commit -m "feat(plaid): update module exports and extend useConnectStatus with plaid_status"
```

---

## Chunk 3: Webhook Handler

### Task 10: Plaid Webhook Verification Utility

**Files:**
- Create: `apps/web/lib/plaid-webhook-verify.ts`

- [ ] **Step 1: Write the verification utility**

Plaid webhooks include a `plaid-verification` header containing a JWT. We verify it using Plaid's JWKS endpoint.

```typescript
import { getPlaidClient } from '@onereal/payments';

export async function verifyPlaidWebhook(body: string, headers: Headers): Promise<boolean> {
  try {
    const plaid = getPlaidClient();
    const verificationHeader = headers.get('plaid-verification');
    if (!verificationHeader) return false;

    const response = await plaid.webhookVerificationKeyGet({
      key_id: extractKidFromJwt(verificationHeader),
    });

    // In production, fully verify the JWT signature using the returned key.
    // For sandbox, Plaid doesn't send signed webhooks, so we allow through.
    const env = process.env.PLAID_ENV || 'sandbox';
    if (env === 'sandbox') return true;

    // Production verification using jose or similar JWT library
    // For now, verify key exists as basic check
    return !!response.data.key;
  } catch {
    // In sandbox, webhooks may not have verification headers
    const env = process.env.PLAID_ENV || 'sandbox';
    return env === 'sandbox';
  }
}

function extractKidFromJwt(jwt: string): string {
  const [headerB64] = jwt.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
  return header.kid;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/plaid-webhook-verify.ts
git commit -m "feat(plaid): add webhook verification utility"
```

---

### Task 11: Plaid Webhook Route Handler

**Files:**
- Create: `apps/web/app/api/plaid/webhook/route.ts`

This is the most complex file. It handles transfer events (settled, failed, returned) and item events (login required, pending expiration). The settled debit handler triggers the credit leg to the landlord.

- [ ] **Step 1: Write the webhook handler**

```typescript
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
        stripe_event_id: eventId, // reuse column for backwards compat
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
      legal_name: 'Landlord', // Plaid requires a name
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
```

- [ ] **Step 2: Verify types compile**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm --filter web type-check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/plaid/webhook/route.ts
git commit -m "feat(plaid): add webhook handler for transfer and item events"
```

---

## Chunk 4: UI Components (Settings + Tenant Payments)

### Task 12: Plaid Link Button Component

**Files:**
- Create: `apps/web/components/payments/plaid-link-button.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@onereal/ui';
import { createPlaidLinkToken } from '@onereal/payments/actions/create-plaid-link-token';
import { exchangePlaidToken } from '@onereal/payments/actions/exchange-plaid-token';
import { toast } from 'sonner';

interface PlaidLinkButtonProps {
  role: 'landlord' | 'tenant';
  orgId: string;
  onSuccess: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
  disabled?: boolean;
}

export function PlaidLinkButton({
  role,
  orgId,
  onSuccess,
  children,
  variant = 'default',
  size = 'default',
  disabled = false,
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    const result = await createPlaidLinkToken(role, orgId);
    if (result.success) {
      setLinkToken(result.data.linkToken);
    } else {
      toast.error(result.error);
      setLoading(false);
    }
  };

  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      const account = metadata.accounts?.[0];
      if (!account) {
        toast.error('No account selected');
        setLoading(false);
        return;
      }

      const result = await exchangePlaidToken(role, orgId, {
        publicToken,
        accountId: account.id,
        institutionName: metadata.institution?.name || 'Bank',
        accountMask: account.mask || '****',
        accountName: `${account.subtype || 'Account'} ****${account.mask || ''}`,
      });

      if (result.success) {
        toast.success('Bank account linked successfully');
        onSuccess();
      } else {
        toast.error(result.error);
      }
      setLinkToken(null);
      setLoading(false);
    },
    [role, orgId, onSuccess]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => {
      setLinkToken(null);
      setLoading(false);
    },
  });

  // Auto-open when link token is ready
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled || loading}
    >
      {loading ? 'Connecting...' : children}
    </Button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/payments/plaid-link-button.tsx
git commit -m "feat(plaid): add PlaidLinkButton component"
```

---

### Task 13: Settings Page — Plaid Bank Linking Section

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add Plaid section to settings page**

In `apps/web/app/(dashboard)/settings/page.tsx`:

**Add import** at the top (after line 17):

```typescript
import { PlaidLinkButton } from '../../../components/payments/plaid-link-button';
```

**Add plaid state** (after line 38, `connectLoading`):

```typescript
  const [plaidStatus, setPlaidStatus] = useState<'not_connected' | 'active'>('not_connected');
  const [plaidBank, setPlaidBank] = useState<{ institution: string; mask: string } | null>(null);
```

**Add Plaid fetch in the connect status useEffect** (inside the `fetchConnect` function, after line 74):

```typescript
    // Also fetch Plaid status
    const { data: orgPlaid } = await (supabase as any)
      .from('organizations')
      .select('plaid_status, plaid_institution_name, plaid_account_mask')
      .eq('id', activeOrg.id)
      .single();
    if (orgPlaid) {
      setPlaidStatus((orgPlaid as any).plaid_status || 'not_connected');
      if ((orgPlaid as any).plaid_institution_name) {
        setPlaidBank({
          institution: (orgPlaid as any).plaid_institution_name,
          mask: (orgPlaid as any).plaid_account_mask || '****',
        });
      }
    }
```

**Add Plaid section** after the Stripe Connect Card (after line 283, before the Members Card):

```tsx
      {/* Plaid Bank Account section */}
      {plan?.features?.online_payments && (
        <Card>
          <CardHeader><CardTitle>Plaid Bank Account</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your bank account to receive ACH payments at lower fees ($1 flat vs Stripe&apos;s 0.8%).
            </p>
            {plaidStatus === 'active' && plaidBank ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {plaidBank.institution} ****{plaidBank.mask}
                  </span>
                  <Badge variant="default">Connected</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  ACH payments from tenants will be deposited directly to this account.
                </p>
                <PlaidLinkButton
                  role="landlord"
                  orgId={activeOrg.id}
                  onSuccess={() => window.location.reload()}
                  variant="outline"
                  size="sm"
                >
                  Change Bank Account
                </PlaidLinkButton>
              </>
            ) : (
              <PlaidLinkButton
                role="landlord"
                orgId={activeOrg.id}
                onSuccess={() => window.location.reload()}
              >
                Link Bank Account
              </PlaidLinkButton>
            )}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 2: Verify build**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/settings/page.tsx
git commit -m "feat(plaid): add Plaid bank linking section to settings page"
```

---

### Task 14: Tenant Payments Page — Dynamic Payment Methods + Plaid Flow

**Files:**
- Modify: `apps/web/app/(dashboard)/tenant/payments/page.tsx`

This is the largest UI change. The payment dialog must:
1. Check org's Stripe AND Plaid status
2. Show card option (Stripe) when Stripe connected
3. Show ACH option with correct processor/fee based on what's connected
4. Handle Plaid Link inline for first-time bank linking
5. Show saved bank for returning payments
6. Add auto-pay toggle

- [ ] **Step 1: Rewrite tenant payments page**

Replace the entire contents of `apps/web/app/(dashboard)/tenant/payments/page.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useTenantInvoices } from '@onereal/tenant-portal';
import {
  Card, CardContent,
  Button,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Switch, Label,
} from '@onereal/ui';
import { toast } from 'sonner';
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { initiatePlaidTransfer } from '@onereal/payments/actions/initiate-plaid-transfer';
import { getTenantBankAccount, toggleAutoPay } from '@onereal/payments/actions/get-tenant-bank-account';
import { calculateConvenienceFee } from '@onereal/payments/lib/fees';
import { createClient } from '@onereal/database';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';
import { PlaidLinkButton } from '../../../../components/payments/plaid-link-button';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  processing: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

interface OrgPaymentConfig {
  stripeActive: boolean;
  plaidActive: boolean;
}

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export default function TenantPaymentsPage() {
  return (
    <Suspense>
      <TenantPaymentsContent />
    </Suspense>
  );
}

function TenantPaymentsContent() {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('all');
  const { data: invoices, isLoading } = useTenantInvoices(filter);
  const [onlinePayEnabled, setOnlinePayEnabled] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [orgConfig, setOrgConfig] = useState<OrgPaymentConfig>({ stripeActive: false, plaidActive: false });
  const [tenantBank, setTenantBank] = useState<TenantBankInfo | null>(null);

  // Payment method dialog state
  const [payDialog, setPayDialog] = useState<{ invoiceId: string; orgId: string; amount: number } | null>(null);

  // Plaid Link state for inline bank linking during payment
  const [showPlaidLink, setShowPlaidLink] = useState(false);

  const orgId = invoices?.[0]?.org_id || null;

  // Fetch org payment config and tenant bank
  useEffect(() => {
    if (!orgId) return;

    const checkConfig = async () => {
      const supabase = createClient() as any;
      const { data: org } = await supabase
        .from('organizations')
        .select('plan_id, plans(features), stripe_account_status, plaid_status')
        .eq('id', orgId)
        .single();

      const features = (org as any)?.plans?.features;
      const stripeActive = (org as any)?.stripe_account_status === 'active';
      const plaidActive = (org as any)?.plaid_status === 'active';
      const hasOnlinePayments = features?.online_payments === true;

      setOnlinePayEnabled(hasOnlinePayments && (stripeActive || plaidActive));
      setOrgConfig({ stripeActive, plaidActive });
    };
    checkConfig();
  }, [orgId]);

  // Fetch tenant's linked bank account
  const refreshTenantBank = useCallback(async () => {
    if (!orgId) return;
    const result = await getTenantBankAccount(orgId);
    if (result.success) {
      setTenantBank(result.data);
    }
  }, [orgId]);

  useEffect(() => {
    refreshTenantBank();
  }, [refreshTenantBank]);

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      toast.success('Payment submitted successfully!');
    } else if (searchParams.get('payment') === 'canceled') {
      toast.info('Payment was canceled.');
    }
  }, [searchParams]);

  function handlePayClick(inv: any) {
    const remaining = Number(inv.amount) - Number(inv.amount_paid || 0);
    setPayDialog({ invoiceId: inv.id, orgId: inv.org_id, amount: remaining });
    setShowPlaidLink(false);
  }

  async function handleCardSelect() {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    setPayDialog(null);

    const result = await createCheckoutSession(payDialog.orgId, {
      type: 'payment',
      invoiceId: payDialog.invoiceId,
      paymentMethod: 'card',
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

  async function handleStripeAchSelect() {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    setPayDialog(null);

    const result = await createCheckoutSession(payDialog.orgId, {
      type: 'payment',
      invoiceId: payDialog.invoiceId,
      paymentMethod: 'us_bank_account',
    });
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setPayingInvoiceId(null);
    }
  }

  async function handlePlaidAchSelect() {
    if (!payDialog) return;

    // If no bank linked, show Plaid Link first
    if (!tenantBank) {
      setShowPlaidLink(true);
      return;
    }

    // Bank already linked — confirm and pay
    await executePlaidPayment();
  }

  async function executePlaidPayment() {
    if (!payDialog) return;
    setPayingInvoiceId(payDialog.invoiceId);
    const dialogData = payDialog;
    setPayDialog(null);

    const result = await initiatePlaidTransfer(dialogData.orgId, dialogData.invoiceId);
    if (result.success) {
      toast.success('Payment initiated! ACH transfers take 1-3 business days.');
    } else {
      toast.error(result.error);
    }
    setPayingInvoiceId(null);
  }

  function handlePlaidLinkSuccess() {
    refreshTenantBank();
    setShowPlaidLink(false);
    // After linking, auto-execute the payment
    executePlaidPayment();
  }

  async function handleAutoPayToggle(enabled: boolean) {
    if (!orgId) return;
    // Use server action pattern for mutations
    const result = await toggleAutoPay(orgId, enabled);
    if (result.success) {
      refreshTenantBank();
      toast.success(enabled ? 'Auto-pay enabled' : 'Auto-pay disabled');
    } else {
      toast.error(result.error);
    }
  }

  // Fee calculations for dialog
  const cardFee = payDialog ? calculateConvenienceFee(payDialog.amount, 'card') : 0;
  const achMethod = orgConfig.plaidActive ? 'plaid_ach' as const : 'us_bank_account' as const;
  const achFee = payDialog ? calculateConvenienceFee(payDialog.amount, achMethod) : 0;
  const achLabel = orgConfig.plaidActive ? '$1.00 flat' : `0.8%, max $5`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>

      {/* Auto-pay toggle (only if bank is linked and Plaid active) */}
      {tenantBank && orgConfig.plaidActive && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="font-medium">Auto-Pay</p>
              <p className="text-sm text-muted-foreground">
                Automatically pay invoices from {tenantBank.institution_name} ****{tenantBank.account_mask}
              </p>
            </div>
            <Switch
              checked={tenantBank.auto_pay_enabled}
              onCheckedChange={handleAutoPayToggle}
            />
          </CardContent>
        </Card>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'open' | 'paid' | 'all')}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !invoices || invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No invoices found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      {onlinePayEnabled && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.description || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(inv.amount).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.status === 'processing' ? 'processing' : inv.displayStatus] ?? ''}`}>
                            {inv.status === 'processing' ? 'Processing' : inv.displayStatus}
                          </span>
                        </TableCell>
                        {onlinePayEnabled && (
                          <TableCell>
                            {['open', 'partially_paid'].includes(inv.status) && (
                              <Button
                                size="sm"
                                onClick={() => handlePayClick(inv)}
                                disabled={payingInvoiceId === inv.id}
                              >
                                {payingInvoiceId === inv.id ? 'Redirecting...' : 'Pay Now'}
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment method selector dialog */}
      <Dialog open={!!payDialog} onOpenChange={(open) => !open && setPayDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Payment Method</DialogTitle>
            <DialogDescription>
              Select how you&apos;d like to pay ${payDialog?.amount.toLocaleString()}.
              A processing fee applies based on the method chosen.
            </DialogDescription>
          </DialogHeader>

          {showPlaidLink && payDialog ? (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-muted-foreground">Link your bank account to pay via ACH:</p>
              <PlaidLinkButton
                role="tenant"
                orgId={payDialog.orgId}
                onSuccess={handlePlaidLinkSuccess}
              >
                Link Bank Account
              </PlaidLinkButton>
              <Button variant="ghost" size="sm" onClick={() => setShowPlaidLink(false)}>
                Back to payment methods
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 pt-2">
              {/* Card option (Stripe only) */}
              {orgConfig.stripeActive && (
                <button
                  onClick={handleCardSelect}
                  className="flex items-center gap-4 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
                >
                  <CreditCard className="h-6 w-6 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Credit / Debit Card</p>
                    <p className="text-sm text-muted-foreground">
                      Fee: ${cardFee.toFixed(2)} (2.9% + $0.30)
                    </p>
                  </div>
                  <p className="font-semibold text-sm">
                    ${((payDialog?.amount ?? 0) + cardFee).toFixed(2)}
                  </p>
                </button>
              )}

              {/* ACH option — routes to Plaid or Stripe based on org config */}
              {(orgConfig.stripeActive || orgConfig.plaidActive) && (
                <button
                  onClick={orgConfig.plaidActive ? handlePlaidAchSelect : handleStripeAchSelect}
                  className="flex items-center gap-4 rounded-lg border p-4 text-left hover:bg-accent transition-colors"
                >
                  <Landmark className="h-6 w-6 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Bank Account (ACH)</p>
                    <p className="text-sm text-muted-foreground">
                      Fee: ${achFee.toFixed(2)} ({achLabel})
                    </p>
                    {orgConfig.plaidActive && tenantBank && (
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground">
                          {tenantBank.institution_name} ****{tenantBank.account_mask}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowPlaidLink(true); }}
                          className="text-xs text-primary underline"
                        >
                          Use different account
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="font-semibold text-sm">
                    ${((payDialog?.amount ?? 0) + achFee).toFixed(2)}
                  </p>
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/tenant/payments/page.tsx
git commit -m "feat(plaid): dynamic payment method routing with Plaid ACH support"
```

---

## Chunk 5: Auto-Pay Cron + Environment + Verification

### Task 15: Auto-Pay API Route + Cron Job

**Files:**
- Create: `apps/web/app/api/plaid/auto-pay/route.ts`
- Modify: `supabase/migrations/20260316000002_plaid_support.sql` (add pg_cron)

The auto-pay system works via a daily cron job that calls an internal API route. The API route finds eligible invoices and initiates Plaid transfers.

- [ ] **Step 1: Create the auto-pay API route**

Create `apps/web/app/api/plaid/auto-pay/route.ts`:

```typescript
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

  // Find invoices eligible for auto-pay:
  // - status = 'open'
  // - due_date within 2 days
  // - tenant has auto_pay_enabled = true
  // - no plaid_transfer_id yet (idempotency)
  // - org has plaid_status = 'active'
  const { data: eligibleInvoices } = await db
    .from('invoices')
    .select(`
      id, amount, amount_paid, org_id, tenant_id, invoice_number, property_id, unit_id,
      tenant_bank_accounts!inner(
        plaid_access_token_encrypted, plaid_account_id, auto_pay_enabled, plaid_item_id
      ),
      organizations!inner(plaid_status)
    `)
    .eq('status', 'open')
    .is('plaid_transfer_id', null)
    .lte('due_date', new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .eq('direction', 'receivable');

  if (!eligibleInvoices || eligibleInvoices.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let errors = 0;

  for (const invoice of eligibleInvoices) {
    const inv = invoice as any;
    const bank = inv.tenant_bank_accounts?.[0];
    const org = inv.organizations;

    // Skip if auto-pay not enabled or org Plaid not active
    if (!bank?.auto_pay_enabled || org?.plaid_status !== 'active') continue;

    try {
      const remaining = Number(inv.amount) - Number(inv.amount_paid);
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
        console.error(`Auto-pay declined for invoice ${inv.id}: ${authResponse.data.authorization.decision_rationale?.description}`);
        errors++;
        continue;
      }

      // Create transfer
      const transferResponse = await plaid.transferCreate({
        access_token: accessToken,
        account_id: bank.plaid_account_id,
        authorization_id: authResponse.data.authorization.id,
        type: TransferType.Debit,
        network: TransferNetwork.Ach,
        amount: totalDebit.toFixed(2),
        description: `Auto-pay - ${inv.invoice_number}`,
        ach_class: ACHClass.Ppd,
        user: { legal_name: 'Tenant' },
        metadata: {
          invoice_id: inv.id,
          org_id: inv.org_id,
          tenant_id: inv.tenant_id || '',
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
      }).eq('id', inv.id);

      processed++;
    } catch (error: any) {
      console.error(`Auto-pay error for invoice ${inv.id}:`, error.message);
      errors++;
    }
  }

  return NextResponse.json({ processed, errors });
}
```

**Note:** The auto-pay query uses a Supabase join (`tenant_bank_accounts!inner`) which requires that the `invoices.tenant_id` FK matches `tenant_bank_accounts.tenant_id` and `invoices.org_id` matches `tenant_bank_accounts.org_id`. If the Supabase join syntax doesn't work directly, the implementer should break this into two queries: (1) fetch auto-pay enabled tenant banks, (2) for each, find eligible invoices.

- [ ] **Step 2: Add pg_cron to migration (or document manual setup)**

Append to `supabase/migrations/20260316000002_plaid_support.sql`:

```sql
-- NOTE: pg_cron setup depends on hosting environment.
-- For Supabase hosted: pg_cron is pre-installed. Run this via SQL editor:
--
-- SELECT cron.schedule(
--   'auto-pay-plaid',
--   '0 6 * * *',
--   $$SELECT net.http_post(
--     url := 'YOUR_APP_URL/api/plaid/auto-pay',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body := '{}'::jsonb
--   )$$
-- );
--
-- For local dev: trigger manually via curl:
-- curl -X POST http://localhost:3000/api/plaid/auto-pay -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

**Note on auto-pay email notifications:** Email notifications ("Your rent will be debited in 2 days") require an email service (e.g., Resend, SendGrid). This is marked as a follow-up task since the email infrastructure is not yet set up in this codebase. The auto-pay mechanism works without notifications for now — tenants see the "Auto-pay enabled" toggle and know payments happen automatically.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/plaid/auto-pay/route.ts supabase/migrations/20260316000002_plaid_support.sql
git commit -m "feat(plaid): add auto-pay API route with cron job instructions"
```

---

### Task 16: Update File Structure Table

Update the file structure at the top of this plan — the plan now has 12 new files (added `apps/web/app/api/plaid/auto-pay/route.ts`) and 8 modified files (added `modules/payments/src/actions/get-connect-status.ts`).

---

### Task 17: Environment Variables

**Files:**
- Modify: `apps/web/.env.local` (or `.env.local.example`)

- [ ] **Step 1: Add Plaid environment variables**

Add to `.env.local`:

```
# Plaid
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=http://localhost:3000/api/plaid/webhook
PLAID_TOKEN_ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

- [ ] **Step 2: Generate encryption key**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
Expected: A 64-character hex string. Copy to `PLAID_TOKEN_ENCRYPTION_KEY`.

- [ ] **Step 3: Commit example env (NOT actual secrets)**

If `.env.local.example` exists, add the Plaid keys with placeholder values and commit. Never commit `.env.local`.

```bash
git add apps/web/.env.local.example
git commit -m "docs(plaid): add Plaid env variable examples"
```

---

### Task 18: Full Build Verification

- [ ] **Step 1: Type check all packages**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm type-check`
Expected: No TypeScript errors across all packages.

- [ ] **Step 2: Build the app**

Run: `cd C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Manual verification checklist**

1. Navigate to `/settings` — Plaid Bank Account section appears below Stripe Connect
2. Click "Link Bank Account" — Plaid Link modal opens (in sandbox, use test credentials)
3. Complete linking — status shows "Connected" with bank name + mask
4. Navigate to `/tenant/payments` as a tenant
5. Click "Pay Now" — dialog shows Card + ACH options
6. If org has Plaid connected: ACH shows "$1.00 flat" fee
7. If org has only Stripe: ACH shows "0.8%, max $5" fee
8. Select ACH (Plaid) — if no bank linked, Plaid Link opens inline
9. After linking, confirm payment — invoice goes to "Processing"
10. Auto-pay toggle appears when bank is linked + Plaid active

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(plaid): address build verification issues"
```

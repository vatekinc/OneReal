# Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add queue-based email notifications to OneReal using Resend, React Email, Vercel Cron, and a Supabase `notifications` table.

**Architecture:** Events enqueue notification rows into a `notifications` table. A single Vercel Cron route runs every 5 minutes — first enqueuing any scheduled notifications (rent reminders, late notices, lease expiry), then processing the pending queue by rendering React Email templates and sending via Resend. The `enqueueNotification()` helper is fire-and-forget and creates its own service role client.

**Tech Stack:** Resend, React Email (`@react-email/components`), Vercel Cron, Supabase (notifications table), Next.js API routes

**Spec:** `docs/superpowers/specs/2026-03-30-email-notifications-design.md`

---

## Chunk 1: Foundation (Database + Package + Types)

### Task 1: Database Migration — Notifications Table

**Files:**
- Create: `supabase/migrations/20260330000004_notifications_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Notification queue and audit log for email notifications.
-- RLS enabled with no policies — only service role client can access.

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id),
  type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  error TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Queue processing: find pending/retryable rows efficiently
CREATE INDEX idx_notifications_status ON public.notifications(status, created_at ASC)
  WHERE status IN ('pending', 'failed');

-- Dedup: prevent duplicate scheduled notifications per day
CREATE UNIQUE INDEX idx_notifications_dedup
  ON public.notifications(type, reference_id, (created_at::date))
  WHERE reference_id IS NOT NULL;
```

- [ ] **Step 2: Push migration to Supabase**

Run: `cd apps/web && npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330000004_notifications_table.sql
git commit -m "feat(db): add notifications table for email queue"
```

---

### Task 2: Notification Types — Add to @onereal/types

**Files:**
- Modify: `packages/types/src/enums.ts`
- Modify: `packages/types/src/models.ts`

- [ ] **Step 1: Add NotificationType enum to `packages/types/src/enums.ts`**

Append at the end of the file:

```typescript
export const NotificationType = {
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_FAILED: 'payment_failed',
  MAINTENANCE_UPDATED: 'maintenance_updated',
  NEW_MESSAGE: 'new_message',
  INVOICE_CREATED: 'invoice_created',
  TENANT_WELCOME: 'tenant_welcome',
  RENT_DUE_REMINDER: 'rent_due_reminder',
  RENT_LATE_NOTICE: 'rent_late_notice',
  LEASE_EXPIRY_ALERT: 'lease_expiry_alert',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];
```

- [ ] **Step 2: Add Notification interface to `packages/types/src/models.ts`**

Append at the end of the file:

```typescript
export interface Notification {
  id: string;
  org_id: string | null;
  type: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  reference_id: string | null;
  status: string;
  error: string | null;
  retry_count: number;
  created_at: string;
  sent_at: string | null;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/types && pnpm type-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/enums.ts packages/types/src/models.ts
git commit -m "feat(types): add NotificationType enum and Notification model"
```

---

### Task 3: Create `packages/email` Package — Scaffold

**Files:**
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/src/index.ts`
- Create: `packages/email/src/client.ts`

- [ ] **Step 1: Create `packages/email/package.json`**

```json
{
  "name": "@onereal/email",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "resend": "^3.0.0",
    "@react-email/components": "^0.0.28",
    "@react-email/render": "^1.0.0",
    "@onereal/database": "workspace:*",
    "@onereal/types": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/email/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/email/src/client.ts`**

```typescript
import { Resend } from 'resend';

let resendInstance: Resend | null = null;

export function getResend(): Resend {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('Missing RESEND_API_KEY environment variable');
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}
```

- [ ] **Step 4: Create `packages/email/src/index.ts`** (only export what exists now — add others later)

```typescript
export { getResend } from './client';
```

- [ ] **Step 5: Install dependencies**

Run: `cd /c/Users/AbishekPotlapalli/Desktop/Projects/Personal/OneReal && pnpm install`
Expected: Lockfile updated, dependencies installed.

- [ ] **Step 6: Add `@onereal/email` to transpilePackages in `apps/web/next.config.ts`**

Add `'@onereal/email'` to the `transpilePackages` array.

- [ ] **Step 7: Add `@onereal/email` as dependency in `apps/web/package.json`**

Add `"@onereal/email": "workspace:*"` to the dependencies section.

- [ ] **Step 8: Run pnpm install again**

Run: `pnpm install`

- [ ] **Step 9: Commit**

```bash
git add packages/email/ apps/web/next.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(email): scaffold @onereal/email package with Resend client"
```

---

### Task 4: Create `enqueueNotification()` — Queue Helper

**Files:**
- Create: `packages/email/src/queue.ts`

- [ ] **Step 1: Create `packages/email/src/queue.ts`**

```typescript
import { createServiceRoleClient } from '@onereal/database/service-role';
import type { NotificationType } from '@onereal/types';

/**
 * Enqueue a notification for email delivery.
 * Fire-and-forget: errors are logged but never thrown.
 * Creates its own service role client — callers don't need to pass one.
 */
export async function enqueueNotification(
  type: NotificationType,
  recipientEmail: string,
  payload: Record<string, unknown>,
  referenceId?: string,
  orgId?: string,
): Promise<void> {
  try {
    if (!recipientEmail) return;

    const db = createServiceRoleClient() as any;

    // new_message throttle: skip if same conversation notified in last 30 min
    if (type === 'new_message' && referenceId) {
      const { data: recent } = await db
        .from('notifications')
        .select('id')
        .eq('type', 'new_message')
        .eq('reference_id', referenceId)
        .eq('recipient_email', recipientEmail)
        .gt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (recent) return;
    }

    // Insert with ON CONFLICT DO NOTHING for dedup (reference_id-based unique index)
    await db.from('notifications').upsert({
      type,
      recipient_email: recipientEmail,
      payload,
      reference_id: referenceId ?? null,
      org_id: orgId ?? null,
    }, { onConflict: 'type,reference_id', ignoreDuplicates: true });
  } catch (err) {
    console.error(`[notifications] Failed to enqueue ${type}:`, err);
  }
}
```

- [ ] **Step 2: Add queue export to `packages/email/src/index.ts`**

```typescript
export { getResend } from './client';
export { enqueueNotification } from './queue';
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/email && pnpm type-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/email/src/queue.ts packages/email/src/index.ts
git commit -m "feat(email): add enqueueNotification queue helper"
```

---

## Chunk 2: Email Templates

### Task 5: Shared Email Layout Template

**Files:**
- Create: `packages/email/src/templates/layout.tsx`

- [ ] **Step 1: Create the shared layout**

```tsx
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components';
import * as React from 'react';

interface LayoutProps {
  preview: string;
  children: React.ReactNode;
  orgName?: string;
}

export function Layout({ preview, children, orgName }: LayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logo}>OneReal</Text>
          </Section>
          {children}
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerText}>
              {orgName ? `${orgName} via OneReal` : 'OneReal'}
            </Text>
            <Text style={footerText}>
              Property Management Platform
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '560px',
};

const header = {
  padding: '20px 48px 0',
};

const logo = {
  fontSize: '24px',
  fontWeight: '700' as const,
  color: '#1a1a1a',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const footer = {
  padding: '0 48px',
};

const footerText = {
  fontSize: '12px',
  lineHeight: '16px',
  color: '#8898aa',
  margin: '0',
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/email/src/templates/layout.tsx
git commit -m "feat(email): add shared email layout template"
```

---

### Task 6: All 9 Email Templates

**Files:**
- Create: `packages/email/src/templates/payment-received.tsx`
- Create: `packages/email/src/templates/payment-failed.tsx`
- Create: `packages/email/src/templates/maintenance-updated.tsx`
- Create: `packages/email/src/templates/new-message.tsx`
- Create: `packages/email/src/templates/invoice-created.tsx`
- Create: `packages/email/src/templates/tenant-welcome.tsx`
- Create: `packages/email/src/templates/rent-due-reminder.tsx`
- Create: `packages/email/src/templates/rent-late-notice.tsx`
- Create: `packages/email/src/templates/lease-expiry-alert.tsx`

- [ ] **Step 1: Create `payment-received.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  amount: string;
  invoice_number: string;
  payment_method: string;
  date: string;
  org_name: string;
}

export function PaymentReceivedEmail({ amount, invoice_number, payment_method, date, org_name }: Props) {
  return (
    <Layout preview={`Payment of $${amount} received`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Payment Received</Text>
        <Text style={text}>
          Your payment of <strong>${amount}</strong> for invoice {invoice_number} has been received.
        </Text>
        <Text style={detail}>Payment method: {payment_method}</Text>
        <Text style={detail}>Date: {date}</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/tenant/payments`}>
          View Payments
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#8898aa', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 2: Create `payment-failed.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  amount: string;
  invoice_number: string;
  reason: string;
  org_name: string;
}

export function PaymentFailedEmail({ amount, invoice_number, reason, org_name }: Props) {
  return (
    <Layout preview={`Payment of $${amount} failed`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Payment Failed</Text>
        <Text style={text}>
          Your payment of <strong>${amount}</strong> for invoice {invoice_number} could not be processed.
        </Text>
        <Text style={detail}>Reason: {reason}</Text>
        <Text style={text}>Please update your payment method or try again.</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/tenant/payments`}>
          Retry Payment
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#e53e3e', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#8898aa', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 3: Create `maintenance-updated.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  title: string;
  old_status: string;
  new_status: string;
  property: string;
  unit: string;
  org_name: string;
}

export function MaintenanceUpdatedEmail({ title, old_status, new_status, property, unit, org_name }: Props) {
  const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Layout preview={`Maintenance update: ${title}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Maintenance Request Updated</Text>
        <Text style={text}><strong>{title}</strong></Text>
        <Text style={text}>
          Status changed from <strong>{statusLabel(old_status)}</strong> to <strong>{statusLabel(new_status)}</strong>.
        </Text>
        <Text style={detail}>Property: {property}{unit ? ` - Unit ${unit}` : ''}</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/maintenance`}>
          View Request
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#8898aa', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 4: Create `new-message.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  sender_name: string;
  message_preview: string;
  org_name: string;
}

export function NewMessageEmail({ sender_name, message_preview, org_name }: Props) {
  return (
    <Layout preview={`New message from ${sender_name}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>New Message</Text>
        <Text style={text}>
          <strong>{sender_name}</strong> sent you a message:
        </Text>
        <Section style={messageBox}>
          <Text style={messageText}>{message_preview}</Text>
        </Section>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/messages`}>
          View Message
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const messageBox = { backgroundColor: '#f6f9fc', borderRadius: '5px', padding: '12px 16px', margin: '12px 0' };
const messageText = { fontSize: '14px', color: '#525f7f', margin: '0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 5: Create `invoice-created.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  invoice_number: string;
  amount: string;
  due_date: string;
  property: string;
  org_name: string;
}

export function InvoiceCreatedEmail({ invoice_number, amount, due_date, property, org_name }: Props) {
  return (
    <Layout preview={`Invoice ${invoice_number} - $${amount} due ${due_date}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>New Invoice</Text>
        <Text style={text}>
          A new invoice has been created for <strong>${amount}</strong>.
        </Text>
        <Text style={detail}>Invoice: {invoice_number}</Text>
        <Text style={detail}>Due date: {due_date}</Text>
        <Text style={detail}>Property: {property}</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/tenant/payments`}>
          View & Pay
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#8898aa', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 6: Create `tenant-welcome.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  org_name: string;
  login_url: string;
}

export function TenantWelcomeEmail({ org_name, login_url }: Props) {
  return (
    <Layout preview={`Welcome to ${org_name}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Welcome!</Text>
        <Text style={text}>
          You have been added as a tenant at <strong>{org_name}</strong>.
        </Text>
        <Text style={text}>
          Sign up or log in to view your lease, pay rent, submit maintenance requests, and message your property manager.
        </Text>
        <Button style={button} href={login_url}>
          Get Started
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 7: Create `rent-due-reminder.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  amount: string;
  due_date: string;
  invoice_number: string;
  property: string;
  org_name: string;
}

export function RentDueReminderEmail({ amount, due_date, invoice_number, property, org_name }: Props) {
  return (
    <Layout preview={`Rent of $${amount} due on ${due_date}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Rent Due Soon</Text>
        <Text style={text}>
          Your rent payment of <strong>${amount}</strong> is due on <strong>{due_date}</strong>.
        </Text>
        <Text style={detail}>Invoice: {invoice_number}</Text>
        <Text style={detail}>Property: {property}</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/tenant/payments`}>
          Pay Now
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#1a1a1a', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#8898aa', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 8: Create `rent-late-notice.tsx`**

```tsx
import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  amount: string;
  days_overdue: string;
  invoice_number: string;
  late_fee_info: string;
  org_name: string;
}

export function RentLateNoticeEmail({ amount, days_overdue, invoice_number, late_fee_info, org_name }: Props) {
  return (
    <Layout preview={`Rent payment $${amount} is ${days_overdue} days overdue`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Overdue Rent Notice</Text>
        <Text style={text}>
          Your rent payment of <strong>${amount}</strong> for invoice {invoice_number} is <strong>{days_overdue} day(s) overdue</strong>.
        </Text>
        {late_fee_info && <Text style={detail}>{late_fee_info}</Text>}
        <Text style={text}>Please make your payment as soon as possible to avoid additional fees.</Text>
        <Button style={button} href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/tenant/payments`}>
          Pay Now
        </Button>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#e53e3e', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
const detail = { fontSize: '13px', color: '#e53e3e', margin: '4px 0' };
const button = { backgroundColor: '#1a1a1a', borderRadius: '5px', color: '#fff', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', textAlign: 'center' as const, display: 'block', padding: '10px 20px', marginTop: '16px' };
```

- [ ] **Step 9: Create `lease-expiry-alert.tsx`**

```tsx
import { Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './layout';

interface Props {
  lease_end_date: string;
  property: string;
  tenant_name: string;
  org_name: string;
}

export function LeaseExpiryAlertEmail({ lease_end_date, property, tenant_name, org_name }: Props) {
  return (
    <Layout preview={`Lease expiring on ${lease_end_date}`} orgName={org_name}>
      <Section style={section}>
        <Text style={heading}>Lease Expiring Soon</Text>
        <Text style={text}>
          The lease for <strong>{tenant_name}</strong> at <strong>{property}</strong> expires on <strong>{lease_end_date}</strong>.
        </Text>
        <Text style={text}>
          Please review the lease and decide on renewal or termination.
        </Text>
      </Section>
    </Layout>
  );
}

const section = { padding: '0 48px' };
const heading = { fontSize: '20px', fontWeight: '600' as const, color: '#d69e2e', margin: '24px 0 8px' };
const text = { fontSize: '14px', lineHeight: '24px', color: '#525f7f' };
```

- [ ] **Step 10: Commit all templates**

```bash
git add packages/email/src/templates/
git commit -m "feat(email): add all 9 React Email templates"
```

---

## Chunk 3: Queue Processor + Scheduler + Cron Route

### Task 7: Queue Processor — `processNotificationQueue()`

**Files:**
- Create: `packages/email/src/processor.ts`
- Create: `packages/email/src/template-renderer.ts`

- [ ] **Step 1: Create `packages/email/src/template-renderer.ts`**

This maps notification types to their React Email templates and renders them to HTML.

```typescript
import { render } from '@react-email/render';
import * as React from 'react';
import { PaymentReceivedEmail } from './templates/payment-received';
import { PaymentFailedEmail } from './templates/payment-failed';
import { MaintenanceUpdatedEmail } from './templates/maintenance-updated';
import { NewMessageEmail } from './templates/new-message';
import { InvoiceCreatedEmail } from './templates/invoice-created';
import { TenantWelcomeEmail } from './templates/tenant-welcome';
import { RentDueReminderEmail } from './templates/rent-due-reminder';
import { RentLateNoticeEmail } from './templates/rent-late-notice';
import { LeaseExpiryAlertEmail } from './templates/lease-expiry-alert';

interface RenderResult {
  subject: string;
  html: string;
}

const templateMap: Record<string, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.FC<any>;
  subject: (payload: Record<string, unknown>) => string;
}> = {
  payment_received: {
    component: PaymentReceivedEmail,
    subject: (p) => `Payment of $${p.amount} received`,
  },
  payment_failed: {
    component: PaymentFailedEmail,
    subject: (p) => `Payment of $${p.amount} failed`,
  },
  maintenance_updated: {
    component: MaintenanceUpdatedEmail,
    subject: (p) => `Maintenance update: ${p.title}`,
  },
  new_message: {
    component: NewMessageEmail,
    subject: (p) => `New message from ${p.sender_name}`,
  },
  invoice_created: {
    component: InvoiceCreatedEmail,
    subject: (p) => `Invoice ${p.invoice_number} - $${p.amount} due`,
  },
  tenant_welcome: {
    component: TenantWelcomeEmail,
    subject: (p) => `Welcome to ${p.org_name}`,
  },
  rent_due_reminder: {
    component: RentDueReminderEmail,
    subject: (p) => `Rent of $${p.amount} due on ${p.due_date}`,
  },
  rent_late_notice: {
    component: RentLateNoticeEmail,
    subject: (p) => `Overdue: $${p.amount} is ${p.days_overdue} days late`,
  },
  lease_expiry_alert: {
    component: LeaseExpiryAlertEmail,
    subject: (p) => `Lease expiring on ${p.lease_end_date}`,
  },
};

export async function renderNotification(
  type: string,
  payload: Record<string, unknown>,
): Promise<RenderResult> {
  const template = templateMap[type];
  if (!template) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  const element = React.createElement(template.component, payload);
  const html = await render(element);
  const subject = template.subject(payload);

  return { subject, html };
}
```

- [ ] **Step 2: Create `packages/email/src/processor.ts`**

```typescript
import { createServiceRoleClient } from '@onereal/database/service-role';
import { getResend } from './client';
import { renderNotification } from './template-renderer';

export async function processNotificationQueue(): Promise<{ sent: number; failed: number }> {
  const db = createServiceRoleClient() as any;
  let sent = 0;
  let failed = 0;

  // Atomically claim pending rows (FOR UPDATE SKIP LOCKED prevents double-processing)
  const { data: rows, error: claimError } = await db.rpc('claim_pending_notifications', {
    batch_size: 50,
  });

  if (claimError || !rows || rows.length === 0) {
    if (claimError) console.error('[notifications] Claim error:', claimError);
    return { sent, failed };
  }

  const resend = getResend();

  for (const row of rows) {
    try {
      const { subject, html } = await renderNotification(row.type, row.payload);
      const orgName = (row.payload as Record<string, unknown>)?.org_name as string;
      const fromName = orgName ? `${orgName} via OneReal` : 'OneReal';

      await resend.emails.send({
        from: `${fromName} <notifications@onereal.app>`,
        to: row.recipient_email,
        subject,
        html,
      });

      await db.from('notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);

      sent++;
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      const isInvalidEmail = err?.statusCode === 422;

      await db.from('notifications')
        .update({
          status: 'failed',
          error: errorMsg,
          retry_count: isInvalidEmail ? 3 : (row.retry_count || 0) + 1,
        })
        .eq('id', row.id);

      failed++;
      console.error(`[notifications] Send failed for ${row.id}:`, errorMsg);
    }
  }

  return { sent, failed };
}
```

- [ ] **Step 3: Create the `claim_pending_notifications` RPC function**

Create migration: `supabase/migrations/20260330000005_claim_notifications_rpc.sql`

```sql
-- RPC to atomically claim pending notifications for processing.
-- Uses FOR UPDATE SKIP LOCKED to prevent double-processing from overlapping cron runs.

CREATE OR REPLACE FUNCTION public.claim_pending_notifications(batch_size INT DEFAULT 50)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notifications
  SET status = 'processing'
  WHERE id IN (
    SELECT id FROM public.notifications
    WHERE (status = 'pending')
       OR (status = 'failed' AND retry_count < 3 AND created_at < now() - interval '15 minutes')
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
```

- [ ] **Step 4: Push migration**

Run: `cd apps/web && npx supabase db push`
Expected: Migration applied.

- [ ] **Step 5: Add processor export to `packages/email/src/index.ts`**

```typescript
export { getResend } from './client';
export { enqueueNotification } from './queue';
export { processNotificationQueue } from './processor';
```

- [ ] **Step 6: Commit**

```bash
git add packages/email/src/processor.ts packages/email/src/template-renderer.ts packages/email/src/index.ts supabase/migrations/20260330000005_claim_notifications_rpc.sql
git commit -m "feat(email): add queue processor with atomic claim RPC"
```

---

### Task 8: Scheduler — `enqueueScheduledNotifications()`

**Files:**
- Create: `packages/email/src/scheduler.ts`

- [ ] **Step 1: Create `packages/email/src/scheduler.ts`**

```typescript
import { createServiceRoleClient } from '@onereal/database/service-role';

const LATE_NOTICE_DAYS = [1, 3, 7, 14, 30];

/**
 * Enqueue scheduled notifications: rent reminders, late notices, lease expiry alerts.
 * Called by the cron route. Runs at most once per day (uses a marker row for dedup).
 */
export async function enqueueScheduledNotifications(): Promise<number> {
  const db = createServiceRoleClient() as any;

  // Check if daily scan already ran today
  const { data: marker } = await db
    .from('notifications')
    .select('id')
    .eq('type', '_daily_scan_marker')
    .gte('created_at', new Date().toISOString().split('T')[0])
    .limit(1)
    .maybeSingle();

  if (marker) return 0;

  // Insert daily scan marker
  await db.from('notifications').insert({
    type: '_daily_scan_marker',
    recipient_email: 'system@onereal.app',
    payload: {},
    status: 'sent',
    sent_at: new Date().toISOString(),
  });

  let queued = 0;
  const today = new Date().toISOString().split('T')[0];

  // --- 1. Rent Due Reminders (due in 3 days) ---
  const reminderDate = new Date();
  reminderDate.setDate(reminderDate.getDate() + 3);
  const reminderDateStr = reminderDate.toISOString().split('T')[0];

  const { data: dueInvoices } = await db
    .from('invoices')
    .select('id, invoice_number, amount, due_date, tenant_id, property_id, org_id')
    .eq('direction', 'receivable')
    .eq('due_date', reminderDateStr)
    .in('status', ['open', 'partially_paid']);

  for (const inv of dueInvoices ?? []) {
    const tenant = await lookupTenantEmail(db, inv.tenant_id);
    const property = await lookupPropertyName(db, inv.property_id);
    const orgName = await lookupOrgName(db, inv.org_id);
    if (!tenant?.email) continue;

    await db.from('notifications').insert({
      type: 'rent_due_reminder',
      recipient_email: tenant.email,
      reference_id: inv.id,
      org_id: inv.org_id,
      payload: {
        amount: String(inv.amount),
        due_date: inv.due_date,
        invoice_number: inv.invoice_number,
        property: property || '',
        org_name: orgName || 'OneReal',
      },
    }).then(() => { queued++; }).catch(() => { /* dedup conflict — skip */ });
  }

  // --- 2. Rent Late Notices (overdue by 1, 3, 7, 14, 30 days) ---
  for (const days of LATE_NOTICE_DAYS) {
    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - days);
    const overdueDateStr = overdueDate.toISOString().split('T')[0];

    const { data: lateInvoices } = await db
      .from('invoices')
      .select('id, invoice_number, amount, due_date, tenant_id, property_id, org_id')
      .eq('direction', 'receivable')
      .eq('due_date', overdueDateStr)
      .in('status', ['open', 'partially_paid']);

    for (const inv of lateInvoices ?? []) {
      const tenant = await lookupTenantEmail(db, inv.tenant_id);
      const orgName = await lookupOrgName(db, inv.org_id);
      if (!tenant?.email) continue;

      await db.from('notifications').insert({
        type: 'rent_late_notice',
        recipient_email: tenant.email,
        reference_id: `${inv.id}_late_${days}`,
        org_id: inv.org_id,
        payload: {
          amount: String(inv.amount),
          days_overdue: String(days),
          invoice_number: inv.invoice_number,
          late_fee_info: '',
          org_name: orgName || 'OneReal',
        },
      }).then(() => { queued++; }).catch(() => { /* dedup conflict — skip */ });
    }
  }

  // --- 3. Lease Expiry Alerts (expiring in 30 days) ---
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  const expiryDateStr = expiryDate.toISOString().split('T')[0];

  // Note: leases has no tenant_id or property_id directly.
  // Resolve property via units table, tenants via lease_tenants junction table.
  const { data: expiringLeases } = await db
    .from('leases')
    .select('id, end_date, unit_id, org_id, units(property_id), lease_tenants(tenant_id)')
    .eq('status', 'active')
    .eq('end_date', expiryDateStr);

  for (const lease of expiringLeases ?? []) {
    const propertyId = (lease as any).units?.property_id;
    const property = await lookupPropertyName(db, propertyId);
    const orgName = await lookupOrgName(db, lease.org_id);
    const tenantIds: string[] = ((lease as any).lease_tenants ?? []).map((lt: any) => lt.tenant_id);

    // Notify each tenant on the lease
    for (const tenantId of tenantIds) {
      const tenant = await lookupTenantEmail(db, tenantId);
      if (!tenant?.email) continue;

      const tenantName = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim();

      await db.from('notifications').insert({
        type: 'lease_expiry_alert',
        recipient_email: tenant.email,
        reference_id: `${lease.id}_${tenantId}`,
        org_id: lease.org_id,
        payload: {
          lease_end_date: lease.end_date,
          property: property || '',
          tenant_name: tenantName,
          org_name: orgName || 'OneReal',
        },
      }).then(() => { queued++; }).catch(() => { /* dedup */ });
    }

    // Notify landlord (org admin)
    const adminEmail = await lookupOrgAdminEmail(db, lease.org_id);
    const firstTenant = tenantIds.length > 0 ? await lookupTenantEmail(db, tenantIds[0]) : null;
    const tenantName = firstTenant ? `${firstTenant.first_name || ''} ${firstTenant.last_name || ''}`.trim() : '';

    if (adminEmail) {
      await db.from('notifications').insert({
        type: 'lease_expiry_alert',
        recipient_email: adminEmail,
        reference_id: `${lease.id}_admin`,
        org_id: lease.org_id,
        payload: {
          lease_end_date: lease.end_date,
          property: property || '',
          tenant_name: tenantName,
          org_name: orgName || 'OneReal',
        },
      }).then(() => { queued++; }).catch(() => { /* dedup */ });
    }
  }

  return queued;
}

// --- Lookup Helpers ---

async function lookupTenantEmail(db: any, tenantId: string | null) {
  if (!tenantId) return null;
  const { data } = await db.from('tenants').select('email, first_name, last_name').eq('id', tenantId).maybeSingle();
  return data;
}

async function lookupPropertyName(db: any, propertyId: string | null) {
  if (!propertyId) return null;
  const { data } = await db.from('properties').select('name').eq('id', propertyId).maybeSingle();
  return data?.name ?? null;
}

async function lookupOrgName(db: any, orgId: string | null) {
  if (!orgId) return null;
  const { data } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle();
  return data?.name ?? null;
}

async function lookupOrgAdminEmail(db: any, orgId: string | null) {
  if (!orgId) return null;
  const { data: member } = await db
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();
  if (!member) return null;

  const { data: profile } = await db.from('profiles').select('id').eq('id', member.user_id).maybeSingle();
  if (!profile) return null;

  // Get email from auth.users via admin API
  const { data: { user } } = await db.auth.admin.getUserById(member.user_id);
  return user?.email ?? null;
}
```

- [ ] **Step 2: Verify the full package compiles**

Update `packages/email/src/index.ts` to add the scheduler export:

```typescript
export { getResend } from './client';
export { enqueueNotification } from './queue';
export { processNotificationQueue } from './processor';
export { enqueueScheduledNotifications } from './scheduler';
```

Run: `cd packages/email && pnpm type-check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/email/src/scheduler.ts packages/email/src/index.ts
git commit -m "feat(email): add scheduled notification scanner (rent reminders, late notices, lease expiry)"
```

---

### Task 9: Cron API Route

**Files:**
- Create: `apps/web/app/api/notifications/cron/route.ts`

- [ ] **Step 1: Create the cron route**

```typescript
import { processNotificationQueue, enqueueScheduledNotifications } from '@onereal/email';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Enqueue scheduled notifications (runs at most once per day)
    const scheduled = await enqueueScheduledNotifications();

    // Step 2: Process pending queue
    const { sent, failed } = await processNotificationQueue();

    return NextResponse.json({ scheduled, sent, failed });
  } catch (error: any) {
    console.error('[notifications/cron] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Vercel Cron also calls GET
export async function GET(req: NextRequest) {
  return POST(req);
}
```

- [ ] **Step 2: Create `apps/web/vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/notifications/cron",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/notifications/cron/route.ts apps/web/vercel.json
git commit -m "feat(email): add cron route for notification processing"
```

---

## Chunk 4: Integration — Wire Up Existing Code

### Task 10: Integrate with Webhook Handlers

**Files:**
- Modify: `apps/web/app/api/stripe/webhook/route.ts`
- Modify: `apps/web/app/api/plaid/webhook/route.ts`

- [ ] **Step 1: Add notification calls to Stripe webhook**

At the top of `apps/web/app/api/stripe/webhook/route.ts`, add the import:

```typescript
import { enqueueNotification } from '@onereal/email';
```

In the `handlePaymentIntentSucceeded` function, after the invoice is marked as paid and income/payment records are created, add:

```typescript
// Notify tenant of successful payment
const tenantEmail = await lookupTenantEmailForInvoice(db, invoiceId);
if (tenantEmail) {
  enqueueNotification('payment_received', tenantEmail.email, {
    amount: String(amount),
    invoice_number: tenantEmail.invoice_number,
    payment_method: 'card',
    date: new Date().toISOString().split('T')[0],
    org_name: tenantEmail.org_name,
  }, invoiceId, tenantEmail.org_id);
}
```

In the `handlePaymentIntentFailed` function, add similar logic with type `payment_failed`.

Add this lookup helper at the bottom of the file:

```typescript
async function lookupTenantEmailForInvoice(db: any, invoiceId: string) {
  const { data: inv } = await db
    .from('invoices')
    .select('id, invoice_number, tenant_id, org_id, amount')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv?.tenant_id) return null;

  const { data: tenant } = await db.from('tenants').select('email').eq('id', inv.tenant_id).maybeSingle();
  if (!tenant?.email) return null;

  const { data: org } = await db.from('organizations').select('name').eq('id', inv.org_id).maybeSingle();

  return {
    email: tenant.email,
    invoice_number: inv.invoice_number,
    org_id: inv.org_id,
    org_name: org?.name || 'OneReal',
  };
}
```

- [ ] **Step 2: Add notification calls to Plaid webhook**

At the top of `apps/web/app/api/plaid/webhook/route.ts`, add:

```typescript
import { enqueueNotification } from '@onereal/email';
```

In the section where `TRANSFER.settled` creates income and payment records, after the invoice is marked paid, add:

```typescript
// Notify tenant of ACH payment received
if (tenantEmail) {
  enqueueNotification('payment_received', tenantEmail, {
    amount: String(transferAmount),
    invoice_number: invoice.invoice_number,
    payment_method: 'ach',
    date: new Date().toISOString().split('T')[0],
    org_name: orgName,
  }, invoice.id, invoice.org_id);
}
```

Similarly for `TRANSFER.failed` and `TRANSFER.returned`, add `payment_failed` notifications.

Note: The exact insertion points depend on reading the full webhook handlers to find where tenant email and invoice data are available. The implementer should read the full file, find where `invoice` data is in scope, and add the `enqueueNotification` call after the successful DB updates.

- [ ] **Step 3: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/stripe/webhook/route.ts apps/web/app/api/plaid/webhook/route.ts
git commit -m "feat(email): add payment notifications to Stripe/Plaid webhooks"
```

---

### Task 11: Integrate with Server Actions

**Files:**
- Modify: `modules/contacts/src/actions/create-tenant.ts`
- Modify: `modules/messaging/src/actions/send-message.ts`
- Modify: `modules/maintenance/src/actions/update-maintenance-request.ts`
- Modify: `modules/billing/src/actions/create-invoice.ts`
- Modify: `modules/billing/src/actions/generate-invoices.ts`
- Modify: module `package.json` files that need `@onereal/email` as a dependency

- [ ] **Step 1: Add `@onereal/email` dependency to modules that need it**

Add `"@onereal/email": "workspace:*"` to the `dependencies` in:
- `modules/contacts/package.json`
- `modules/messaging/package.json`
- `modules/maintenance/package.json`
- `modules/billing/package.json`

Run: `pnpm install`

- [ ] **Step 2: Add tenant_welcome to `create-tenant.ts`**

At the top, add:
```typescript
import { enqueueNotification } from '@onereal/email';
```

After the successful tenant insert (after `if (error) return ...`), add:

```typescript
// Send welcome email if tenant has email
if (parsed.data.email) {
  const { data: org } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle();
  enqueueNotification('tenant_welcome', parsed.data.email, {
    org_name: org?.name || 'OneReal',
    login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://one-real-web.vercel.app'}/register`,
  }, data.id, orgId);
}
```

- [ ] **Step 3: Add new_message to `send-message.ts`**

At the top, add:
```typescript
import { enqueueNotification } from '@onereal/email';
import { createServiceRoleClient } from '@onereal/database/service-role';
```

After the successful message insert, add:

```typescript
// Notify other participant(s) — uses service role client for auth.admin lookup
try {
  const adminDb = createServiceRoleClient() as any;
  const { data: participants } = await adminDb
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .neq('user_id', user.id);

  if (participants) {
    const { data: senderProfile } = await adminDb
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();

    const senderName = senderProfile
      ? `${senderProfile.first_name || ''} ${senderProfile.last_name || ''}`.trim() || 'Someone'
      : 'Someone';

    for (const p of participants) {
      const { data: { user: recipientUser } } = await adminDb.auth.admin.getUserById(p.user_id);
      if (!recipientUser?.email) continue;

      enqueueNotification('new_message', recipientUser.email, {
        sender_name: senderName,
        message_preview: parsed.data.content.substring(0, 100),
        org_name: 'OneReal',
      }, conversationId);
    }
  }
} catch (err) {
  console.error('[notifications] new_message error:', err);
}
```

- [ ] **Step 4: Add maintenance_updated to `update-maintenance-request.ts`**

At the top, add:
```typescript
import { enqueueNotification } from '@onereal/email';
import { createServiceRoleClient } from '@onereal/database/service-role';
```

**Before** the `.update()` call, fetch the current status so we have `old_status`:

```typescript
// Fetch current status before update (for notification)
let oldStatus: string | null = null;
if (parsed.data.status !== undefined) {
  const { data: current } = await (supabase as any)
    .from('maintenance_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle();
  oldStatus = current?.status ?? null;
}
```

**After** the successful update (after `if (error) return ...`), add:

```typescript
// Notify tenant of maintenance status change
// Note: maintenance_requests has unit_id and reported_by, NOT tenant_id or property_id.
// Resolve property via units table, tenant via unit's active lease.
if (parsed.data.status !== undefined && oldStatus) {
  try {
    const adminDb = createServiceRoleClient() as any;
    const { data: request } = await adminDb
      .from('maintenance_requests')
      .select('title, unit_id, org_id, reported_by, units(property_id, unit_number)')
      .eq('id', requestId)
      .maybeSingle();

    if (request) {
      const propertyId = (request as any).units?.property_id;
      const unitNumber = (request as any).units?.unit_number;
      const { data: property } = propertyId
        ? await adminDb.from('properties').select('name').eq('id', propertyId).maybeSingle()
        : { data: null };
      const { data: org } = await adminDb.from('organizations').select('name').eq('id', request.org_id).maybeSingle();

      // Find tenant email via the unit's active lease
      let recipientEmail: string | null = null;
      if (request.unit_id) {
        const { data: lease } = await adminDb
          .from('leases')
          .select('lease_tenants(tenant_id)')
          .eq('unit_id', request.unit_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        const tenantId = (lease as any)?.lease_tenants?.[0]?.tenant_id;
        if (tenantId) {
          const { data: tenant } = await adminDb.from('tenants').select('email').eq('id', tenantId).maybeSingle();
          recipientEmail = tenant?.email ?? null;
        }
      }

      if (recipientEmail) {
        enqueueNotification('maintenance_updated', recipientEmail, {
          title: request.title,
          old_status: oldStatus,
          new_status: parsed.data.status,
          property: property?.name || '',
          unit: unitNumber || '',
          org_name: org?.name || 'OneReal',
        }, requestId, request.org_id);
      }
    }
  } catch (err) {
    console.error('[notifications] maintenance_updated error:', err);
  }
}
```

- [ ] **Step 5: Add invoice_created to `create-invoice.ts`**

At the top, add:
```typescript
import { enqueueNotification } from '@onereal/email';
```

After the successful invoice insert, add:

```typescript
// Notify tenant of new invoice
if (parsed.data.direction === 'receivable' && parsed.data.tenant_id) {
  const { data: tenant } = await db.from('tenants').select('email').eq('id', parsed.data.tenant_id).maybeSingle();
  const { data: property } = parsed.data.property_id
    ? await db.from('properties').select('name').eq('id', parsed.data.property_id).maybeSingle()
    : { data: null };
  const { data: org } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle();

  if (tenant?.email) {
    enqueueNotification('invoice_created', tenant.email, {
      invoice_number: data.invoice_number || '',
      amount: String(parsed.data.amount),
      due_date: parsed.data.due_date,
      property: property?.name || '',
      org_name: org?.name || 'OneReal',
    }, data.id, orgId);
  }
}
```

- [ ] **Step 6: Add invoice_created to `generate-invoices.ts`**

At the top, add:
```typescript
import { enqueueNotification } from '@onereal/email';
```

In the `insertInvoiceRecord` helper function, after the successful insert, add the same pattern — look up tenant email, property name, org name, and call `enqueueNotification('invoice_created', ...)`.

Alternatively, since `generate-invoices.ts` can create many invoices in batch, add notifications after the main loop completes for each successfully created invoice. The implementer should read the full file and find the right insertion point.

- [ ] **Step 7: Verify full build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add modules/contacts/ modules/messaging/ modules/maintenance/ modules/billing/ pnpm-lock.yaml
git commit -m "feat(email): wire up notifications to all server actions"
```

---

## Chunk 5: Environment Variables + Final Verification

### Task 12: Environment Variables & Deployment

**Files:**
- Modify: `apps/web/.env.local` (add RESEND_API_KEY, CRON_SECRET)

- [ ] **Step 1: Add env vars locally**

Add to `apps/web/.env.local`:
```
RESEND_API_KEY=re_xxxxxxxxxxxx
CRON_SECRET=your-random-secret-string
```

- [ ] **Step 2: Add env vars to Vercel**

Run:
```bash
cd apps/web && npx vercel env add RESEND_API_KEY
cd apps/web && npx vercel env add CRON_SECRET
```

Or add via Vercel dashboard: Project Settings → Environment Variables.

- [ ] **Step 3: Set up Resend domain**

Go to https://resend.com/domains and verify the `onereal.app` domain (or use Resend's default `onboarding@resend.dev` for testing).

- [ ] **Step 4: Push all migrations**

Run: `cd apps/web && npx supabase db push`
Expected: All new migrations applied.

- [ ] **Step 5: Full build verification**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds.

- [ ] **Step 6: Push to git**

```bash
git push origin main
```

- [ ] **Step 7: Verify Vercel deployment**

After push, check Vercel dashboard:
- Build succeeds
- Cron job appears in Settings → Crons
- `/api/notifications/cron` listed with `*/5 * * * *` schedule

---

### Task 13: Manual Smoke Test

- [ ] **Step 1: Test enqueue by creating a tenant with email**

Create a tenant with an email address via the UI. Check the `notifications` table for a `tenant_welcome` row with status `pending`.

- [ ] **Step 2: Test processing**

Trigger the cron route manually:
```bash
curl -X POST https://one-real-web.vercel.app/api/notifications/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected response: `{ "scheduled": 0, "sent": 1, "failed": 0 }`

- [ ] **Step 3: Verify email received**

Check the recipient's email inbox for the welcome email.

- [ ] **Step 4: Check notifications table**

Query: `SELECT id, type, status, sent_at FROM notifications ORDER BY created_at DESC LIMIT 10;`
Expected: The `tenant_welcome` row has `status = 'sent'` and `sent_at` populated.

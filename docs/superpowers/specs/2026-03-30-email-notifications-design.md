# Email Notifications — Design Spec

> Automated email notifications for OneReal property management platform.

## Overview

Add a queue-based email notification system that sends transactional emails to tenants and landlords for key events: payments, maintenance updates, messages, invoices, rent reminders, late notices, and lease expiry alerts.

**Stack:** Resend (email API) + React Email (templates) + Vercel Cron (scheduling) + Supabase `notifications` table (queue + audit log).

---

## Architecture

### Components

1. **`notifications` table** — Queue and audit log. Every notification is a row with status (`pending` → `processing` → `sent` → `failed`), type, recipient, payload, and timestamps.

2. **`packages/email` package** — New monorepo package containing:
   - Resend client wrapper
   - React Email templates (one per notification type)
   - `enqueueNotification()` — inserts a row into the queue (creates its own service role client internally)
   - `processNotificationQueue()` — reads pending rows, renders templates, sends via Resend, updates status

3. **Single API route:**
   - `POST /api/notifications/cron` — Called by Vercel Cron every 5 minutes. First enqueues any scheduled notifications (rent reminders, late notices, lease expiry), then processes the pending queue. Consolidated into one route to stay within Vercel Hobby's 2-cron-job limit (the other slot is reserved for `/api/plaid/auto-pay`).

### Flow

```
Event happens (payment, maintenance update, etc.)
  → enqueueNotification() inserts row into notifications table (status: pending)
  → Vercel Cron runs /api/notifications/cron every 5 min
  → Step 1: enqueueScheduledNotifications() — once per day, scans for
    upcoming rent, overdue invoices, expiring leases, inserts rows
  → Step 2: processNotificationQueue() picks up pending rows (LIMIT 50)
    → Sets status = 'processing' to prevent double-sends from overlapping runs
    → Renders React Email template using type + payload
    → Sends via Resend API
    → On success: status → sent, sent_at → now()
    → On failure: status → failed, error stored, retry_count incremented
```

The daily scan runs at most once per day by checking a simple guard: `SELECT 1 FROM notifications WHERE type = '_daily_scan_marker' AND created_at::date = CURRENT_DATE`. If the marker exists, skip the scan.

### Auth for Cron Routes

Cron routes validate `Authorization: Bearer <CRON_SECRET>` header. Vercel sends this automatically when the `CRON_SECRET` env var is set in project settings. Note: the existing `/api/plaid/auto-pay` route uses `SUPABASE_SERVICE_ROLE_KEY` for auth — a follow-up task should migrate it to `CRON_SECRET` for consistency.

---

## Database

### `notifications` table

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
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

-- Queue processing index: find pending/failed rows efficiently
CREATE INDEX idx_notifications_status ON notifications(status, created_at ASC)
  WHERE status IN ('pending', 'failed');

-- Dedup index: prevent duplicate scheduled notifications per day
CREATE UNIQUE INDEX idx_notifications_dedup
  ON notifications(type, reference_id, (created_at::date))
  WHERE reference_id IS NOT NULL;
```

**RLS:** Enabled but no policies — only the service role client can access this table. The `enqueueNotification()` function creates its own service role client internally, so callers (server actions, webhooks) don't need to worry about client type.

**Dedup:** Uses `INSERT ... ON CONFLICT DO NOTHING` against the unique dedup index. No SELECT-then-INSERT race condition.

### Cleanup

Out of scope for MVP. Future: a weekly cron deletes sent notifications older than 90 days.

---

## Notification Types

### Event-Triggered (enqueued when event occurs)

| Type | Trigger Point | Recipient | Payload Fields |
|------|--------------|-----------|----------------|
| `payment_received` | Stripe/Plaid webhook — payment success | Tenant | amount, invoice_number, payment_method, date, org_name |
| `payment_failed` | Stripe/Plaid webhook — payment failure | Tenant | amount, invoice_number, reason, org_name |
| `maintenance_updated` | `update-maintenance-request` action | Tenant or Landlord (opposite of updater) | title, old_status, new_status, property, unit, org_name |
| `new_message` | `send-message` action | Other conversation participant | sender_name, message_preview (100 chars), org_name |
| `invoice_created` | `generate-invoices` and `create-invoice` actions | Tenant | invoice_number, amount, due_date, property, org_name |
| `tenant_welcome` | `create-tenant` action (when tenant has email) | Tenant | org_name, login_url |

### Scheduled (enqueued by daily scan within cron route)

| Type | Query Logic | Recipient | Payload Fields |
|------|------------|-----------|----------------|
| `rent_due_reminder` | Open receivable invoices with `due_date` = today + 3 days | Tenant | amount, due_date, invoice_number, property, org_name |
| `rent_late_notice` | Open receivable invoices overdue by exactly 1, 3, 7, 14, or 30 days | Tenant | amount, days_overdue, invoice_number, late_fee_info, org_name |
| `lease_expiry_alert` | Active leases with `end_date` = today + 30 days | Landlord + Tenant | lease_end_date, property, tenant_name, org_name |

### Recipient Email Resolution

- **Tenant notifications** (payment, invoice, rent, lease): Look up `tenants.email` via `invoices.tenant_id → tenants.email` or `leases.tenant_id → tenants.email`.
- **Landlord notifications** (maintenance from tenant, lease expiry): Look up the org admin's email via `org_members(role='admin') → profiles.id → auth.users.email`.
- **Message notifications**: Look up via `conversation_participants → profiles.id → auth.users.email`.
- **Payment method field**: Set to `'ach'` for Plaid webhooks, derived from Stripe payment method type for Stripe webhooks.

### Deduplication & Throttling

- **Scheduled types:** Use `INSERT ... ON CONFLICT DO NOTHING` with the unique index on `(type, reference_id, created_at::date)`. Prevents duplicates if the cron runs multiple times.
- **`new_message` throttle:** Before inserting, `enqueueNotification` runs a SELECT guard: `SELECT 1 FROM notifications WHERE type = 'new_message' AND reference_id = $conv_id AND recipient_email = $email AND created_at > now() - interval '30 minutes'`. If a row exists, skip insertion. Prevents email spam during active conversations.
- **`rent_late_notice` frequency:** Only sent on days 1, 3, 7, 14, and 30 past due — not every day. This keeps volume manageable within Resend's free tier (100/day).

---

## Package Structure

```
packages/email/
├── package.json          # resend, @react-email/components
├── tsconfig.json
├── src/
│   ├── index.ts          # re-exports
│   ├── client.ts         # Resend client (RESEND_API_KEY)
│   ├── queue.ts          # enqueueNotification() — creates own service role client
│   ├── processor.ts      # processNotificationQueue()
│   ├── scheduler.ts      # enqueueScheduledNotifications() — daily scan logic
│   └── templates/
│       ├── layout.tsx         # Shared: OneReal logo, footer
│       ├── payment-received.tsx
│       ├── payment-failed.tsx
│       ├── maintenance-updated.tsx
│       ├── new-message.tsx
│       ├── invoice-created.tsx
│       ├── tenant-welcome.tsx
│       ├── rent-due-reminder.tsx
│       ├── rent-late-notice.tsx
│       └── lease-expiry-alert.tsx
```

**Note:** Add `@onereal/email` to `transpilePackages` in `apps/web/next.config.ts`.

### `enqueueNotification()` signature

```typescript
async function enqueueNotification(
  type: NotificationType,
  recipientEmail: string,
  payload: Record<string, any>,
  referenceId?: string,
  orgId?: string,
): Promise<void>
```

- Creates its own service role client internally — callers don't pass a client.
- Fire-and-forget: wrapped in try/catch internally. Notification failures never block business logic. Errors are logged to console but do not throw.

### `processNotificationQueue()` signature

```typescript
async function processNotificationQueue(): Promise<{ sent: number; failed: number }>
```

1. Atomically claim rows using a single statement:
   ```sql
   UPDATE notifications SET status = 'processing'
   WHERE id IN (
     SELECT id FROM notifications
     WHERE (status = 'pending')
        OR (status = 'failed' AND retry_count < 3 AND created_at < now() - interval '15 minutes')
     ORDER BY created_at ASC
     LIMIT 50
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```
   This prevents overlapping cron runs from claiming the same rows.
2. For each claimed row: render template → send via Resend → update status to `sent` or `failed`
3. Return summary counts

---

## Email Templates

All templates use React Email (`@react-email/components`). Each template:
- Wraps in a shared `<Layout>` component with OneReal logo and footer
- Receives typed props matching the notification payload
- Uses minimal, email-client-compatible styling (table-based)
- Includes a CTA button linking to the relevant app page (e.g., "View Invoice", "View Request")

### Sender Address

`"OrgName via OneReal" <notifications@onereal.app>`

The `org_name` field is required in all payloads and used as the sender display name. Callers must always pass `org_name` explicitly.

---

## Vercel Cron Configuration

`apps/web/vercel.json` (new file, placed in the app root to match Vercel project root directory setting):

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

Single cron job runs every 5 minutes:
1. Checks if daily scan has run today; if not, enqueues scheduled notifications
2. Processes the pending queue (sends emails)

This leaves 1 cron slot available for `/api/plaid/auto-pay` within Vercel Hobby's 2-job limit.

---

## Integration Points (Existing Code Changes)

These existing files need `enqueueNotification()` calls added. All calls are **fire-and-forget** — wrapped in try/catch so notification failures never block business logic.

| File | Notification Type | Email Lookup |
|------|-------------------|--------------|
| `apps/web/app/api/stripe/webhook/route.ts` | `payment_received`, `payment_failed` | `invoices.tenant_id → tenants.email` |
| `apps/web/app/api/plaid/webhook/route.ts` | `payment_received`, `payment_failed` | `invoices.tenant_id → tenants.email` |
| `modules/maintenance/src/actions/update-maintenance-request.ts` | `maintenance_updated` | Tenant: `tenants.email`; Landlord: org admin's `auth.users.email` |
| `modules/messaging/src/actions/send-message.ts` | `new_message` | `conversation_participants → profiles → auth.users.email` |
| `modules/billing/src/actions/generate-invoices.ts` | `invoice_created` | `invoices.tenant_id → tenants.email` |
| `modules/billing/src/actions/create-invoice.ts` | `invoice_created` | `invoices.tenant_id → tenants.email` |
| `modules/contacts/src/actions/create-tenant.ts` | `tenant_welcome` | `tenants.email` (direct from input) |

---

## Processing & Retry

- **Batch size:** 50 notifications per cron run (5 min interval = max 600 emails/hour)
- **Double-send prevention:** Rows set to `status = 'processing'` before sending; overlapping cron runs skip these rows
- **Retry:** Failed notifications retried up to 3 times. Rows failed less than 15 minutes ago are skipped (simple backoff to handle transient failures like rate limits)
- **After 3 failures:** Row stays as `failed` for manual review
- **Resend free tier:** 100 emails/day, 3000/month — sufficient for early usage
- **Latency:** Event-triggered notifications have average 2.5 min latency (worst case 5 min) due to cron interval

---

## Error Handling

- Resend API errors stored in `notifications.error` column
- Invalid email addresses: Resend returns 422; stored as failed, retry_count set to 3 (no retry)
- Template render errors: caught and stored in error column, marked failed
- `enqueueNotification` is fire-and-forget: errors logged to console, never thrown to caller
- Cron route returns JSON summary: `{ sent: N, failed: N, scheduled: N }`

---

## Environment Variables (New)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key for sending emails |
| `CRON_SECRET` | Vercel Cron authorization secret |

---

## Follow-Up Tasks (Post-MVP)

- Migrate `/api/plaid/auto-pay` auth from `SUPABASE_SERVICE_ROLE_KEY` to `CRON_SECRET` for consistency
- Add notification cleanup cron: delete sent rows older than 90 days
- Add notification preferences table + settings UI
- In-app notification center (bell icon)

---

## Out of Scope

- In-app notification center (bell icon with notification list)
- SMS notifications
- Push notifications (mobile)
- Notification preferences UI
- Email template editor / customization by landlords

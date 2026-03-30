# Contact Us / Support Messaging — Design Spec

## Context

OneReal has a working tenant-landlord messaging system. Users need a way to contact platform admins (support) — both tenants and managers. This extends the existing messaging infrastructure rather than creating a separate module.

## Approach

Extend the `conversations` table with a `type` column. Add a new RPC and server action for creating support conversations. Add UI entry points in tenant messages, manager messages, and a dedicated admin support inbox.

---

## Data Layer

### Migration: Add conversation type

```sql
ALTER TABLE public.conversations
  ADD COLUMN type TEXT NOT NULL DEFAULT 'general'
  CHECK (type IN ('general', 'support'));
```

### RPC: `create_support_conversation`

- Caller: any authenticated user
- Finds a platform admin via `profiles.is_platform_admin = true` (picks first available, ordered by `created_at`)
- Checks for existing support conversation between caller and that admin in the same org
- If exists: appends message to existing conversation
- If new: creates conversation (`type = 'support'`), adds both participants, inserts initial message
- Returns conversation ID
- `SECURITY DEFINER` to bypass RLS (same pattern as `create_tenant_conversation`)

### RLS Updates

- Platform admins (`profiles.is_platform_admin = true`) can SELECT all conversations where `type = 'support'`
- Platform admins can INSERT messages into support conversations they participate in
- Existing policies for `type = 'general'` remain unchanged

### RPC: `get_support_conversations`

- Caller: platform admin only
- Returns all `type = 'support'` conversations with:
  - Latest message (content, sender_id, created_at)
  - Participants with profile data (name, avatar)
  - Organization name
  - Unread status (based on `last_read_at`)
- Ordered by `updated_at DESC`

---

## Server Actions

### `create-support-conversation.ts`

```typescript
export async function createSupportConversation(
  orgId: string,
  values: { initial_message: string }
): Promise<ActionResult<{ id: string }>>
```

- Validates message (1-5000 chars)
- Calls `create_support_conversation` RPC
- Returns conversation ID

---

## UI Changes

### 1. Tenant Messages Page (`/tenant/messages`)

Add a second button alongside "Message Your Landlord":
- **"Contact Support"** button — opens a dialog with just a textarea
- On submit: calls `createSupportConversation(orgId, { initial_message })`
- On success: selects the new/existing support conversation in the list
- Support conversations in the list show a "Support" badge

### 2. Manager Messages Page (`/messages`)

Add a **"Contact Support"** button in the header area:
- Same dialog pattern as tenant
- Calls same `createSupportConversation` action

### 3. Admin Support Inbox (`/admin/support`)

New page under existing `/admin` routes:
- Left panel: list of support conversations (org name, user name, last message preview, unread dot)
- Right panel: `MessageThread` component (reused)
- Filter: All / Unread
- Uses `get_support_conversations` RPC for the list
- Uses existing `useMessages` hook for thread view

### 4. Sidebar Updates

- **Admin sidebar** (`admin-sidebar.tsx`): Add "Support Messages" nav item with unread badge
- **Tenant/Manager sidebar**: No changes needed (entry point is inside Messages page)

---

## Hooks

### `use-support-conversations.ts` (new)

For the admin inbox:
```typescript
export function useSupportConversations() {
  // Calls get_support_conversations RPC
  // Polls every 60s with tab-hidden pause (same pattern as useConversations)
}
```

### `use-support-unread-count.ts` (new)

For the admin sidebar badge:
```typescript
export function useSupportUnreadCount() {
  // Calls get_support_unread_count RPC
  // Polls every 60s
}
```

---

## Conversation List Display

Support conversations are visually distinguished:
- **Badge:** Small "Support" tag next to conversation in the list
- **In tenant/manager message list:** Support conversations appear alongside general ones, marked with badge
- **In admin inbox:** All conversations are support type (no badge needed)

---

## Files to Create/Modify

### New Files
1. `supabase/migrations/2026XXXX_support_conversations.sql` — type column + RPCs + RLS
2. `modules/messaging/src/actions/create-support-conversation.ts` — server action
3. `modules/messaging/src/hooks/use-support-conversations.ts` — admin inbox hook
4. `modules/messaging/src/hooks/use-support-unread-count.ts` — admin badge hook
5. `apps/web/app/(dashboard)/admin/support/page.tsx` — admin support inbox page

### Modified Files
1. `apps/web/app/(dashboard)/tenant/messages/page.tsx` — add Contact Support button + dialog
2. `apps/web/app/(dashboard)/messages/page.tsx` — add Contact Support button + dialog
3. `apps/web/components/admin/admin-sidebar.tsx` — add Support Messages nav item
4. `modules/messaging/src/index.ts` — export new hooks/actions

---

## Verification

1. **Tenant flow:** Log in as tenant → Messages → Contact Support → send message → verify conversation appears
2. **Manager flow:** Log in as manager → Messages → Contact Support → send message → verify
3. **Admin flow:** Log in as platform admin → Admin → Support Messages → see conversations → reply
4. **Unread tracking:** Send support message → admin badge shows unread count → open conversation → count clears
5. **Existing messaging:** Verify tenant-landlord messaging still works unchanged
6. **RLS:** Verify non-admin users cannot see other users' support conversations

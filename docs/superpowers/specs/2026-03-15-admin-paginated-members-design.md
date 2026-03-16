# Admin Org Detail — Paginated Members

> **Status:** Approved
> **Date:** 2026-03-15
> **Scope:** Add server-side pagination and search to the Members tab on the admin org detail page

---

## 1. Problem

The org detail page (`/admin/organizations/[id]`) loads ALL members in one shot via `getOrgDetails`. If an org has 100+ tenants, the members table floods the page and the initial load becomes slow.

## 2. Solution

Split member loading out of `getOrgDetails` into a separate paginated action, matching the existing `listOrganizations`/`listUsers` pattern.

### What changes:

1. **`getOrgDetails` action** — Remove the members fetch. Keep org info, properties, and stats. The `stats.member_count` field stays (used for the tab label).

2. **New `listOrgMembers` action** — Paginated member list for a specific org with search on name/email. Returns `{ items: OrgMemberListItem[], total: number }`.

3. **`OrgDetail` type** — Remove the `members` array. Stats still includes `member_count`.

4. **Org detail page Members tab** — Calls `listOrgMembers` independently when the tab is active. Adds search input and pagination controls (Previous/Next), identical to the orgs list and users list pages.

5. **Properties tab** — No changes (unlikely to reach scale issues).

### Server action: `listOrgMembers(orgId, params?)`

```
Parameters:
  - orgId: string (required)
  - search?: string (optional, filters by name or email via ilike)
  - page?: number (default 1)
  - pageSize?: number (default 20)

Returns: ActionResult<{ items: OrgMemberListItem[], total: number }>

Query:
  - Count: org_members WHERE org_id = orgId, with optional search filter on joined profiles
  - Data: org_members JOIN profiles, paginated with range(offset, offset+pageSize-1)
  - Search: .or() filter on profiles.email, profiles.first_name, profiles.last_name (ilike)
  - Order: joined_at DESC (newest first, matches current behavior)
```

### `getOrgDetails` member_count change

After removing the members fetch, `stats.member_count` is computed via a count query:
```
db.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
```
This replaces the current `members.length` computation.

### Type: `OrgMemberListItem`

```typescript
// Added to packages/types/src/models.ts
interface OrgMemberListItem {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  status: string;
  joined_at: string | null;
}
```

This replaces the inline `members` array type in `OrgDetail`.

### Updated `OrgDetail` type

```typescript
interface OrgDetail {
  organization: { /* unchanged */ };
  // members array REMOVED
  properties: Array<{ /* unchanged */ }>;
  stats: {
    member_count: number;  // kept for tab label
    property_count: number;
    unit_count: number;
    occupied_units: number;
  };
}
```

### UI behavior

- Members tab label: always shows total org members `Members ({stats.member_count})` — not filtered count
- `listOrgMembers` fires on component mount (members is the default tab)
- Search input above table (useState + useCallback + useEffect, same pattern as orgs/users list pages)
- Table columns: Name, Email, Role, Status (unchanged)
- Pagination: `Showing 1–20 of {filtered total}` with Previous/Next buttons
- Search resets to page 1
- View-only — no admin actions on members (org admins manage their own members)

## 3. Files to modify

| File | Change |
|------|--------|
| `packages/types/src/models.ts` | Add `OrgMemberListItem`, remove `members` from `OrgDetail` |
| `modules/admin/src/actions/get-org-details.ts` | Remove members fetch |
| `modules/admin/src/actions/list-org-members.ts` | **New** — paginated member list |
| `apps/web/app/(admin)/admin/organizations/[id]/page.tsx` | Split members into paginated tab |

## 4. Verification

1. Org detail page loads without fetching members upfront
2. Members tab shows paginated list with search
3. Pagination works (Previous/Next, page count)
4. Search filters by name/email, resets to page 1
5. Tab label shows correct total count
6. `pnpm build` passes

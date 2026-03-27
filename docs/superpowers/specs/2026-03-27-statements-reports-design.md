# Statements & Rent Roll Reports — Design Spec

## Goal

Add three new reports — Tenant Statement, Property Statement, and Rent Roll — accessible from a new "Statements" page under Reports. These provide full financial ledger views per tenant or property, and a current rent roll snapshot grouped by tenant.

## Architecture

Three new PostgreSQL RPC functions (`LANGUAGE sql STABLE`) handle all data aggregation server-side (consistent with existing report RPCs like `get_financial_totals`, `get_invoice_aging`, etc.). Each RPC returns a flat result set. Client-side renders tables with summary footers and CSV export.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tenant vs Property Statement | Separate reports | Leases shift between tenants; a property may have multiple tenants over time |
| Line items included | Full ledger (invoices, payments, credits, credit applications, late fees, income, expenses) | User requested "everything financial" |
| Rent Roll rows | Grouped by tenant | User preference; each row shows tenant with aggregated lease/balance data |
| Rent Roll filtering | Active (default) / Inactive toggle | User requested; inactive shows expired + terminated leases |
| Property Statement scope | Both receivable + payable | Full property P&L: rent collected + expenses paid |
| Report location | Separate Statements page at `/reports/statements` | Keep existing Financial Reports page unchanged |
| Data approach | RPC-based (Approach A) | Consistent with existing pattern, single round-trip, server-side joins |

---

## 1. RPC Functions

### 1.1 `get_tenant_statement(p_org_id UUID, p_tenant_id UUID, p_property_id UUID, p_from DATE, p_to DATE)`

Returns a chronological ledger of all financial activity for a tenant at a specific property.

**Returns:** `TABLE(txn_date DATE, sort_key BIGINT, txn_type TEXT, description TEXT, reference TEXT, charge_amount NUMERIC, payment_amount NUMERIC, running_balance NUMERIC)`

**Sources (UNION ALL):**

| Source Table | `txn_type` | `charge_amount` | `payment_amount` | Join path |
|---|---|---|---|---|
| `invoices` (receivable, non-void/draft, `late_fee_for_invoice_id IS NULL`) | `'charge'` | `amount` | 0 | Direct: `invoices.tenant_id`, `invoices.property_id` |
| `invoices` (receivable, non-void/draft, `late_fee_for_invoice_id IS NOT NULL`) | `'late_fee'` | `amount` | 0 | Direct: `invoices.tenant_id`, `invoices.property_id` |
| `payments` | `'payment'` | 0 | `amount` | `payments.invoice_id → invoices` (filter on `invoices.tenant_id`, `invoices.property_id`, `invoices.direction = 'receivable'`) |
| `credits` (issued to tenant) | `'credit'` | 0 | 0 | `credits.tenant_id` + `(credits.property_id = p_property_id OR credits.property_id IS NULL)` |
| `credit_applications` (active) | `'credit_applied'` | 0 | `amount` | `credit_applications.invoice_id → invoices` (filter on `invoices.tenant_id`, `invoices.property_id`) |

**Late fee exclusion:** The `charge` source MUST exclude `late_fee_for_invoice_id IS NOT NULL` rows to avoid duplicating them with the `late_fee` source.

**Credit issuance note:** Credits appear as informational rows (`payment_amount = 0`) so the running balance is not affected at issuance. Only `credit_applied` rows reduce the running balance when credit is applied to an invoice. Credits with `property_id IS NULL` (tenant-scoped) are included alongside property-scoped credits.

**Running balance:** Calculated via `SUM(charge_amount - payment_amount) OVER (ORDER BY txn_date, sort_key)`.

**`sort_key`:** `EXTRACT(EPOCH FROM created_at)::BIGINT` — provides deterministic ordering for transactions on the same date. For `credit_applications`, use `applied_at` instead of `created_at`.

**Filters:**
- `org_id = p_org_id`
- `tenant_id = p_tenant_id` (on `invoices.tenant_id` for charges/payments, `credits.tenant_id` for credits)
- `property_id = p_property_id` (on `invoices.property_id` for charges/payments/applications, with NULL-inclusive match for credits)
- Date range on `txn_date` (due_date for invoices, payment_date for payments, created_at for credits, applied_at for applications)

**Description field:** Invoice number for charges/late fees, payment method + reference for payments, credit reason for credits, "Credit applied" + credit reason for applications.

**Reference field:** Invoice number for charges/payments, credit ID prefix for credits.

### 1.2 `get_property_statement(p_org_id UUID, p_property_id UUID, p_from DATE, p_to DATE)`

Returns a chronological ledger of all financial activity for a property, both income and expense sides.

**Returns:** `TABLE(txn_date DATE, sort_key BIGINT, txn_type TEXT, tenant_or_vendor TEXT, description TEXT, income_amount NUMERIC, expense_amount NUMERIC, running_balance NUMERIC)`

**Accounting model:** Cash basis with one exception. Charges and bills appear as informational context rows (no effect on running balance). Cash movements (payments, direct income/expenses) affect the running balance. Credit applications also affect the running balance as they represent a real reduction in receivable balance, even though no cash changes hands — this is the one exception to strict cash-basis, documented as "virtual income."

**Sources (UNION ALL):**

| Source Table | `txn_type` | `income_amount` | `expense_amount` | Notes |
|---|---|---|---|---|
| `invoices` (receivable, non-void/draft) | `'rent_charge'` | 0 | 0 | Informational — shows what was billed. Filter: `invoices.property_id = p_property_id` |
| `payments` on receivable invoices | `'rent_payment'` | `amount` | 0 | Cash in. Join: `payments.invoice_id → invoices WHERE direction = 'receivable' AND property_id = p_property_id` |
| `credits` for this property | `'credit_issued'` | 0 | 0 | Informational. Filter: `credits.org_id = p_org_id AND credits.property_id = p_property_id` |
| `credit_applications` (active, on receivable invoices) | `'credit_applied'` | `amount` | 0 | Virtual income — real balance reduction. Join: `credit_applications.invoice_id → invoices WHERE property_id = p_property_id` |
| `invoices` (payable, non-void/draft) | `'expense_bill'` | 0 | 0 | Informational. Filter: `invoices.property_id = p_property_id` |
| `payments` on payable invoices | `'expense_payment'` | 0 | `amount` | Cash out. Join: `payments.invoice_id → invoices WHERE direction = 'payable' AND property_id = p_property_id` |
| `income` (direct, non-payment-generated) | `'income'` | `amount` | 0 | Only manual entries. Filter: `inc.org_id = p_org_id AND inc.property_id = p_property_id AND inc.transaction_date BETWEEN p_from AND p_to` |
| `expenses` (direct, non-payment-generated) | `'expense'` | 0 | `amount` | Only manual entries. Filter: `exp.org_id = p_org_id AND exp.property_id = p_property_id AND exp.transaction_date BETWEEN p_from AND p_to` |

**All sources** are filtered by `org_id = p_org_id` and date range `BETWEEN p_from AND p_to` (using `due_date` for invoices, `payment_date` for payments, `created_at` for credits, `applied_at` for credit applications, `transaction_date` for income/expenses).

**Running balance:** `SUM(income_amount - expense_amount) OVER (ORDER BY txn_date, sort_key)`. Charges/bills/credit issuance have 0 in both columns, so they don't affect the balance. Credit applications DO affect it (virtual income).

**`sort_key`:** `EXTRACT(EPOCH FROM created_at)::BIGINT` — deterministic ordering for same-date transactions. For `credit_applications`, use `applied_at`.

**`tenant_or_vendor`:** Tenant name for receivable items (join `invoices.tenant_id → tenants`), service provider name for payable items (join `invoices.provider_id → service_providers`), `NULL` for direct income/expenses.

**Note on double-counting (income):** The `record-payment` action auto-creates `income` records for every payment. The property statement already shows payments via `rent_payment` rows. To avoid duplication, the `income` source MUST use:
```sql
WHERE inc.org_id = p_org_id AND inc.property_id = p_property_id
  AND inc.transaction_date BETWEEN p_from AND p_to
  AND NOT EXISTS (
    SELECT 1 FROM payments p WHERE p.income_id = inc.id
  )
```
This excludes all payment-generated income records and only includes manually-created income entries.

**Note on double-counting (expenses):** Similarly, the `expenses` source must exclude records auto-generated from payable invoice payments:
```sql
WHERE exp.org_id = p_org_id AND exp.property_id = p_property_id
  AND exp.transaction_date BETWEEN p_from AND p_to
  AND NOT EXISTS (
    SELECT 1 FROM payments p WHERE p.expense_id = exp.id
  )
```

### 1.3 `get_rent_roll(p_org_id UUID, p_lease_status TEXT DEFAULT 'active', p_property_id UUID DEFAULT NULL)`

Returns current rent roll snapshot grouped by tenant.

**Parameters:**
- `p_lease_status`: `'active'` (matches `status IN ('active', 'month_to_month')`) or `'inactive'` (matches `status IN ('expired', 'terminated')`)
- `p_property_id`: Optional. When provided, filters to leases for that property only.

**Returns:** `TABLE(tenant_id UUID, first_name TEXT, last_name TEXT, lease_count BIGINT, total_monthly_rent NUMERIC, balance_due NUMERIC, credit_balance NUMERIC, net_due NUMERIC)`

**Schema note:** The `leases` table does NOT have `tenant_id` or `property_id` directly. Tenants are linked via the `lease_tenants` junction table (many-to-many). Properties are linked via `leases.unit_id → units.property_id`.

**Query logic:**
```sql
SELECT
  t.id AS tenant_id,
  t.first_name,
  t.last_name,
  COUNT(DISTINCT l.id) AS lease_count,
  COALESCE(SUM(l.rent_amount), 0) AS total_monthly_rent,
  COALESCE((
    SELECT SUM(inv.amount - inv.amount_paid)
    FROM invoices inv
    WHERE inv.tenant_id = t.id AND inv.org_id = p_org_id
      AND inv.direction = 'receivable'
      AND inv.status IN ('open', 'partially_paid')
  ), 0) AS balance_due,
  COALESCE((
    SELECT SUM(cr.amount - cr.amount_used)
    FROM credits cr
    WHERE cr.tenant_id = t.id AND cr.org_id = p_org_id
      AND cr.status = 'active'
  ), 0) AS credit_balance,
  -- net_due = balance_due - credit_balance (computed in outer query or client-side)
FROM tenants t
JOIN lease_tenants lt ON lt.tenant_id = t.id
JOIN leases l ON l.id = lt.lease_id AND l.org_id = p_org_id
JOIN units u ON u.id = l.unit_id
WHERE t.org_id = p_org_id
  AND (
    (p_lease_status = 'active' AND l.status IN ('active', 'month_to_month'))
    OR (p_lease_status = 'inactive' AND l.status IN ('expired', 'terminated'))
  )
  AND (p_property_id IS NULL OR u.property_id = p_property_id)
GROUP BY t.id, t.first_name, t.last_name
ORDER BY t.last_name, t.first_name;
```

**Note on `SUM(l.rent_amount)`:** Uses plain `SUM` (not `SUM(DISTINCT)`) because a tenant may have multiple leases at the same rent amount. `DISTINCT` would silently de-duplicate identical values.

**Note on `balance_due`:** Shows all outstanding invoices for the tenant across all properties, regardless of lease status filter. This is intentional — a tenant's total obligation is relevant even when viewing only their active leases.

`net_due` = `balance_due - credit_balance` (can be negative if credits exceed balance).

---

## 2. TypeScript Query Wrappers

New file: `packages/database/src/queries/statements.ts`

Three exported functions following the existing pattern in `financial.ts`:

```typescript
export async function getTenantStatement(client, orgId, tenantId, propertyId, dateRange?): Promise<TenantStatementRow[]>
export async function getPropertyStatement(client, orgId, propertyId, dateRange?): Promise<PropertyStatementRow[]>
export async function getRentRoll(client, orgId, leaseStatus, propertyId?): Promise<RentRollRow[]>
```

Each calls its corresponding RPC via `client.rpc(...)` and maps the result.

**Types** (defined in the same file or `packages/types`):

```typescript
interface TenantStatementRow {
  txn_date: string;
  sort_key: number;
  txn_type: 'charge' | 'late_fee' | 'payment' | 'credit' | 'credit_applied';
  description: string;
  reference: string;
  charge_amount: number;
  payment_amount: number;
  running_balance: number;
}

interface PropertyStatementRow {
  txn_date: string;
  sort_key: number;
  txn_type: 'rent_charge' | 'rent_payment' | 'credit_issued' | 'credit_applied' | 'expense_bill' | 'expense_payment' | 'income' | 'expense';
  tenant_or_vendor: string | null;
  description: string;
  income_amount: number;
  expense_amount: number;
  running_balance: number;
}

interface RentRollRow {
  tenant_id: string;
  first_name: string;
  last_name: string;
  lease_count: number;
  total_monthly_rent: number;
  balance_due: number;
  credit_balance: number;
  net_due: number;
}
```

---

## 3. React Query Hooks

New file: `modules/accounting/src/hooks/use-statements.ts`

Three hooks:

- `useTenantStatement(orgId, tenantId, propertyId, dateRange?)` — query key: `['tenant-statement', orgId, tenantId, propertyId, from, to]`
- `usePropertyStatement(orgId, propertyId, dateRange?)` — query key: `['property-statement', orgId, propertyId, from, to]`
- `useRentRoll(orgId, leaseStatus, propertyId?)` — query key: `['rent-roll', orgId, leaseStatus, propertyId]`

All hooks are enabled only when required params are present (e.g., `enabled: !!orgId && !!tenantId && !!propertyId`).

Export from `modules/accounting/src/index.ts`.

---

## 4. UI Components

### 4.1 Tenant Statement Table (`apps/web/components/reports/tenant-statement-table.tsx`)

Table columns: Date | Type (badge) | Description | Reference | Charges | Payments/Credits | Balance

Type badges color-coded:
- `charge`: yellow
- `late_fee`: red
- `payment`: green
- `credit`: blue
- `credit_applied`: purple

Summary footer row: **Total Charges** | **Total Payments** | **Ending Balance**

### 4.2 Property Statement Table (`apps/web/components/reports/property-statement-table.tsx`)

Table columns: Date | Type (badge) | Tenant/Vendor | Description | Income | Expense | Balance

Type badges:
- `rent_charge`/`rent_payment`: green shades
- `credit_issued`/`credit_applied`: blue/purple
- `expense_bill`/`expense_payment`: red shades
- `income`/`expense`: gray

Summary footer: **Total Income** | **Total Expenses** | **Net**

### 4.3 Rent Roll Table (`apps/web/components/reports/rent-roll-table.tsx`)

Table columns: Tenant | Leases | Monthly Rent | Balance Due | Credit Balance | Net Due

Net Due color-coded: red if positive (tenant owes), green if negative (tenant has credit surplus), black if zero.

Summary footer: **Total** row with sums.

---

## 5. Statements Page

**Route:** `apps/web/app/(dashboard)/reports/statements/page.tsx`

Client-side page with:
- Page title: "Statements"
- 3 tabs: Tenant Statement | Property Statement | Rent Roll

**Tenant Statement tab:**
- Tenant select (required) + Property select (required, filtered by tenant's leases via `lease_tenants → leases → units.property_id`) + Date range picker (default: Jan 1 of current year through today)
- Table renders only when both tenant and property selected
- CSV export button

**Property Statement tab:**
- Property select (required) + Date range picker (default: Jan 1 of current year through today)
- Table renders only when property selected
- CSV export button

**Rent Roll tab:**
- Toggle: Active (default) | Inactive
- Optional property filter dropdown (maps to `p_property_id`; when omitted, shows all properties)
- CSV export button

---

## 6. Navigation

Modify sidebar to add children under Reports:

```typescript
{
  label: 'Reports', href: '/reports', icon: BarChart3,
  children: [
    { label: 'Financial Reports', href: '/reports' },
    { label: 'Statements', href: '/reports/statements' },
  ],
},
```

---

## 7. CSV Export

Each tab has a CSV export button using the existing `downloadCsv` helper:

- **Tenant Statement CSV:** Date, Type, Description, Reference, Charges, Payments/Credits, Balance
- **Property Statement CSV:** Date, Type, Tenant/Vendor, Description, Income, Expense, Balance
- **Rent Roll CSV:** Tenant, Leases, Monthly Rent, Balance Due, Credit Balance, Net Due

---

## 8. Edge Cases

- **Tenant with no transactions in date range:** Show empty state "No transactions found for this period"
- **Property with no activity:** Same empty state
- **Rent Roll with no active/inactive leases:** "No [active/inactive] leases found"
- **Credits from overpayments:** Show as `credit` type with source in description
- **Void invoices:** Excluded (status filter `NOT IN ('void', 'draft')`)
- **Reversed credit applications:** Excluded (`status = 'active'` filter on credit_applications)
- **Property statement double-counting (income):** Income records auto-generated from payments are excluded via `NOT EXISTS (SELECT 1 FROM payments p WHERE p.income_id = inc.id)`. Only manually-created income entries appear as `income` type rows.
- **Property statement double-counting (expenses):** Expense records auto-generated from payable invoice payments are excluded via `NOT EXISTS (SELECT 1 FROM payments p WHERE p.expense_id = exp.id)`.
- **Credit issuance in statements:** Credit issuance appears as an informational row ($0 in payment/income columns) — it does not affect running balance. Only `credit_applied` rows affect balance.
- **Same-date transaction ordering:** All RPCs use `sort_key` (epoch timestamp of `created_at`) as tiebreaker to ensure deterministic ordering when multiple transactions share the same date.

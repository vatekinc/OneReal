# Accounting Overview Redesign — Design Spec

## Problem

The current Accounting Overview page has two issues:
1. **Visual styling** — The bar chart and donut charts look plain/generic and don't match fintech-quality design.
2. **Usefulness** — The page doesn't surface actionable insights. The income breakdown donut is almost always just "Rent" at 95%+. No visibility into overdue invoices, collection health, or cumulative cash flow.

## Goal

Redesign the Accounting Overview page into a "Financial Command Center" with modern fintech styling (Stripe/Mercury aesthetic) and actionable insights — leveraging 3 existing database queries that are already built but not displayed.

## Design Style

Modern fintech: clean cards, subtle gradients, muted color palette, mini sparklines, generous whitespace.

---

## Page Layout

```
Row 1: 4 enhanced stat cards (with mini sparklines)
Row 2: Cash Flow area chart (full width, hero)
Row 3: 3 insight cards (Expense Breakdown | Invoice Aging | Collection Rate)
Row 4: Property Performance table (enhanced with inline bars)
```

---

## Section 1: Enhanced Stat Cards

**What:** Same 4 cards (Total Income, Total Expenses, Net Income, Profit Margin) with an added mini sparkline inside each card.

**Sparkline spec:**
- Tiny Recharts `AreaChart`, ~40px tall, no axes, no tooltip, no grid
- Gradient fill matching the card's theme color, passed via `sparkColor` prop
- Colors: green (`#22c55e`) for income, red (`#ef4444`) for expenses, blue (`#3b82f6`) for net, slate (`#64748b`) for margin
- Data: last 6 months derived from `CashFlowPoint[]` (already fetched via `getCashFlowTrend`)

**Sparkline data derivation per card:**
- Total Income: `cashFlow.map(p => p.income)`
- Total Expenses: `cashFlow.map(p => p.expenses)`
- Net Income: `cashFlow.map(p => p.net)`
- Profit Margin: `cashFlow.map(p => p.income > 0 ? Math.round((p.net / p.income) * 100) : 0)` (zero-income months clamp to 0%)

**Architecture decision — server/client boundary:**
`StatCard` lives in `@onereal/ui` and works as a server-compatible component. Adding Recharts (a client-only library) directly to it would force `'use client'` on the shared component and add `recharts` as a dependency of the UI package.

**Solution:** Do NOT modify `StatCard`. Instead, create a new `'use client'` wrapper component `StatCardWithSparkline` in `apps/web/components/accounting/stat-card-with-sparkline.tsx`. This component:
- Renders `StatCard` (passing through all existing props)
- Conditionally renders a mini Recharts `AreaChart` below it when `sparkData` is provided
- Accepts `sparkData?: number[]` and `sparkColor?: string` props
- Uses `dynamic()` import in `page.tsx` so the chart JS only loads on the client

This keeps `@onereal/ui` free of `recharts` and preserves `StatCard` as a server-compatible component.

**Data source:** `getCashFlowTrend` (replaces `getMonthlyTrend` — returns same data plus `net` and `cumulative`).

---

## Section 2: Cash Flow Area Chart

**What:** Full-width area chart replacing the current Income vs Expenses bar chart.

**Chart spec:**
- Recharts `ComposedChart` with:
  - `Area` for income (green, `#22c55e`, 20% opacity fill with gradient to transparent)
  - `Area` for expenses (red, `#ef4444`, 20% opacity fill with gradient to transparent)
  - `Line` for cumulative net cash flow (blue/slate, `#3b82f6`, 2px stroke, dot on hover)
- Height: 300px (up from 250px)
- `CartesianGrid` with dashed lines, muted stroke
- X-axis: month labels (Jan, Feb, Mar...)
- Y-axis: currency formatted ($X,XXX)
- Custom tooltip showing: Income, Expenses, Net (that month), Cumulative
- Smooth curves (`type="monotone"`)

**Component:** New file `apps/web/components/accounting/cash-flow-chart.tsx` (`'use client'`), replaces `apps/web/components/accounting/income-expense-chart.tsx`. Loaded via `dynamic()` import in page.tsx with a 300px skeleton loader.

**Empty state:** When `data.length === 0`, render a centered muted message: "No cash flow data available for this period."

**Data source:** `getCashFlowTrend()` from `@onereal/database` — already implemented, returns `CashFlowPoint[]` with `{ month, income, expenses, net, cumulative }`.

---

## Section 3: Insights Row (3 Cards)

### Card 1: Expense Breakdown (Horizontal Bars)

**What:** Replaces both donut charts with a single horizontal bar chart for expenses.

**Spec:**
- Each category gets a row: category name (left), colored horizontal bar (proportional width), percentage + amount (right)
- Sorted by amount descending
- Bar color from a muted palette (slate/blue tones, not rainbow)
- Max 6 categories shown; remainder grouped as "Other"

**Component:** New file `apps/web/components/accounting/expense-breakdown.tsx` (server-compatible, no charts — pure CSS bars), replaces `apps/web/components/accounting/category-donut.tsx`.

**Empty state:** When `data.length === 0`, render: "No expense data available."

**Data source:** `getCategoryBreakdown(client, orgId, 'expense', dateRange)` — already fetched. Drops the income breakdown call (was almost always just "Rent").

### Card 2: Invoice Aging

**What:** New card showing outstanding invoice amounts grouped by age.

**Spec:**
- Vertical list of aging buckets: Current, 1-30 days, 31-60 days, 61-90 days, 90+ days
- Each row: colored dot (green → yellow → orange → red → dark red), label, count badge, outstanding amount
- Empty buckets shown grayed out (not hidden) so the user sees the full picture
- Card title: "Invoice Aging"

**Component:** New file `apps/web/components/accounting/invoice-aging-card.tsx` (server-compatible, no charts — pure CSS dots and layout).

**Empty state:** When `data.length === 0`, render: "No outstanding invoices." (This is actually a positive state.)

**Data source:** `getInvoiceAging()` from `@onereal/database` — already implemented, returns `AgingBucket[]` with `{ bucket, count, total_amount, total_outstanding }`.

### Card 3: Collection Rate

**What:** New card showing rent collection effectiveness.

**Spec:**
- Large percentage in center (weighted average collection rate for the period)
- Color-coded: green (>90%), amber (70-90%), red (<70%)
- Below: mini sparkline showing monthly collection rate trend (last 6 months)
- Subtitle: "Avg collection rate"

**Component:** New file `apps/web/components/accounting/collection-rate-card.tsx` (`'use client'` — contains mini sparkline). Loaded via `dynamic()` import in page.tsx with a 200px skeleton loader.

**Empty state:** When `data.length === 0`, render: "No invoice data to calculate collection rate."

**Data source:** `getRentCollectionRate()` from `@onereal/database` — already implemented, returns `CollectionRatePoint[]` with `{ month, invoiced_amount, collected_amount, collection_rate }`.

---

## Section 4: Property Performance Table (Enhanced)

**What:** Same table with visual enhancements.

**Changes:**
- **Net column:** Add a small inline horizontal bar next to the dollar amount. Green bar for positive net, red for negative. Width proportional to the largest absolute net value across all properties.
- **ROI column:** Color-coded text — green for >20%, amber for 10-20%, red for <10%.
- **Row hover:** Subtle background highlight on hover.

**Component:** Modify existing `apps/web/components/accounting/property-financials.tsx`.

**Data source:** `getPropertyFinancials()` — already fetched, no changes.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/ui/src/components/stat-card.tsx` | **No change** | Stays as server-compatible shared component |
| `apps/web/components/accounting/stat-card-with-sparkline.tsx` | Create | `'use client'` wrapper composing StatCard + mini AreaChart |
| `apps/web/components/accounting/income-expense-chart.tsx` | Delete | Replaced by cash-flow-chart |
| `apps/web/components/accounting/cash-flow-chart.tsx` | Create | `'use client'` area chart with income/expense areas + cumulative line |
| `apps/web/components/accounting/category-donut.tsx` | Delete | Replaced by expense-breakdown |
| `apps/web/components/accounting/expense-breakdown.tsx` | Create | Server-compatible horizontal bar chart (pure CSS) |
| `apps/web/components/accounting/invoice-aging-card.tsx` | Create | Server-compatible aging buckets card (pure CSS) |
| `apps/web/components/accounting/collection-rate-card.tsx` | Create | `'use client'` collection rate gauge + sparkline |
| `apps/web/components/accounting/property-financials.tsx` | Modify | Add inline net bars + color-coded ROI |
| `apps/web/app/(dashboard)/accounting/page.tsx` | Modify | Update layout, swap data fetches, add aging + collection |
| `apps/web/e2e/smoke.spec.ts` | Modify | Update accounting overview assertions |

## Data Flow

```
page.tsx (Server Component)
  ├── getFinancialStats()        → stat cards (existing)
  ├── getCashFlowTrend()         → cash flow chart + stat sparklines (replaces getMonthlyTrend)
  ├── getCategoryBreakdown()     → expense breakdown only (drop income breakdown call)
  ├── getInvoiceAging()          → invoice aging card (NEW call, existing query)
  ├── getRentCollectionRate()    → collection rate card (NEW call, existing query)
  └── getPropertyFinancials()    → property table (existing)
```

**Total server-side calls: 6.** Previous: 5 (stats, monthlyTrend, incomeBreakdown, expenseBreakdown, propertyFinancials). New: 6 (stats, cashFlowTrend, expenseBreakdown, invoiceAging, rentCollectionRate, propertyFinancials). We replaced `getMonthlyTrend` with `getCashFlowTrend`, dropped `getCategoryBreakdown('income')`, and added `getInvoiceAging` + `getRentCollectionRate`.

## Database Changes

**None.** All RPC functions already exist:
- `get_financial_totals`
- `get_monthly_trend` (used internally by `getCashFlowTrend`)
- `get_category_breakdown`
- `get_invoice_aging`
- `get_rent_collection_rate`
- `get_property_financials`

## Dependencies

- `recharts` (already installed in `apps/web`) — used by cash-flow-chart, stat-card-with-sparkline, collection-rate-card
- No new packages needed
- `@onereal/ui` is NOT modified — no new dependencies on the shared UI package

## Client-Side Hooks

The `modules/accounting/src/hooks/` directory contains client-side React Query hooks (`useCashFlow`, `useInvoiceAging`, `useRentCollection`, etc.) that wrap the same database queries. This redesign fetches data server-side in the page component and passes it as props. The client-side hooks remain available for other pages or future client-side usage but are not used by this redesign. Do not delete them.

## Loading States

Client components loaded via `dynamic()` get skeleton loaders:
- `StatCardWithSparkline`: Not dynamically imported — rendered inline since it's lightweight
- `CashFlowChart`: `dynamic()` with `<div className="h-[300px] animate-pulse rounded-md bg-muted" />` loader
- `CollectionRateCard`: `dynamic()` with `<div className="h-[200px] animate-pulse rounded-md bg-muted" />` loader

Server-compatible components (`ExpenseBreakdown`, `InvoiceAgingCard`, `PropertyFinancials`) do not need loading states — they render synchronously with server-fetched data.

## E2E Test Updates

Update `apps/web/e2e/smoke.spec.ts` accounting overview test assertions:

```typescript
// Replace existing assertions:
// await expect(page.getByText('Income vs Expenses')).toBeVisible();
// await expect(page.getByText('Breakdown')).toBeVisible();

// New assertions:
await expect(page.getByText('Cash Flow')).toBeVisible();
await expect(page.getByText('Expense Breakdown')).toBeVisible();
await expect(page.getByText('Invoice Aging')).toBeVisible();
await expect(page.getByText('Collection Rate')).toBeVisible();
await expect(page.getByText('Property Performance')).toBeVisible();
```

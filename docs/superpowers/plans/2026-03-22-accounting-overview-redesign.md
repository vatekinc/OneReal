# Accounting Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Accounting Overview page into a "Financial Command Center" with modern fintech styling, surfacing cash flow trends, invoice aging, and collection rate data that already exists in the database but isn't displayed.

**Architecture:** Server Component page fetches 6 data sources in parallel, passes data as props to a mix of server-compatible and `'use client'` components. Client components (charts with Recharts) are loaded via `dynamic()` imports with skeleton loaders. No database changes needed — all RPC functions already exist.

**Tech Stack:** Next.js 15 (App Router), React 19, Recharts 3.x, Tailwind CSS, Supabase RPC

---

## Chunk 1: New Components

### Task 1: Create StatCardWithSparkline

A `'use client'` component that replicates `StatCard`'s layout and adds a mini Recharts `AreaChart` sparkline below the value. We cannot compose `StatCard` directly because it returns a complete `<Card>` and does not expose a slot/children prop for injecting the sparkline inside. Instead, we replicate its simple layout (which is just Card > CardHeader + CardContent) and add the sparkline at the bottom of CardContent.

**Files:**
- Create: `apps/web/components/accounting/stat-card-with-sparkline.tsx`
- Reference: `packages/ui/src/components/stat-card.tsx` (read-only, do NOT modify)

- [ ] **Step 1: Create the component file**

```tsx
// apps/web/components/accounting/stat-card-with-sparkline.tsx
'use client';

import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { type LucideIcon } from 'lucide-react';

interface StatCardWithSparklineProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: { value: number; positive: boolean };
  sparkData?: number[];
  sparkColor?: string;
}

export function StatCardWithSparkline({
  title,
  value,
  icon: Icon,
  description,
  trend,
  sparkData,
  sparkColor = '#64748b',
}: StatCardWithSparklineProps) {
  const chartData = sparkData?.map((v, i) => ({ i, v })) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {trend && (
          <p className={`text-xs ${trend.positive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.positive ? '+' : ''}{trend.value}% from last period
          </p>
        )}
        {chartData.length > 1 && (
          <div className="mt-2 h-[40px]">
            <ResponsiveContainer width="100%" height={40}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`spark-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={1.5}
                  fill={`url(#spark-${title.replace(/\s/g, '')})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `cd apps/web && pnpm dev`

Temporarily import and render `StatCardWithSparkline` in any page with test data like `sparkData={[100, 200, 150, 300, 280, 400]}` and `sparkColor="#22c55e"`. Confirm the card shows with a small green area chart below the value. Remove the temporary usage after confirming.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/accounting/stat-card-with-sparkline.tsx
git commit -m "feat(accounting): add StatCardWithSparkline wrapper component"
```

---

### Task 2: Create CashFlowChart

A `'use client'` `ComposedChart` showing income/expense areas and a cumulative net line. Replaces the old `income-expense-chart.tsx`.

**Files:**
- Create: `apps/web/components/accounting/cash-flow-chart.tsx`
- Reference: `packages/types/src/models.ts` (CashFlowPoint type)

- [ ] **Step 1: Create the component file**

```tsx
// apps/web/components/accounting/cash-flow-chart.tsx
'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { CashFlowPoint } from '@onereal/types';

interface CashFlowChartProps {
  data: CashFlowPoint[];
}

function formatMonth(value: string): string {
  const [, month] = value.split('-');
  const date = new Date(2000, Number(month) - 1);
  return date.toLocaleString('default', { month: 'short' });
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No cash flow data available for this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" tickFormatter={formatMonth} className="text-xs" />
        <YAxis tickFormatter={formatCurrency} className="text-xs" />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as CashFlowPoint;
            return (
              <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                <p className="mb-1 font-medium">{formatMonth(label)}</p>
                <p className="text-green-600">Income: {formatCurrency(point.income)}</p>
                <p className="text-red-600">Expenses: {formatCurrency(point.expenses)}</p>
                <p>Net: {formatCurrency(point.net)}</p>
                <p className="text-blue-600">Cumulative: {formatCurrency(point.cumulative)}</p>
              </div>
            );
          }}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="income"
          stroke="#22c55e"
          fill="url(#incomeGradient)"
          strokeWidth={2}
          dot={false}
          name="Income"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          stroke="#ef4444"
          fill="url(#expenseGradient)"
          strokeWidth={2}
          dot={false}
          name="Expenses"
        />
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Cumulative"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/cash-flow-chart.tsx
git commit -m "feat(accounting): add CashFlowChart area chart component"
```

---

### Task 3: Create ExpenseBreakdown

A server-compatible component (no `'use client'`, no Recharts) using pure CSS horizontal bars for expense categories.

**Files:**
- Create: `apps/web/components/accounting/expense-breakdown.tsx`
- Reference: `packages/types/src/models.ts` (CategoryBreakdown type)

- [ ] **Step 1: Create the component file**

```tsx
// apps/web/components/accounting/expense-breakdown.tsx
import type { CategoryBreakdown } from '@onereal/types';
import { cn } from '@onereal/ui';

interface ExpenseBreakdownProps {
  data: CategoryBreakdown[];
}

const BAR_COLORS = [
  'bg-slate-600',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-slate-400',
];

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function ExpenseBreakdown({ data }: ExpenseBreakdownProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No expense data available.
      </div>
    );
  }

  // Sort by amount descending, cap at 6 categories
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  let items: CategoryBreakdown[];

  if (sorted.length > 6) {
    const top5 = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const otherAmount = rest.reduce((sum, r) => sum + r.amount, 0);
    const otherPercentage = rest.reduce((sum, r) => sum + r.percentage, 0);
    items = [...top5, { category: 'other', amount: otherAmount, percentage: otherPercentage }];
  } else {
    items = sorted;
  }

  const maxAmount = items[0]?.amount ?? 1;

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.category} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{formatCategory(item.category)}</span>
            <span className="text-muted-foreground">
              {formatCurrency(item.amount)} · {item.percentage.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className={cn('h-2 rounded-full', BAR_COLORS[index % BAR_COLORS.length])}
              style={{ width: `${(item.amount / maxAmount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/expense-breakdown.tsx
git commit -m "feat(accounting): add ExpenseBreakdown horizontal bars component"
```

---

### Task 4: Create InvoiceAgingCard

A server-compatible component showing aging buckets with color-coded dots.

**Files:**
- Create: `apps/web/components/accounting/invoice-aging-card.tsx`
- Reference: `packages/types/src/models.ts` (AgingBucket type)

- [ ] **Step 1: Create the component file**

```tsx
// apps/web/components/accounting/invoice-aging-card.tsx
import type { AgingBucket } from '@onereal/types';
import { cn } from '@onereal/ui';

interface InvoiceAgingCardProps {
  data: AgingBucket[];
}

const BUCKET_CONFIG: Record<string, { label: string; dotColor: string; textColor: string }> = {
  current: { label: 'Current', dotColor: 'bg-green-500', textColor: 'text-green-600' },
  '1-30': { label: '1–30 days', dotColor: 'bg-yellow-500', textColor: 'text-yellow-600' },
  '31-60': { label: '31–60 days', dotColor: 'bg-orange-500', textColor: 'text-orange-600' },
  '61-90': { label: '61–90 days', dotColor: 'bg-red-500', textColor: 'text-red-600' },
  '90+': { label: '90+ days', dotColor: 'bg-red-700', textColor: 'text-red-700' },
};

const BUCKET_ORDER = ['current', '1-30', '31-60', '61-90', '90+'];

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function InvoiceAgingCard({ data }: InvoiceAgingCardProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No outstanding invoices.
      </div>
    );
  }

  const bucketMap = new Map(data.map((b) => [b.bucket, b]));

  return (
    <div className="space-y-3">
      {BUCKET_ORDER.map((key) => {
        const config = BUCKET_CONFIG[key]!;
        const bucket = bucketMap.get(key);
        const hasData = bucket && bucket.total_outstanding > 0;

        return (
          <div
            key={key}
            className={cn(
              'flex items-center gap-3 text-sm',
              !hasData && 'opacity-40',
            )}
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', config.dotColor)} />
            <span className="flex-1 font-medium">{config.label}</span>
            {hasData && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">
                {bucket.count}
              </span>
            )}
            <span className={cn('tabular-nums font-medium', hasData ? config.textColor : 'text-muted-foreground')}>
              {hasData ? formatCurrency(bucket.total_outstanding) : '$0'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/invoice-aging-card.tsx
git commit -m "feat(accounting): add InvoiceAgingCard component"
```

---

### Task 5: Create CollectionRateCard

A `'use client'` component showing the average collection rate percentage with a mini sparkline.

**Files:**
- Create: `apps/web/components/accounting/collection-rate-card.tsx`
- Reference: `packages/types/src/models.ts` (CollectionRatePoint type)

- [ ] **Step 1: Create the component file**

```tsx
// apps/web/components/accounting/collection-rate-card.tsx
'use client';

import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { cn } from '@onereal/ui';
import type { CollectionRatePoint } from '@onereal/types';

interface CollectionRateCardProps {
  data: CollectionRatePoint[];
}

export function CollectionRateCard({ data }: CollectionRateCardProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No invoice data to calculate collection rate.
      </div>
    );
  }

  // Weighted average collection rate
  const totalInvoiced = data.reduce((sum, p) => sum + p.invoiced_amount, 0);
  const totalCollected = data.reduce((sum, p) => sum + p.collected_amount, 0);
  const avgRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  const rateColor =
    avgRate >= 90 ? 'text-green-600' : avgRate >= 70 ? 'text-amber-600' : 'text-red-600';
  const sparkColor =
    avgRate >= 90 ? '#22c55e' : avgRate >= 70 ? '#f59e0b' : '#ef4444';

  const chartData = data.map((p, i) => ({ i, rate: p.collection_rate }));
  const gradientId = `collection-${avgRate}`;

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <span className={cn('text-4xl font-bold tabular-nums', rateColor)}>
        {avgRate}%
      </span>
      <span className="text-xs text-muted-foreground">Avg collection rate</span>
      {chartData.length > 1 && (
        <div className="mt-2 h-[50px] w-full">
          <ResponsiveContainer width="100%" height={50}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="rate"
                stroke={sparkColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/collection-rate-card.tsx
git commit -m "feat(accounting): add CollectionRateCard component"
```

---

### Task 6: Enhance PropertyFinancials

Add inline net bars and color-coded ROI to the existing table.

**Files:**
- Modify: `apps/web/components/accounting/property-financials.tsx`

- [ ] **Step 1: Update the component**

Replace the entire contents of `apps/web/components/accounting/property-financials.tsx` with:

```tsx
// apps/web/components/accounting/property-financials.tsx
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@onereal/ui';
import { cn } from '@onereal/ui';
import type { PropertyFinancial } from '@onereal/types';

interface PropertyFinancialsProps {
  data: PropertyFinancial[];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function roiColor(roi: number): string {
  if (roi >= 20) return 'text-green-600';
  if (roi >= 10) return 'text-amber-600';
  return 'text-red-600';
}

export function PropertyFinancials({ data }: PropertyFinancialsProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No property financial data available.
      </div>
    );
  }

  const totals = data.reduce(
    (acc, row) => ({
      income: acc.income + row.income,
      expenses: acc.expenses + row.expenses,
      net: acc.net + row.net,
    }),
    { income: 0, expenses: 0, net: 0 },
  );

  const totalRoi = totals.income > 0
    ? Math.round((totals.net / totals.income) * 100 * 100) / 100
    : 0;

  const maxAbsNet = Math.max(...data.map((r) => Math.abs(r.net)), 1);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">ROI</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const barWidth = Math.round((Math.abs(row.net) / maxAbsNet) * 100);
          return (
            <TableRow key={row.property_id} className="hover:bg-muted/50">
              <TableCell className="font-medium">{row.property_name}</TableCell>
              <TableCell className="text-right text-green-600">
                {formatCurrency(row.income)}
              </TableCell>
              <TableCell className="text-right text-red-600">
                {formatCurrency(row.expenses)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-2 w-16 rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-2 rounded-full',
                        row.net >= 0 ? 'bg-green-500' : 'bg-red-500',
                      )}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{formatCurrency(row.net)}</span>
                </div>
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', roiColor(row.roi))}>
                {row.roi.toFixed(1)}%
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Portfolio Total</TableCell>
          <TableCell className="text-right font-semibold text-green-600">
            {formatCurrency(totals.income)}
          </TableCell>
          <TableCell className="text-right font-semibold text-red-600">
            {formatCurrency(totals.expenses)}
          </TableCell>
          <TableCell className="text-right font-semibold">
            {formatCurrency(totals.net)}
          </TableCell>
          <TableCell className={cn('text-right font-semibold tabular-nums', roiColor(totalRoi))}>
            {totalRoi.toFixed(1)}%
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/accounting/property-financials.tsx
git commit -m "feat(accounting): enhance PropertyFinancials with inline net bars and color-coded ROI"
```

---

## Chunk 2: Page Wiring, Cleanup & Tests

> **Prerequisite:** Chunk 1 must be fully completed before starting Chunk 2.

### Task 7: Update page.tsx — Wire All Components Together

Replace data fetches, update imports, and restructure the layout to use all new components.

**Files:**
- Modify: `apps/web/app/(dashboard)/accounting/page.tsx`
- Delete: `apps/web/components/accounting/income-expense-chart.tsx`
- Delete: `apps/web/components/accounting/category-donut.tsx`

- [ ] **Step 1: Replace the page.tsx file**

Replace the entire contents of `apps/web/app/(dashboard)/accounting/page.tsx` with:

```tsx
// apps/web/app/(dashboard)/accounting/page.tsx
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { getAuthContext } from '@/lib/auth';
import {
  getFinancialStats,
  getCashFlowTrend,
  getCategoryBreakdown,
  getInvoiceAging,
  getRentCollectionRate,
  getPropertyFinancials,
} from '@onereal/database';
import { Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { DollarSign, TrendingDown, TrendingUp, Percent } from 'lucide-react';
import { DateRangeFilter } from '@/components/accounting/date-range-filter';
import { PropertyFinancials } from '@/components/accounting/property-financials';
import { ExpenseBreakdown } from '@/components/accounting/expense-breakdown';
import { InvoiceAgingCard } from '@/components/accounting/invoice-aging-card';
import { StatCardWithSparkline } from '@/components/accounting/stat-card-with-sparkline';
import { resolveDateRange } from '@/lib/date-range';

const CashFlowChart = dynamic(
  () => import('@/components/accounting/cash-flow-chart').then((m) => ({ default: m.CashFlowChart })),
  { loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);

const CollectionRateCard = dynamic(
  () => import('@/components/accounting/collection-rate-card').then((m) => ({ default: m.CollectionRateCard })),
  { loading: () => <div className="h-[200px] animate-pulse rounded-md bg-muted" /> }
);

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AccountingPage({ searchParams }: PageProps) {
  const [auth, params] = await Promise.all([getAuthContext(), searchParams]);
  if (!auth) return null;

  const dateRange = resolveDateRange(params.range, params.from, params.to);

  const [stats, cashFlow, expenseBreakdown, aging, collectionRate, propertyFinancials] =
    await Promise.all([
      getFinancialStats(auth.supabase, auth.orgId, dateRange),
      getCashFlowTrend(auth.supabase, auth.orgId, dateRange),
      getCategoryBreakdown(auth.supabase, auth.orgId, 'expense', dateRange),
      getInvoiceAging(auth.supabase, auth.orgId),
      getRentCollectionRate(auth.supabase, auth.orgId, dateRange),
      getPropertyFinancials(auth.supabase, auth.orgId, dateRange),
    ]);

  // Derive sparkline data from cash flow trend
  const incomeSparkData = cashFlow.map((p) => p.income);
  const expenseSparkData = cashFlow.map((p) => p.expenses);
  const netSparkData = cashFlow.map((p) => p.net);
  const marginSparkData = cashFlow.map((p) =>
    p.income > 0 ? Math.round((p.net / p.income) * 100) : 0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {/* Row 1: Stat Cards with Sparklines */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardWithSparkline
          title="Total Income"
          value={`$${stats.total_income.toLocaleString()}`}
          icon={TrendingUp}
          trend={dateRange ? { value: stats.income_change, positive: stats.income_change >= 0 } : undefined}
          sparkData={incomeSparkData}
          sparkColor="#22c55e"
        />
        <StatCardWithSparkline
          title="Total Expenses"
          value={`$${stats.total_expenses.toLocaleString()}`}
          icon={TrendingDown}
          trend={dateRange ? { value: stats.expense_change, positive: stats.expense_change <= 0 } : undefined}
          sparkData={expenseSparkData}
          sparkColor="#ef4444"
        />
        <StatCardWithSparkline
          title="Net Income"
          value={`$${stats.net_income.toLocaleString()}`}
          icon={DollarSign}
          description={stats.net_income >= 0 ? 'Profitable' : 'Net loss'}
          sparkData={netSparkData}
          sparkColor="#3b82f6"
        />
        <StatCardWithSparkline
          title="Profit Margin"
          value={`${stats.total_income > 0 ? Math.round((stats.net_income / stats.total_income) * 100) : 0}%`}
          icon={Percent}
          description="Net income / total income"
          sparkData={marginSparkData}
          sparkColor="#64748b"
        />
      </div>

      {/* Row 2: Cash Flow Chart (hero, full width) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <CashFlowChart data={cashFlow} />
        </CardContent>
      </Card>

      {/* Row 3: Insights — Expense Breakdown | Invoice Aging | Collection Rate */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseBreakdown data={expenseBreakdown} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice Aging</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceAgingCard data={aging} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collection Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <CollectionRateCard data={collectionRate} />
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Property Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Property Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyFinancials data={propertyFinancials} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Delete old component files**

```bash
rm apps/web/components/accounting/income-expense-chart.tsx
rm apps/web/components/accounting/category-donut.tsx
```

- [ ] **Step 3: Verify the page renders**

Run: `cd apps/web && pnpm dev`

Navigate to `http://localhost:3000/accounting`. Verify:
1. Four stat cards render with sparklines below the values
2. Cash Flow area chart shows income (green area), expenses (red area), cumulative (blue line)
3. Three insight cards render side by side: Expense Breakdown (horizontal bars), Invoice Aging (dot list), Collection Rate (large percentage + sparkline)
4. Property Performance table shows inline net bars and color-coded ROI
5. No console errors, no 42P17 database errors
6. Date range filter still works — click "This Year", "3yr" etc. and see data update

- [ ] **Step 4: Commit**

```bash
git rm apps/web/components/accounting/income-expense-chart.tsx apps/web/components/accounting/category-donut.tsx
git add apps/web/app/\(dashboard\)/accounting/page.tsx apps/web/components/accounting/
git commit -m "feat(accounting): wire up redesigned overview page and remove old chart components"
```

---

### Task 8: Update E2E Tests

Update the accounting overview smoke test assertions to match new section names.

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`

- [ ] **Step 1: Update the test assertions**

In `apps/web/e2e/smoke.spec.ts`, find the `Accounting` test describe block. Locate the test `'overview renders with stat cards and charts'` and replace the assertions inside it.

**Find this code (around lines 77-84):**
```typescript
  test('overview renders with stat cards and charts', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Income vs Expenses')).toBeVisible();
    await expect(page.getByText('Breakdown')).toBeVisible();
    await expect(page.getByText('Property Performance')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
```

**Replace with:**
```typescript
  test('overview renders with stat cards and charts', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Cash Flow')).toBeVisible();
    await expect(page.getByText('Expense Breakdown')).toBeVisible();
    await expect(page.getByText('Invoice Aging')).toBeVisible();
    await expect(page.getByText('Collection Rate')).toBeVisible();
    await expect(page.getByText('Property Performance')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
```

- [ ] **Step 2: Run the E2E tests**

Run: `cd apps/web && pnpm test:e2e`

All tests should pass, including the updated accounting overview test.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts
git commit -m "test(accounting): update smoke test assertions for redesigned overview"
```

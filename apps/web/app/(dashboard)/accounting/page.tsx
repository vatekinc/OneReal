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
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          trend={dateRange ? { value: stats.income_change, positive: stats.income_change >= 0 } : undefined}
          sparkData={incomeSparkData}
          sparkColor="#22c55e"
        />
        <StatCardWithSparkline
          title="Total Expenses"
          value={`$${stats.total_expenses.toLocaleString()}`}
          icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
          trend={dateRange ? { value: stats.expense_change, positive: stats.expense_change <= 0 } : undefined}
          sparkData={expenseSparkData}
          sparkColor="#ef4444"
        />
        <StatCardWithSparkline
          title="Net Income"
          value={`$${stats.net_income.toLocaleString()}`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          description={stats.net_income >= 0 ? 'Profitable' : 'Net loss'}
          sparkData={netSparkData}
          sparkColor="#3b82f6"
        />
        <StatCardWithSparkline
          title="Profit Margin"
          value={`${stats.total_income > 0 ? Math.round((stats.net_income / stats.total_income) * 100) : 0}%`}
          icon={<Percent className="h-4 w-4 text-muted-foreground" />}
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

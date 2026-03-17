import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { getAuthContext } from '@/lib/auth';
import {
  getFinancialStats,
  getMonthlyTrend,
  getCategoryBreakdown,
  getPropertyFinancials,
} from '@onereal/database';
import { StatCard, Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { DollarSign, TrendingDown, TrendingUp, Percent } from 'lucide-react';
import { DateRangeFilter } from '@/components/accounting/date-range-filter';
import { PropertyFinancials } from '@/components/accounting/property-financials';
import { resolveDateRange } from '@/lib/date-range';

const IncomeExpenseChart = dynamic(
  () => import('@/components/accounting/income-expense-chart').then((m) => ({ default: m.IncomeExpenseChart })),
  { loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);

const CategoryDonut = dynamic(
  () => import('@/components/accounting/category-donut').then((m) => ({ default: m.CategoryDonut })),
  { loading: () => <div className="h-[200px] animate-pulse rounded-md bg-muted" /> }
);

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AccountingPage({ searchParams }: PageProps) {
  const [auth, params] = await Promise.all([getAuthContext(), searchParams]);
  if (!auth) return null;

  const dateRange = resolveDateRange(params.range, params.from, params.to);

  const [stats, trend, incomeBreakdown, expenseBreakdown, propertyFinancials] = await Promise.all([
    getFinancialStats(auth.supabase, auth.orgId, dateRange),
    getMonthlyTrend(auth.supabase, auth.orgId, dateRange),
    getCategoryBreakdown(auth.supabase, auth.orgId, 'income', dateRange),
    getCategoryBreakdown(auth.supabase, auth.orgId, 'expense', dateRange),
    getPropertyFinancials(auth.supabase, auth.orgId, dateRange),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Income"
          value={`$${stats.total_income.toLocaleString()}`}
          icon={TrendingUp}
          trend={dateRange ? { value: stats.income_change, positive: stats.income_change >= 0 } : undefined}
        />
        <StatCard
          title="Total Expenses"
          value={`$${stats.total_expenses.toLocaleString()}`}
          icon={TrendingDown}
          trend={dateRange ? { value: stats.expense_change, positive: stats.expense_change <= 0 } : undefined}
        />
        <StatCard
          title="Net Income"
          value={`$${stats.net_income.toLocaleString()}`}
          icon={DollarSign}
          description={stats.net_income >= 0 ? 'Profitable' : 'Net loss'}
        />
        <StatCard
          title="Profit Margin"
          value={`${stats.total_income > 0 ? Math.round((stats.net_income / stats.total_income) * 100) : 0}%`}
          icon={Percent}
          description="Net income / total income"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Income vs Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <CategoryDonut data={incomeBreakdown} title="Income" />
            <CategoryDonut data={expenseBreakdown} title="Expenses" />
          </CardContent>
        </Card>
      </div>

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

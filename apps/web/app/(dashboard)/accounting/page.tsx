import { Suspense } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getProfile,
  getFinancialStats,
  getMonthlyTrend,
  getCategoryBreakdown,
  getPropertyFinancials,
} from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { StatCard, Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { DollarSign, TrendingDown, TrendingUp, Percent } from 'lucide-react';
import { DateRangeFilter } from '@/components/accounting/date-range-filter';
import { IncomeExpenseChart } from '@/components/accounting/income-expense-chart';
import { CategoryDonut } from '@/components/accounting/category-donut';
import { PropertyFinancials } from '@/components/accounting/property-financials';
import { resolveDateRange } from '@/lib/date-range';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

export default async function AccountingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabaseRaw = await createServerSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;
  const dateRange = resolveDateRange(params.range, params.from, params.to);

  const [stats, trend, incomeBreakdown, expenseBreakdown, propertyFinancials] = await Promise.all([
    getFinancialStats(supabase, orgId, dateRange),
    getMonthlyTrend(supabase, orgId, dateRange),
    getCategoryBreakdown(supabase, orgId, 'income', dateRange),
    getCategoryBreakdown(supabase, orgId, 'expense', dateRange),
    getPropertyFinancials(supabase, orgId, dateRange),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Financial Overview</h1>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {/* Row 1: Stat Cards */}
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

      {/* Row 2: Charts */}
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

      {/* Row 3: Property Performance */}
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

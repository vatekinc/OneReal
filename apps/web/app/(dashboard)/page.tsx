import { getAuthContext } from '@/lib/auth';
import { getPortfolioStats, getFinancialStats, getRecentTransactions } from '@onereal/database';
import { StatCard, Button, Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import { Building2, DoorOpen, DollarSign, TrendingUp, TrendingDown, Percent, Plus } from 'lucide-react';
import Link from 'next/link';
import { RecentTransactions } from '@/components/accounting/recent-transactions';

export default async function DashboardPage() {
  const auth = await getAuthContext();
  if (!auth) return null;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const dateRange = {
    from: firstOfMonth.toISOString().split('T')[0],
    to: now.toISOString().split('T')[0],
  };

  const [portfolioStats, financialStats, recentTransactions] = await Promise.all([
    getPortfolioStats(auth.supabase, auth.orgId),
    getFinancialStats(auth.supabase, auth.orgId, dateRange),
    getRecentTransactions(auth.supabase, auth.orgId, 10),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your portfolio</p>
        </div>
        <Link href="/properties/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Add Property
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Properties" value={portfolioStats.total_properties} icon={Building2} description="Active properties" />
        <StatCard title="Total Units" value={portfolioStats.total_units} icon={DoorOpen} description={`${portfolioStats.occupied_units} occupied`} />
        <StatCard title="Occupancy Rate" value={`${portfolioStats.occupancy_rate}%`} icon={Percent} description="Across all properties" />
        <StatCard title="Rent Potential" value={`$${portfolioStats.total_rent_potential.toLocaleString()}`} icon={DollarSign} description="Monthly total" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Monthly Income" value={`$${financialStats.total_income.toLocaleString()}`} icon={TrendingUp} trend={{ value: financialStats.income_change, positive: financialStats.income_change >= 0 }} />
        <StatCard title="Monthly Expenses" value={`$${financialStats.total_expenses.toLocaleString()}`} icon={TrendingDown} trend={{ value: financialStats.expense_change, positive: financialStats.expense_change <= 0 }} />
        <StatCard title="Net Income" value={`$${financialStats.net_income.toLocaleString()}`} icon={DollarSign} description="This month" />
        <StatCard title="Profit Margin" value={`${financialStats.total_income > 0 ? Math.round((financialStats.net_income / financialStats.total_income) * 100) : 0}%`} icon={Percent} description="This month" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Link href="/accounting" className="text-sm text-primary hover:underline">View All</Link>
        </CardHeader>
        <CardContent>
          <RecentTransactions transactions={recentTransactions} />
        </CardContent>
      </Card>
    </div>
  );
}

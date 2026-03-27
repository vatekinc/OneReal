import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';
import type {
  FinancialStats,
  MonthlyTrendPoint,
  CategoryBreakdown,
  PropertyFinancial,
  RecentTransaction,
  ProfitAndLossReport,
  CashFlowPoint,
  AgingBucket,
  CollectionRatePoint,
} from '@onereal/types';

type Client = SupabaseClient<Database>;

interface DateRange {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Helper: build RPC date params
// ---------------------------------------------------------------------------

function dateParams(dateRange?: DateRange): { p_from: string | null; p_to: string | null } {
  return {
    p_from: dateRange?.from ?? null,
    p_to: dateRange?.to ?? null,
  };
}

// ---------------------------------------------------------------------------
// 1. getFinancialStats — uses get_financial_totals RPC
// ---------------------------------------------------------------------------

export async function getFinancialStats(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<FinancialStats> {
  // Build both queries upfront so they can run in parallel
  const currentPromise = (client as any).rpc('get_financial_totals', {
    p_org_id: orgId,
    ...dateParams(dateRange),
  });

  let prevPromise: Promise<any> | null = null;
  if (dateRange) {
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - durationMs).toISOString().split('T')[0]!;
    const prevTo = new Date(fromDate.getTime() - 1).toISOString().split('T')[0]!;

    prevPromise = (client as any).rpc('get_financial_totals', {
      p_org_id: orgId,
      p_from: prevFrom,
      p_to: prevTo,
    });
  }

  const [{ data, error }, prevResult] = await Promise.all([
    currentPromise,
    prevPromise ?? Promise.resolve(null),
  ]);
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const totalIncome = Number(row?.total_income) || 0;
  const totalExpenses = Number(row?.total_expenses) || 0;
  const netIncome = totalIncome - totalExpenses;

  const roi = totalIncome > 0
    ? Math.round((netIncome / totalIncome) * 100 * 100) / 100
    : 0;

  let incomeChange = 0;
  let expenseChange = 0;

  if (prevResult) {
    const prevRow = Array.isArray(prevResult.data) ? prevResult.data[0] : prevResult.data;
    const prevIncome = Number(prevRow?.total_income) || 0;
    const prevExpenses = Number(prevRow?.total_expenses) || 0;

    incomeChange = prevIncome > 0
      ? Math.round(((totalIncome - prevIncome) / prevIncome) * 100 * 100) / 100
      : 0;
    expenseChange = prevExpenses > 0
      ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 100 * 100) / 100
      : 0;
  }

  return {
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net_income: netIncome,
    roi,
    income_change: incomeChange,
    expense_change: expenseChange,
  };
}

// ---------------------------------------------------------------------------
// 2. getMonthlyTrend — uses get_monthly_trend RPC
// ---------------------------------------------------------------------------

export async function getMonthlyTrend(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<MonthlyTrendPoint[]> {
  const { data, error } = await (client as any).rpc('get_monthly_trend', {
    p_org_id: orgId,
    ...dateParams(dateRange),
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    month: row.month,
    income: Number(row.income) || 0,
    expenses: Number(row.expenses) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 3. getCategoryBreakdown — uses get_category_breakdown RPC
// ---------------------------------------------------------------------------

export async function getCategoryBreakdown(
  client: Client,
  orgId: string,
  type: 'income' | 'expense',
  dateRange?: DateRange,
): Promise<CategoryBreakdown[]> {
  const { data, error } = await (client as any).rpc('get_category_breakdown', {
    p_org_id: orgId,
    p_type: type,
    ...dateParams(dateRange),
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    category: row.category,
    amount: Number(row.amount) || 0,
    percentage: Number(row.percentage) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 4. getPropertyFinancials — uses get_property_financials RPC
// ---------------------------------------------------------------------------

export async function getPropertyFinancials(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<PropertyFinancial[]> {
  const { data, error } = await (client as any).rpc('get_property_financials', {
    p_org_id: orgId,
    ...dateParams(dateRange),
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    property_id: row.property_id,
    property_name: row.property_name,
    income: Number(row.income) || 0,
    expenses: Number(row.expenses) || 0,
    net: Number(row.net) || 0,
    roi: Number(row.roi) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 5. getRecentTransactions (unchanged — already uses LIMIT + ORDER BY)
// ---------------------------------------------------------------------------

export async function getRecentTransactions(
  client: Client,
  orgId: string,
  limit = 10,
): Promise<RecentTransaction[]> {
  const [{ data: incomeRows, error: incomeError }, { data: expenseRows, error: expenseError }] =
    await Promise.all([
      (client as any)
        .from('income')
        .select('id, amount, income_type, description, transaction_date, properties(name)')
        .eq('org_id', orgId)
        .order('transaction_date', { ascending: false })
        .limit(limit),
      (client as any)
        .from('expenses')
        .select('id, amount, expense_type, description, transaction_date, properties(name)')
        .eq('org_id', orgId)
        .order('transaction_date', { ascending: false })
        .limit(limit),
    ]);
  if (incomeError) throw incomeError;
  if (expenseError) throw expenseError;

  const transactions: RecentTransaction[] = [];

  for (const row of incomeRows ?? []) {
    transactions.push({
      id: row.id,
      type: 'income',
      amount: Number(row.amount) || 0,
      category: row.income_type ?? 'Other',
      description: row.description ?? '',
      property_name: row.properties?.name ?? 'Unknown',
      transaction_date: row.transaction_date,
    });
  }

  for (const row of expenseRows ?? []) {
    transactions.push({
      id: row.id,
      type: 'expense',
      amount: Number(row.amount) || 0,
      category: row.expense_type ?? 'Other',
      description: row.description ?? '',
      property_name: row.properties?.name ?? 'Unknown',
      transaction_date: row.transaction_date,
    });
  }

  return transactions
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 6. getProfitAndLoss — uses get_category_breakdown RPC for both sides
// ---------------------------------------------------------------------------

export async function getProfitAndLoss(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<ProfitAndLossReport> {
  const [incomeCategories, expenseCategories] = await Promise.all([
    getCategoryBreakdown(client, orgId, 'income', dateRange),
    getCategoryBreakdown(client, orgId, 'expense', dateRange),
  ]);

  const totalIncome = incomeCategories.reduce((sum, c) => sum + c.amount, 0);
  const totalExpenses = expenseCategories.reduce((sum, c) => sum + c.amount, 0);

  return {
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net_income: totalIncome - totalExpenses,
    income_categories: incomeCategories,
    expense_categories: expenseCategories,
  };
}

// ---------------------------------------------------------------------------
// 7. getCashFlowTrend — uses get_monthly_trend RPC + cumulative calc
// ---------------------------------------------------------------------------

export async function getCashFlowTrend(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<CashFlowPoint[]> {
  const monthlyTrend = await getMonthlyTrend(client, orgId, dateRange);

  let cumulative = 0;
  return monthlyTrend.map((point) => {
    const net = point.income - point.expenses;
    cumulative += net;
    return {
      month: point.month,
      income: point.income,
      expenses: point.expenses,
      net,
      cumulative,
    };
  });
}

// ---------------------------------------------------------------------------
// 8. getInvoiceAging — uses get_invoice_aging RPC
// ---------------------------------------------------------------------------

export async function getInvoiceAging(
  client: Client,
  orgId: string,
): Promise<AgingBucket[]> {
  const { data, error } = await (client as any).rpc('get_invoice_aging', {
    p_org_id: orgId,
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    bucket: row.bucket,
    count: Number(row.count) || 0,
    total_amount: Number(row.total_amount) || 0,
    total_outstanding: Number(row.total_outstanding) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 9. getRentCollectionRate — uses get_rent_collection_rate RPC
// ---------------------------------------------------------------------------

export async function getRentCollectionRate(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<CollectionRatePoint[]> {
  const { data, error } = await (client as any).rpc('get_rent_collection_rate', {
    p_org_id: orgId,
    ...dateParams(dateRange),
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    month: row.month,
    invoiced_amount: Number(row.invoiced_amount) || 0,
    collected_amount: Number(row.collected_amount) || 0,
    collection_rate: Number(row.collection_rate) || 0,
  }));
}

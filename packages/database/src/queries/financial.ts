import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';
import type {
  FinancialStats,
  MonthlyTrendPoint,
  CategoryBreakdown,
  PropertyFinancial,
  RecentTransaction,
} from '@onereal/types';

type Client = SupabaseClient<Database>;

interface DateRange {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Helper: apply date range filter to a query builder
// ---------------------------------------------------------------------------

function applyDateFilter<T>(
  query: T,
  dateRange?: DateRange,
  dateColumn = 'transaction_date',
): T {
  if (!dateRange) return query;
  // Supabase query builder supports chaining .gte/.lte
  return (query as any)
    .gte(dateColumn, dateRange.from)
    .lte(dateColumn, dateRange.to) as T;
}

// ---------------------------------------------------------------------------
// 1. getFinancialStats
// ---------------------------------------------------------------------------

export async function getFinancialStats(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<FinancialStats> {
  // Fetch income rows
  let incomeQuery = (client as any)
    .from('income')
    .select('amount')
    .eq('org_id', orgId);
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeRows, error: incomeError } = await incomeQuery;
  if (incomeError) throw incomeError;

  // Fetch expense rows
  let expenseQuery = (client as any)
    .from('expenses')
    .select('amount')
    .eq('org_id', orgId);
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseRows, error: expenseError } = await expenseQuery;
  if (expenseError) throw expenseError;

  const totalIncome = (incomeRows ?? []).reduce(
    (sum: number, r: { amount: number }) => sum + (Number(r.amount) || 0),
    0,
  );
  const totalExpenses = (expenseRows ?? []).reduce(
    (sum: number, r: { amount: number }) => sum + (Number(r.amount) || 0),
    0,
  );
  const netIncome = totalIncome - totalExpenses;

  // ROI: net / sum of purchase_prices (non-null) * 100
  const { data: properties, error: propError } = await client
    .from('properties')
    .select('purchase_price')
    .eq('org_id', orgId);
  if (propError) throw propError;

  const totalPurchasePrice = (properties ?? []).reduce(
    (sum, p) => sum + (Number(p.purchase_price) || 0),
    0,
  );
  const roi = totalPurchasePrice > 0
    ? Math.round((netIncome / totalPurchasePrice) * 100 * 100) / 100
    : 0;

  // Percentage change vs. previous period
  let incomeChange = 0;
  let expenseChange = 0;

  if (dateRange) {
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - durationMs).toISOString().split('T')[0]!;
    const prevTo = new Date(fromDate.getTime() - 1).toISOString().split('T')[0]!;
    const prevRange: DateRange = { from: prevFrom, to: prevTo };

    // Previous income
    let prevIncomeQ = (client as any)
      .from('income')
      .select('amount')
      .eq('org_id', orgId);
    prevIncomeQ = applyDateFilter(prevIncomeQ, prevRange);
    const { data: prevIncomeRows } = await prevIncomeQ;

    // Previous expenses
    let prevExpenseQ = (client as any)
      .from('expenses')
      .select('amount')
      .eq('org_id', orgId);
    prevExpenseQ = applyDateFilter(prevExpenseQ, prevRange);
    const { data: prevExpenseRows } = await prevExpenseQ;

    const prevIncome = (prevIncomeRows ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (Number(r.amount) || 0),
      0,
    );
    const prevExpenses = (prevExpenseRows ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (Number(r.amount) || 0),
      0,
    );

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
// 2. getMonthlyTrend
// ---------------------------------------------------------------------------

export async function getMonthlyTrend(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<MonthlyTrendPoint[]> {
  // Fetch income with transaction_date
  let incomeQuery = (client as any)
    .from('income')
    .select('amount, transaction_date')
    .eq('org_id', orgId);
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeRows, error: incomeError } = await incomeQuery;
  if (incomeError) throw incomeError;

  // Fetch expenses with transaction_date
  let expenseQuery = (client as any)
    .from('expenses')
    .select('amount, transaction_date')
    .eq('org_id', orgId);
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseRows, error: expenseError } = await expenseQuery;
  if (expenseError) throw expenseError;

  // Group by month (YYYY-MM)
  const monthMap = new Map<string, { income: number; expenses: number }>();

  for (const row of incomeRows ?? []) {
    const month = String(row.transaction_date).substring(0, 7); // YYYY-MM
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };
    entry.income += Number(row.amount) || 0;
    monthMap.set(month, entry);
  }

  for (const row of expenseRows ?? []) {
    const month = String(row.transaction_date).substring(0, 7);
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };
    entry.expenses += Number(row.amount) || 0;
    monthMap.set(month, entry);
  }

  // Sort by month ascending
  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      income: data.income,
      expenses: data.expenses,
    }));
}

// ---------------------------------------------------------------------------
// 3. getCategoryBreakdown
// ---------------------------------------------------------------------------

export async function getCategoryBreakdown(
  client: Client,
  orgId: string,
  type: 'income' | 'expense',
  dateRange?: DateRange,
): Promise<CategoryBreakdown[]> {
  const table = type === 'income' ? 'income' : 'expenses';
  const categoryColumn = type === 'income' ? 'income_type' : 'expense_type';

  let query = (client as any)
    .from(table)
    .select(`amount, ${categoryColumn}`)
    .eq('org_id', orgId);
  query = applyDateFilter(query, dateRange);
  const { data: rows, error } = await query;
  if (error) throw error;

  // Group by category
  const categoryMap = new Map<string, number>();
  let total = 0;

  for (const row of rows ?? []) {
    const category = String(row[categoryColumn] ?? 'Other');
    const amount = Number(row.amount) || 0;
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + amount);
    total += amount;
  }

  // Convert to array, calc percentage, sort descending
  return Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? Math.round((amount / total) * 100 * 100) / 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// 4. getPropertyFinancials
// ---------------------------------------------------------------------------

export async function getPropertyFinancials(
  client: Client,
  orgId: string,
  dateRange?: DateRange,
): Promise<PropertyFinancial[]> {
  // Get all properties for the org
  const { data: properties, error: propError } = await client
    .from('properties')
    .select('id, name, purchase_price')
    .eq('org_id', orgId);
  if (propError) throw propError;
  if (!properties || properties.length === 0) return [];

  // Fetch all income for the org (optionally filtered by date)
  let incomeQuery = (client as any)
    .from('income')
    .select('amount, property_id')
    .eq('org_id', orgId);
  incomeQuery = applyDateFilter(incomeQuery, dateRange);
  const { data: incomeRows, error: incomeError } = await incomeQuery;
  if (incomeError) throw incomeError;

  // Fetch all expenses for the org
  let expenseQuery = (client as any)
    .from('expenses')
    .select('amount, property_id')
    .eq('org_id', orgId);
  expenseQuery = applyDateFilter(expenseQuery, dateRange);
  const { data: expenseRows, error: expenseError } = await expenseQuery;
  if (expenseError) throw expenseError;

  // Build maps of property_id -> total income / expenses
  const incomeMap = new Map<string, number>();
  for (const row of incomeRows ?? []) {
    const pid = String(row.property_id);
    incomeMap.set(pid, (incomeMap.get(pid) ?? 0) + (Number(row.amount) || 0));
  }

  const expenseMap = new Map<string, number>();
  for (const row of expenseRows ?? []) {
    const pid = String(row.property_id);
    expenseMap.set(pid, (expenseMap.get(pid) ?? 0) + (Number(row.amount) || 0));
  }

  return properties.map((prop) => {
    const income = incomeMap.get(prop.id) ?? 0;
    const expenses = expenseMap.get(prop.id) ?? 0;
    const net = income - expenses;
    const purchasePrice = Number(prop.purchase_price) || 0;
    const roi = purchasePrice > 0
      ? Math.round((net / purchasePrice) * 100 * 100) / 100
      : 0;

    return {
      property_id: prop.id,
      property_name: prop.name,
      income,
      expenses,
      net,
      roi,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. getRecentTransactions
// ---------------------------------------------------------------------------

export async function getRecentTransactions(
  client: Client,
  orgId: string,
  limit = 10,
): Promise<RecentTransaction[]> {
  // Fetch recent income with property name via join
  const { data: incomeRows, error: incomeError } = await (client as any)
    .from('income')
    .select('id, amount, income_type, description, transaction_date, properties(name)')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: false })
    .limit(limit);
  if (incomeError) throw incomeError;

  // Fetch recent expenses with property name via join
  const { data: expenseRows, error: expenseError } = await (client as any)
    .from('expenses')
    .select('id, amount, expense_type, description, transaction_date, properties(name)')
    .eq('org_id', orgId)
    .order('transaction_date', { ascending: false })
    .limit(limit);
  if (expenseError) throw expenseError;

  // Merge and normalize
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

  // Sort by transaction_date descending, then take limit
  return transactions
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, limit);
}

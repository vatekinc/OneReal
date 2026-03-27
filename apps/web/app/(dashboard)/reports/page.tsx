'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useProfitAndLoss, useCashFlow, useInvoiceAging, useRentCollection } from '@onereal/accounting';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
  Card, CardContent, CardHeader, CardTitle,
  Button,
} from '@onereal/ui';
import { Download } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DateRangeFilterClient, type DateRangeValue } from '@/components/accounting/date-range-filter-client';
import { downloadCsv } from '@/lib/csv-export';

const PnlStatement = dynamic(
  () => import('@/components/reports/pnl-statement').then((m) => ({ default: m.PnlStatement })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const CashFlowChart = dynamic(
  () => import('@/components/reports/cash-flow-chart').then((m) => ({ default: m.CashFlowChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const InvoiceAgingTable = dynamic(
  () => import('@/components/reports/invoice-aging-table').then((m) => ({ default: m.InvoiceAgingTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const RentCollectionChart = dynamic(
  () => import('@/components/reports/rent-collection-chart').then((m) => ({ default: m.RentCollectionChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);

export default function ReportsPage() {
  const { activeOrg } = useUser();
  const orgId = activeOrg?.id ?? null;
  const [dateRange, setDateRange] = useState<DateRangeValue>({});
  const [activeTab, setActiveTab] = useState('pnl');
  const dateFilterDefault = activeTab === 'cash-flow' ? 'current_year' : 'current_month';

  const effectiveDateRange = dateRange.from && dateRange.to
    ? { from: dateRange.from, to: dateRange.to }
    : undefined;

  const { data: pnlData, isLoading: pnlLoading } = useProfitAndLoss(orgId, effectiveDateRange);
  const { data: cashFlowData, isLoading: cashFlowLoading } = useCashFlow(orgId, effectiveDateRange);
  const { data: agingData, isLoading: agingLoading } = useInvoiceAging(orgId);
  const { data: collectionData, isLoading: collectionLoading } = useRentCollection(orgId, effectiveDateRange);

  function exportPnl() {
    if (!pnlData) return;
    const headers = ['Category', 'Type', 'Amount'];
    const rows = [
      ...pnlData.income_categories.map((c: any) => [c.category, 'Income', c.amount]),
      ['Total Income', '', pnlData.total_income],
      ...pnlData.expense_categories.map((c: any) => [c.category, 'Expense', c.amount]),
      ['Total Expenses', '', pnlData.total_expenses],
      ['Net Income', '', pnlData.net_income],
    ];
    downloadCsv('pnl-report.csv', headers, rows);
  }

  function exportCashFlow() {
    if (!cashFlowData) return;
    const headers = ['Month', 'Income', 'Expenses', 'Net', 'Cumulative'];
    const rows = cashFlowData.map((row: any) => [
      row.month,
      row.income,
      row.expenses,
      row.net,
      row.cumulative,
    ]);
    downloadCsv('cash-flow-report.csv', headers, rows);
  }

  function exportAging() {
    if (!agingData) return;
    const headers = ['Aging Period', 'Count', 'Total Amount', 'Outstanding'];
    const rows = agingData.map((row: any) => [
      row.bucket,
      row.count,
      row.total_amount,
      row.total_outstanding,
    ]);
    downloadCsv('invoice-aging-report.csv', headers, rows);
  }

  function exportCollection() {
    if (!collectionData) return;
    const headers = ['Month', 'Invoiced', 'Collected', 'Collection Rate %'];
    const rows = collectionData.map((row: any) => [
      row.month,
      row.invoiced_amount,
      row.collected_amount,
      row.collection_rate,
    ]);
    downloadCsv('rent-collection-report.csv', headers, rows);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Financial Reports</h1>
        <DateRangeFilterClient key={dateFilterDefault} onChange={setDateRange} defaultRange={dateFilterDefault} />
      </div>

      <Tabs defaultValue="pnl" onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pnl">P&L Statement</TabsTrigger>
          <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
          <TabsTrigger value="aging">Invoice Aging</TabsTrigger>
          <TabsTrigger value="collection">Rent Collection</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Profit & Loss Statement</CardTitle>
              <Button variant="outline" size="sm" onClick={exportPnl} disabled={!pnlData}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {pnlLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : pnlData ? (
                <PnlStatement data={pnlData} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cash-flow" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Cash Flow Trend</CardTitle>
              <Button variant="outline" size="sm" onClick={exportCashFlow} disabled={!cashFlowData}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {cashFlowLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : cashFlowData ? (
                <CashFlowChart data={cashFlowData} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Receivable Aging</CardTitle>
              <Button variant="outline" size="sm" onClick={exportAging} disabled={!agingData}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {agingLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : agingData ? (
                <InvoiceAgingTable data={agingData} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collection" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Rent Collection Rate</CardTitle>
              <Button variant="outline" size="sm" onClick={exportCollection} disabled={!collectionData}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {collectionLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : collectionData ? (
                <RentCollectionChart data={collectionData} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

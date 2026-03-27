'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useTenantStatement, usePropertyStatement, useRentRoll } from '@onereal/accounting';
import { useTenants } from '@onereal/contacts';
import { useProperties } from '@onereal/portfolio';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
  Card, CardContent, CardHeader, CardTitle,
  Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { Download } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DateRangeFilterClient, type DateRangeValue } from '@/components/accounting/date-range-filter-client';
import { downloadCsv } from '@/lib/csv-export';

const TenantStatementTable = dynamic(
  () => import('@/components/reports/tenant-statement-table').then((m) => ({ default: m.TenantStatementTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const PropertyStatementTable = dynamic(
  () => import('@/components/reports/property-statement-table').then((m) => ({ default: m.PropertyStatementTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);
const RentRollTable = dynamic(
  () => import('@/components/reports/rent-roll-table').then((m) => ({ default: m.RentRollTable })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md bg-muted" /> }
);

export default function StatementsPage() {
  const { activeOrg } = useUser();
  const orgId = activeOrg?.id ?? null;

  // ── Tenant Statement state ──
  const [tenantId, setTenantId] = useState('');
  const [tenantPropertyId, setTenantPropertyId] = useState('');
  const [tenantDateRange, setTenantDateRange] = useState<DateRangeValue>({});

  // ── Property Statement state ──
  const [propertyId, setPropertyId] = useState('');
  const [propertyDateRange, setPropertyDateRange] = useState<DateRangeValue>({});

  // ── Rent Roll state ──
  const [leaseStatus, setLeaseStatus] = useState('active');
  const [rentRollPropertyId, setRentRollPropertyId] = useState('');

  // ── Data fetching ──
  const { data: tenants } = useTenants({ orgId });
  const { data: allProperties } = useProperties({ orgId });

  const tenantDateRangeEffective = tenantDateRange.from && tenantDateRange.to
    ? { from: tenantDateRange.from, to: tenantDateRange.to }
    : undefined;
  const propertyDateRangeEffective = propertyDateRange.from && propertyDateRange.to
    ? { from: propertyDateRange.from, to: propertyDateRange.to }
    : undefined;

  const { data: tenantStatementData, isLoading: tsLoading } = useTenantStatement(
    orgId, tenantId || null, tenantPropertyId || null, tenantDateRangeEffective,
  );
  const { data: propertyStatementData, isLoading: psLoading } = usePropertyStatement(
    orgId, propertyId || null, propertyDateRangeEffective,
  );
  const { data: rentRollData, isLoading: rrLoading } = useRentRoll(
    orgId, leaseStatus, rentRollPropertyId || undefined,
  );

  // ── Tenant's properties (derived from tenant data) ──
  const tenantProperties = useMemo(() => {
    if (!tenantId || !tenants) return [];
    const tenant = tenants.find((t: any) => t.id === tenantId);
    if (!tenant?.lease_tenants) return [];
    const props = new Map<string, string>();
    for (const lt of tenant.lease_tenants) {
      const prop = lt.leases?.units?.properties;
      if (prop) props.set(prop.id, prop.name);
    }
    return Array.from(props, ([id, name]) => ({ id, name }));
  }, [tenantId, tenants]);

  // Reset property when tenant changes
  function handleTenantChange(id: string) {
    setTenantId(id);
    setTenantPropertyId('');
  }

  // ── CSV exports ──
  function exportTenantStatement() {
    if (!tenantStatementData) return;
    const headers = ['Date', 'Type', 'Description', 'Reference', 'Charges', 'Payments/Credits', 'Balance'];
    const rows = tenantStatementData.map((r) => [
      r.txn_date, r.txn_type, r.description, r.reference,
      r.charge_amount.toFixed(2), r.payment_amount.toFixed(2), r.running_balance.toFixed(2),
    ]);
    downloadCsv('tenant-statement.csv', headers, rows);
  }

  function exportPropertyStatement() {
    if (!propertyStatementData) return;
    const headers = ['Date', 'Type', 'Tenant/Vendor', 'Description', 'Income', 'Expense', 'Balance'];
    const rows = propertyStatementData.map((r) => [
      r.txn_date, r.txn_type, r.tenant_or_vendor ?? '', r.description,
      r.income_amount.toFixed(2), r.expense_amount.toFixed(2), r.running_balance.toFixed(2),
    ]);
    downloadCsv('property-statement.csv', headers, rows);
  }

  function exportRentRoll() {
    if (!rentRollData) return;
    const headers = ['Tenant', 'Leases', 'Monthly Rent', 'Balance Due', 'Credit Balance', 'Net Due'];
    const rows = rentRollData.map((r) => [
      `${r.last_name}, ${r.first_name}`, String(r.lease_count),
      r.total_monthly_rent.toFixed(2), r.balance_due.toFixed(2),
      r.credit_balance.toFixed(2), r.net_due.toFixed(2),
    ]);
    downloadCsv('rent-roll.csv', headers, rows);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Statements</h1>

      <Tabs defaultValue="tenant">
        <TabsList>
          <TabsTrigger value="tenant">Tenant Statement</TabsTrigger>
          <TabsTrigger value="property">Property Statement</TabsTrigger>
          <TabsTrigger value="rent-roll">Rent Roll</TabsTrigger>
        </TabsList>

        {/* ── Tenant Statement ── */}
        <TabsContent value="tenant" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Tenant Statement</CardTitle>
              <Button variant="outline" size="sm" onClick={exportTenantStatement} disabled={!tenantStatementData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={tenantId} onValueChange={handleTenantChange}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Tenant" /></SelectTrigger>
                  <SelectContent>
                    {(tenants ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.last_name}, {t.first_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={tenantPropertyId} onValueChange={setTenantPropertyId} disabled={!tenantId}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Property" /></SelectTrigger>
                  <SelectContent>
                    {tenantProperties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangeFilterClient onChange={setTenantDateRange} />
              </div>
              {tsLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : tenantStatementData ? (
                <TenantStatementTable data={tenantStatementData} />
              ) : tenantId && tenantPropertyId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Select a tenant and property to view statement.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Property Statement ── */}
        <TabsContent value="property" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Property Statement</CardTitle>
              <Button variant="outline" size="sm" onClick={exportPropertyStatement} disabled={!propertyStatementData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Property" /></SelectTrigger>
                  <SelectContent>
                    {(allProperties ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangeFilterClient onChange={setPropertyDateRange} />
              </div>
              {psLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : propertyStatementData ? (
                <PropertyStatementTable data={propertyStatementData} />
              ) : propertyId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Select a property to view statement.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Rent Roll ── */}
        <TabsContent value="rent-roll" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle>Rent Roll</CardTitle>
              <Button variant="outline" size="sm" onClick={exportRentRoll} disabled={!rentRollData?.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Select value={leaseStatus} onValueChange={setLeaseStatus}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={rentRollPropertyId || 'all'} onValueChange={(v) => setRentRollPropertyId(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    {(allProperties ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rrLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : rentRollData ? (
                <RentRollTable data={rentRollData} leaseStatus={leaseStatus} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

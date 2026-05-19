'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { resolveDateRange } from '@/lib/date-range';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  cn,
} from '@onereal/ui';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

const EXPENSE_TYPES = [
  'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance', 'taxes',
  'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'deposit_refund', 'other',
];

export default function ExpensesPage() {
  const { activeOrg } = useUser();
  const [dateRange, setDateRange] = useState('current_year');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const resolved = useMemo(() => resolveDateRange(dateRange), [dateRange]);
  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: expenses = [], isLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    expenseType: typeFilter || undefined,
    search: search || undefined,
    from: resolved?.from,
    to: resolved?.to,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <div className="flex gap-1.5">
          {DATE_RANGES.map((r) => (
            <Button
              key={r.value}
              variant={dateRange === r.value ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setDateRange(r.value)}
              className={cn('text-xs', dateRange !== r.value && 'text-muted-foreground')}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search expenses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={propertyFilter || 'all'} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter || 'all'} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EXPENSE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (expenses as any[]).length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">No expenses for this period.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(expenses as any[]).map((e: any) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{e.transaction_date}</TableCell>
                <TableCell className="capitalize">{String(e.expense_type).replace(/_/g, ' ')}</TableCell>
                <TableCell>{e.properties?.name ?? '—'}{e.units?.unit_number ? ` · ${e.units.unit_number}` : ''}</TableCell>
                <TableCell className="max-w-[260px] truncate">{e.description}</TableCell>
                <TableCell>{e.service_providers?.name ?? (e.expense_type === 'deposit_refund' ? 'Tenant refund' : '—')}</TableCell>
                <TableCell className="text-right">${Number(e.amount).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

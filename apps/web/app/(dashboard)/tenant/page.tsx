'use client';

import { useTenantLease, useTenantInvoices } from '@onereal/tenant-portal';
import { useUser } from '@onereal/auth';
import {
  Card, CardContent, CardHeader, CardTitle, Badge,
} from '@onereal/ui';
import Link from 'next/link';
import { formatDate } from '@/lib/format-date';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  open: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  void: 'bg-gray-100 text-gray-800',
};

export default function TenantHomePage() {
  const { profile } = useUser();
  const { data: lease, isLoading: leaseLoading } = useTenantLease();
  const { data: invoices, isLoading: invoicesLoading } = useTenantInvoices('all');

  const recentInvoices = (invoices ?? []).slice(0, 5);

  const currentYear = new Date().getFullYear();
  const totalPaidThisYear = (invoices ?? [])
    .filter((inv: any) => inv.status === 'paid' && inv.due_date?.startsWith(String(currentYear)))
    .reduce((sum: number, inv: any) => sum + Number(inv.amount || 0), 0);

  const openInvoices = (invoices ?? []).filter(
    (inv: any) => inv.status === 'open' || inv.status === 'partially_paid'
  );
  const outstandingBalance = openInvoices.reduce(
    (sum: number, inv: any) => sum + Number(inv.amount || 0), 0
  );
  const nextDue = openInvoices.sort(
    (a: any, b: any) => (a.due_date || '').localeCompare(b.due_date || '')
  )[0];

  if (leaseLoading || invoicesLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        Welcome, {profile?.first_name ?? 'Tenant'}
      </h1>

      {lease ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Lease</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">
                  {lease.units?.properties?.name ?? 'Property'}, Unit {lease.units?.unit_number ?? '—'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(lease.start_date)} –{' '}
                  {lease.end_date ? formatDate(lease.end_date) : 'Ongoing'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">${Number(lease.rent_amount).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">/month</p>
              </div>
            </div>
            <div className="mt-3">
              <Badge className={lease.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}>
                {lease.status.replace('_', ' ')}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active lease found. Contact your landlord.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Paid This Year</p>
            <p className="text-2xl font-bold">${totalPaidThisYear.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Outstanding Balance</p>
            <p className="text-2xl font-bold">${outstandingBalance.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Next Due Date</p>
            <p className="text-2xl font-bold">
              {formatDate(nextDue?.due_date)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Recent Invoices</CardTitle>
          <Link href="/tenant/payments" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices found.</p>
          ) : (
            <div className="space-y-3">
              {recentInvoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium">{inv.description || `Invoice #${inv.invoice_number}`}</p>
                    <p className="text-sm text-muted-foreground">
                      Due {formatDate(inv.due_date)}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="font-semibold">${Number(inv.amount).toLocaleString()}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.displayStatus] ?? ''}`}>
                      {inv.displayStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useTenantLease } from '@onereal/tenant-portal';
import {
  Card, CardContent, CardHeader, CardTitle, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';

export default function TenantLeasePage() {
  const { data: lease, isLoading } = useTenantLease();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!lease) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Lease</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active lease found. Contact your landlord.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const charges = (lease.lease_charges ?? []).filter((c: any) => c.is_active);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">My Lease</h1>
        <Badge className={lease.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}>
          {lease.status.replace('_', ' ')}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Property & Unit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Property</p>
              <p className="font-medium">{lease.units?.properties?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unit</p>
              <p className="font-medium">{lease.units?.unit_number ?? '—'}</p>
            </div>
            {lease.units?.properties?.address && (
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-medium">{lease.units.properties.address}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lease Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Start Date</p>
              <p className="font-medium">
                {lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '—'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">End Date</p>
              <p className="font-medium">
                {lease.end_date ? new Date(lease.end_date).toLocaleDateString() : 'Ongoing'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Monthly Rent</p>
              <p className="font-medium text-lg">${Number(lease.rent_amount).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Security Deposit</p>
              <p className="font-medium">
                {lease.security_deposit ? `$${Number(lease.security_deposit).toLocaleString()}` : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {charges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Frequency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge: any) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.name}</TableCell>
                    <TableCell>${Number(charge.amount).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{charge.frequency.replace('_', ' ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

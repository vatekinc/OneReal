'use client';

import { use, useState } from 'react';
import { useUser } from '@onereal/auth';
import { useLeases, useLeaseCharges } from '@onereal/contacts';
import { LeaseDocumentUpload } from '@/components/contacts/lease-document-upload';
import { LeaseDialog } from '@/components/contacts/lease-dialog';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Button, Badge, Card, CardContent, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { Pencil, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/format-date';
import type { LeaseCharge } from '@onereal/types';

const frequencyLabels: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  one_time: 'One-Time',
};

export default function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leaseId } = use(params);
  const { activeOrg } = useUser();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const { data: leases, isLoading } = useLeases({
    orgId: activeOrg?.id ?? null,
  });

  const { data: charges } = useLeaseCharges(leaseId);

  const lease = (leases ?? []).find((l: any) => l.id === leaseId) as any;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>;
  }

  if (!lease) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Lease not found</p>
        <Link href="/contacts/tenants">
          <Button variant="link" className="mt-2 gap-2 px-0">
            <ArrowLeft className="h-4 w-4" /> Back to Tenants
          </Button>
        </Link>
      </div>
    );
  }

  const tenantNames = lease.lease_tenants
    ?.map((lt: any) => `${lt.tenants?.first_name ?? ''} ${lt.tenants?.last_name ?? ''}`.trim())
    .filter(Boolean)
    .join(', ') || 'No tenants';

  const propertyName = lease.units?.properties?.name ?? 'Unknown';
  const unitNumber = lease.units?.unit_number ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/contacts/tenants">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {propertyName} {unitNumber && `- ${unitNumber}`}
            </h1>
            <p className="text-sm text-muted-foreground">{tenantNames}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={lease.status === 'active' ? 'default' : 'secondary'}>
            {lease.status}
          </Badge>
          <Button className="gap-2" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit Lease
          </Button>
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Property</p>
                  <p className="font-medium">{propertyName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Unit</p>
                  <p className="font-medium">{unitNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tenants</p>
                  <p className="font-medium">{tenantNames}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lease Type</p>
                  <p className="font-medium">{lease.lease_type === 'month_to_month' ? 'Month-to-Month' : 'Fixed'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Start Date</p>
                  <p className="font-medium">{formatDate(lease.start_date)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">End Date</p>
                  <p className="font-medium">{formatDate(lease.end_date)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Rent</p>
                  <p className="font-medium">${Number(lease.rent_amount).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Security Deposit</p>
                  <p className="font-medium">${Number(lease.deposit_amount ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment Due Day</p>
                  <p className="font-medium">{lease.payment_due_day ? `${lease.payment_due_day}th of month` : '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lease Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <LeaseDocumentUpload leaseId={leaseId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charges" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Additional Charges</CardTitle>
            </CardHeader>
            <CardContent>
              {(!charges || (charges as any[]).length === 0) ? (
                <p className="text-sm text-muted-foreground">No additional charges</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(charges as LeaseCharge[]).map((charge) => (
                      <TableRow key={charge.id}>
                        <TableCell>{charge.name}</TableCell>
                        <TableCell>${Number(charge.amount).toLocaleString()}</TableCell>
                        <TableCell>{frequencyLabels[charge.frequency] ?? charge.frequency}</TableCell>
                        <TableCell>
                          <Badge variant={charge.is_active ? 'default' : 'secondary'}>
                            {charge.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LeaseDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        lease={lease}
      />
    </div>
  );
}

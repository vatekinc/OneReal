'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@onereal/auth';
import { useTenant, useLeases } from '@onereal/contacts';
import { deleteLease } from '@onereal/contacts/actions/delete-lease';
import { inviteTenant } from '@onereal/tenant-portal/actions/invite-tenant';
import { TenantDialog } from '@/components/contacts/tenant-dialog';
import { TenantCreditWidget } from '@/components/contacts/tenant-credit-widget';
import { LeaseDialog } from '@/components/contacts/lease-dialog';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { ArrowLeft, Pencil, Plus, Trash2, Mail, Phone, AlertTriangle, Send, CheckCircle, Clock, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  expired: 'bg-yellow-100 text-yellow-800',
  terminated: 'bg-red-100 text-red-800',
  month_to_month: 'bg-purple-100 text-purple-800',
};

function InviteStatus({ tenant }: { tenant: any }) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  async function handleInvite() {
    setLoading(true);
    const result = await inviteTenant(tenant.id);
    setLoading(false);
    if (result.success) {
      toast.success('Invite sent!');
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
    } else {
      toast.error(result.error);
    }
  }

  if (!tenant.email) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Add email to invite
      </Badge>
    );
  }

  if (tenant.user_id) {
    return (
      <Badge className="bg-green-100 text-green-800 gap-1">
        <CheckCircle className="h-3 w-3" /> Portal Active
      </Badge>
    );
  }

  if (tenant.invited_at) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> Invite Pending
        </Badge>
        <Button variant="ghost" size="sm" onClick={handleInvite} disabled={loading}>
          {loading ? 'Sending...' : 'Resend'}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={handleInvite} disabled={loading}>
      <Send className="h-4 w-4" />
      {loading ? 'Sending...' : 'Invite to Portal'}
    </Button>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const { data: tenant, isLoading } = useTenant(id);
  const { data: leasesData } = useLeases({
    orgId: activeOrg?.id ?? null,
    tenantId: id,
  });
  const leases = (leasesData ?? []) as any[];

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [leaseDialogOpen, setLeaseDialogOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<any>(null);

  async function handleDeleteLease(leaseId: string) {
    if (!confirm('Are you sure you want to delete this lease?')) return;
    const result = await deleteLease(leaseId);
    if (result.success) {
      toast.success('Lease deleted');
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    } else {
      toast.error(result.error);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading...</p>;
  if (!tenant) return <p className="text-sm text-muted-foreground p-4">Tenant not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/contacts/tenants')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{tenant.first_name} {tenant.last_name}</h1>
        <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
          {tenant.status}
        </Badge>
        <InviteStatus tenant={tenant} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Contact Information</CardTitle>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {tenant.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{tenant.email}</span>
              </div>
            )}
            {tenant.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{tenant.phone}</span>
              </div>
            )}
            {tenant.emergency_contact_name && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>Emergency: {tenant.emergency_contact_name} {tenant.emergency_contact_phone ? `(${tenant.emergency_contact_phone})` : ''}</span>
              </div>
            )}
          </div>
          {tenant.notes && (
            <p className="mt-4 text-sm text-muted-foreground">{tenant.notes}</p>
          )}
        </CardContent>
      </Card>

      <TenantCreditWidget tenantId={id} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Leases</h2>
          <Button
            size="sm"
            className="gap-2"
            onClick={() => { setEditingLease(null); setLeaseDialogOpen(true); }}
          >
            <Plus className="h-4 w-4" /> Add Lease
          </Button>
        </div>

        {leases.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="text-muted-foreground mb-4">No leases yet</p>
            <Button onClick={() => { setEditingLease(null); setLeaseDialogOpen(true); }}>
              Add first lease
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((lease: any) => (
                  <TableRow key={lease.id}>
                    <TableCell>{lease.units?.properties?.name ?? '\u2014'}</TableCell>
                    <TableCell>{lease.units?.unit_number ?? '\u2014'}</TableCell>
                    <TableCell>{lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '\u2014'}</TableCell>
                    <TableCell>{lease.end_date ? new Date(lease.end_date).toLocaleDateString() : '\u2014'}</TableCell>
                    <TableCell className="text-right font-medium">
                      {lease.rent_amount ? `$${Number(lease.rent_amount).toLocaleString()}` : '\u2014'}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusColors[lease.displayStatus ?? lease.status] ?? ''}`}>
                        {(lease.displayStatus ?? lease.status).replace('_', ' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/contacts/leases/${lease.id}`}>
                          <Button variant="ghost" size="icon">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" onClick={() => { setEditingLease(lease); setLeaseDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteLease(lease.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <TenantDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        tenant={tenant}
      />

      <LeaseDialog
        open={leaseDialogOpen}
        onOpenChange={setLeaseDialogOpen}
        lease={editingLease}
        defaultTenantId={id}
      />
    </div>
  );
}

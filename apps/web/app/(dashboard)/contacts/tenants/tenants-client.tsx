'use client';

import { useState } from 'react';
import { useTenants } from '@onereal/contacts';
import { deleteTenant } from '@onereal/contacts/actions/delete-tenant';
import { TenantDialog } from '@/components/contacts/tenant-dialog';
import {
  Button, Input,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { Tenant } from '@onereal/types';

interface TenantsClientProps {
  orgId: string;
}

export function TenantsClient({ orgId }: TenantsClientProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const { data: tenantsData, isLoading } = useTenants({
    orgId,
    search: search || undefined,
  });

  const tenants = (tenantsData ?? []) as any[];

  function getTenantLeases(tenant: any) {
    return (tenant.lease_tenants ?? []).map((lt: any) => lt.leases).filter(Boolean);
  }

  function getActiveLeaseCount(tenant: any) {
    return getTenantLeases(tenant).filter((l: any) => l.status === 'active').length;
  }

  function getPropertyNames(tenant: any): string[] {
    const names = new Set<string>();
    for (const lease of getTenantLeases(tenant)) {
      if (lease.status === 'active') {
        const propName = lease.units?.properties?.name;
        if (propName) names.add(propName);
      }
    }
    return Array.from(names);
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this tenant?')) return;
    const result = await deleteTenant(id);
    if (result.success) {
      toast.success('Tenant deleted');
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(tenant: Tenant) {
    setEditingTenant(tenant);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingTenant(null);
    setDialogOpen(true);
  }

  const hasActiveSearch = !!search;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Tenant
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading && hasActiveSearch ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : tenants.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No tenants yet</p>
          <Button onClick={handleAdd}>Add your first tenant</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead>Active Leases</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant: any) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">
                    {tenant.first_name} {tenant.last_name}
                  </TableCell>
                  <TableCell>{tenant.email ?? '\u2014'}</TableCell>
                  <TableCell>{tenant.phone ?? '\u2014'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {getPropertyNames(tenant).map((name) => (
                        <Badge key={name} variant="secondary">{name}</Badge>
                      ))}
                      {getPropertyNames(tenant).length === 0 && '\u2014'}
                    </div>
                  </TableCell>
                  <TableCell>{getActiveLeaseCount(tenant)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => router.push(`/contacts/tenants/${tenant.id}`)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(tenant)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(tenant.id)}>
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

      <TenantDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenant={editingTenant}
      />
    </div>
  );
}

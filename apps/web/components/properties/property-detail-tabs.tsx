'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger, Card, CardContent, Badge, StatCard, Button,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Switch } from '@onereal/ui';
import { DoorOpen, Percent, DollarSign, MapPin, BedDouble, Bath, Ruler, Pencil, Plus, Trash2, ExternalLink } from 'lucide-react';
import type { Property, Unit, PropertyImage } from '@onereal/types';
import { UnitTable } from './unit-table';
import { ImageGallery } from './image-gallery';
import { UnitDialog } from './unit-dialog';
import { useUser } from '@onereal/auth';
import { useLeases } from '@onereal/contacts';
import { deleteLease } from '@onereal/contacts/actions/delete-lease';
import { LeaseDialog } from '@/components/contacts/lease-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRecurringExpenses } from '@onereal/accounting';
import { updateRecurringExpense } from '@onereal/accounting/actions/update-recurring-expense';
import { deleteRecurringExpense } from '@onereal/accounting/actions/delete-recurring-expense';
import { RecurringExpenseDialog } from '@/components/accounting/recurring-expense-dialog';
import type { RecurringExpense } from '@onereal/types';

const SINGLE_UNIT_TYPES = ['single_family', 'townhouse', 'condo'];

interface PropertyDetailTabsProps {
  property: Property;
  units: Unit[];
  images: PropertyImage[];
}

export function PropertyDetailTabs({ property, units, images }: PropertyDetailTabsProps) {
  const isSingleUnit = SINGLE_UNIT_TYPES.includes(property.type);
  const mainUnit = isSingleUnit ? units[0] : null;
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const totalRent = units.reduce((sum, u) => sum + (Number(u.rent_amount) || 0), 0);
  const occupancyRate = units.length > 0 ? Math.round((occupied / units.length) * 100) : 0;

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        {!isSingleUnit && (
          <TabsTrigger value="units">Units ({units.length})</TabsTrigger>
        )}
        <TabsTrigger value="images">Images ({images.length})</TabsTrigger>
        <TabsTrigger value="leases">Leases</TabsTrigger>
        <TabsTrigger value="recurring">Recurring</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        {isSingleUnit && mainUnit ? (
          <SingleUnitOverview unit={mainUnit} property={property} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Units" value={units.length} icon={DoorOpen} description={`${occupied} occupied`} />
            <StatCard title="Occupancy" value={`${occupancyRate}%`} icon={Percent} />
            <StatCard title="Rent Potential" value={`$${totalRent.toLocaleString()}`} icon={DollarSign} description="Monthly" />
          </div>
        )}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                {property.address_line1 && <p>{property.address_line1}</p>}
                {property.address_line2 && <p>{property.address_line2}</p>}
                <p>{[property.city, property.state, property.zip].filter(Boolean).join(', ')}</p>
              </div>
            </div>
            {property.notes && <p className="text-sm text-muted-foreground">{property.notes}</p>}
            <div className="flex gap-2 flex-wrap text-sm">
              <Badge variant="outline">{property.type.replace(/_/g, ' ')}</Badge>
              {property.year_built && <Badge variant="outline">Built {property.year_built}</Badge>}
              {property.purchase_price && <Badge variant="outline">Purchased ${Number(property.purchase_price).toLocaleString()}</Badge>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {!isSingleUnit && (
        <TabsContent value="units">
          <UnitTable units={units} propertyId={property.id} />
        </TabsContent>
      )}

      <TabsContent value="images">
        <ImageGallery images={images} propertyId={property.id} />
      </TabsContent>

      <TabsContent value="leases">
        <PropertyLeases propertyId={property.id} />
      </TabsContent>

      <TabsContent value="recurring">
        <PropertyRecurringExpenses propertyId={property.id} units={units} />
      </TabsContent>
    </Tabs>
  );
}

const leaseStatusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  expired: 'bg-yellow-100 text-yellow-800',
  terminated: 'bg-red-100 text-red-800',
};

function PropertyLeases({ propertyId }: { propertyId: string }) {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const { data: leasesData } = useLeases({
    orgId: activeOrg?.id ?? null,
    propertyId,
  });
  const leases = (leasesData ?? []) as any[];
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setEditingLease(null); setLeaseDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Lease
        </Button>
      </div>
      {leases.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No leases for this property yet.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
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
                  <TableCell>
                    {lease.lease_tenants?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lease.lease_tenants.map((lt: any) => (
                          <Link key={lt.tenant_id} href={`/contacts/tenants/${lt.tenant_id}`} className="text-primary hover:underline text-sm">
                            {lt.tenants?.first_name} {lt.tenants?.last_name}
                          </Link>
                        )).reduce((prev: any, curr: any, i: number) => i === 0 ? [curr] : [...prev, <span key={`sep-${i}`} className="text-muted-foreground">,</span>, curr], [])}
                      </div>
                    ) : '\u2014'}
                  </TableCell>
                  <TableCell>{lease.units?.unit_number ?? '\u2014'}</TableCell>
                  <TableCell>{lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '\u2014'}</TableCell>
                  <TableCell>{lease.end_date ? new Date(lease.end_date).toLocaleDateString() : '\u2014'}</TableCell>
                  <TableCell className="text-right font-medium">
                    {lease.rent_amount ? `$${Number(lease.rent_amount).toLocaleString()}` : '\u2014'}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${leaseStatusColors[lease.status] ?? ''}`}>
                      {lease.status}
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
      <LeaseDialog
        open={leaseDialogOpen}
        onOpenChange={setLeaseDialogOpen}
        lease={editingLease}
        defaultPropertyId={propertyId}
      />
    </div>
  );
}

function PropertyRecurringExpenses({ propertyId, units }: { propertyId: string; units: Unit[] }) {
  const queryClient = useQueryClient();
  const { data: recurringData } = useRecurringExpenses(propertyId);
  const recurring = (recurringData ?? []) as RecurringExpense[];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring expense? Already-generated expenses will not be affected.')) return;
    const result = await deleteRecurringExpense(id);
    if (result.success) {
      toast.success('Recurring expense deleted');
      queryClient.invalidateQueries({ queryKey: ['recurring-expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggleActive(item: RecurringExpense) {
    const result = await updateRecurringExpense(item.id, {
      property_id: item.property_id,
      unit_id: item.unit_id,
      expense_type: item.expense_type as any,
      amount: item.amount,
      frequency: item.frequency,
      description: item.description,
      provider_id: item.provider_id,
      start_date: item.start_date,
      end_date: item.end_date,
      is_active: !item.is_active,
    });
    if (result.success) {
      queryClient.invalidateQueries({ queryKey: ['recurring-expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  const unitOptions = units.map((u) => ({ id: u.id, unit_number: u.unit_number ?? '' }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Recurring Expense
        </Button>
      </div>
      {recurring.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No recurring expenses set up for this property yet.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recurring.map((item) => (
                <TableRow key={item.id} className={!item.is_active ? 'opacity-50' : ''}>
                  <TableCell className="capitalize">{item.expense_type.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-right font-medium">
                    ${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="capitalize">{item.frequency}</TableCell>
                  <TableCell>{item.service_providers?.name ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={() => handleToggleActive(item)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(item); setDialogOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
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
      <RecurringExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recurringExpense={editing}
        propertyId={propertyId}
        units={unitOptions}
      />
    </div>
  );
}

function SingleUnitOverview({ unit, property }: { unit: Unit; property: Property }) {
  const [showDialog, setShowDialog] = useState(false);
  const rent = unit.rent_amount ? `$${Number(unit.rent_amount).toLocaleString()}` : '—';

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Bedrooms" value={unit.bedrooms ?? '—'} icon={BedDouble} />
        <StatCard title="Bathrooms" value={unit.bathrooms ?? '—'} icon={Bath} />
        <StatCard title="Square Feet" value={unit.square_feet?.toLocaleString() ?? '—'} icon={Ruler} />
        <StatCard title="Rent" value={rent} icon={DollarSign} description={unit.status} />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowDialog(true)}>
          <Pencil className="h-4 w-4" /> Edit Details
        </Button>
      </div>
      <UnitDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        propertyId={property.id}
        unit={unit}
      />
    </>
  );
}

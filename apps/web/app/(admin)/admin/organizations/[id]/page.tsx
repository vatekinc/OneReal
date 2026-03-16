'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getOrgDetails } from '@onereal/admin/actions/get-org-details';
import { listOrgMembers } from '@onereal/admin/actions/list-org-members';
import { listPlans } from '@onereal/admin/actions/list-plans';
import { updateOrgPlan } from '@onereal/admin/actions/update-org-plan';
import { deleteOrganization } from '@onereal/admin/actions/delete-organization';
import {
  Card, CardContent, CardHeader, CardTitle,
  Badge, Button, Input, Tabs, TabsContent, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { ArrowLeft, Building2, Users, Home, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { OrgDetail, OrgMemberListItem, PlanListItem } from '@onereal/types';

export default function AdminOrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Members pagination state
  const [members, setMembers] = useState<OrgMemberListItem[]>([]);
  const [membersTotal, setMembersTotal] = useState(0);
  const [membersPage, setMembersPage] = useState(1);
  const [membersSearch, setMembersSearch] = useState('');
  const [membersLoading, setMembersLoading] = useState(true);
  const membersPageSize = 20;

  // Plans state
  const [allPlans, setAllPlans] = useState<PlanListItem[]>([]);
  const [changingPlan, setChangingPlan] = useState(false);

  useEffect(() => {
    getOrgDetails(orgId).then((result) => {
      if (result.success) setData(result.data);
      setLoading(false);
    });
  }, [orgId]);

  useEffect(() => {
    listPlans().then((result) => {
      if (result.success) setAllPlans(result.data);
    });
  }, []);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    const result = await listOrgMembers(orgId, {
      search: membersSearch || undefined,
      page: membersPage,
      pageSize: membersPageSize,
    });
    if (result.success) {
      setMembers(result.data.items);
      setMembersTotal(result.data.total);
    }
    setMembersLoading(false);
  }, [orgId, membersSearch, membersPage]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setMembersPage(1);
  }, [membersSearch]);

  async function handlePlanChange(newPlanId: string) {
    if (!data || newPlanId === data.organization.plan.id) return;
    setChangingPlan(true);
    const result = await updateOrgPlan(orgId, newPlanId);
    if (result.success) {
      toast.success('Plan updated');
      const refreshed = await getOrgDetails(orgId);
      if (refreshed.success) setData(refreshed.data);
    } else {
      toast.error(result.error);
    }
    setChangingPlan(false);
  }

  async function handleDelete() {
    const result = await deleteOrganization(orgId);
    if (result.success) {
      toast.success('Organization deleted');
      router.push('/admin/organizations');
    } else {
      toast.error(result.error);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!data) return <p className="text-sm text-destructive">Organization not found.</p>;

  const { organization: org, properties, stats } = data;
  const occupancyRate = stats.unit_count > 0
    ? Math.round((stats.occupied_units / stats.unit_count) * 100)
    : 0;

  const statCards = [
    { label: 'Members', value: stats.member_count, icon: Users },
    { label: 'Properties', value: stats.property_count, icon: Building2 },
    { label: 'Units', value: stats.unit_count, icon: Home },
    { label: 'Occupancy', value: `${occupancyRate}%`, icon: DoorOpen },
  ];

  const membersTotalPages = Math.ceil(membersTotal / membersPageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/organizations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <Badge variant="secondary">{org.type}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {new Date(org.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Plan */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-lg font-semibold">{org.plan.name}</p>
              <p className="text-sm text-muted-foreground">
                {org.plan.max_properties === 0
                  ? 'Unlimited properties'
                  : `${stats.property_count} of ${org.plan.max_properties} properties`}
              </p>
            </div>
            <Select
              value={org.plan.id}
              onValueChange={handlePlanChange}
              disabled={changingPlan}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allPlans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Billing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Subscription</span>
            <Badge variant={
              (org as any).subscription_status === 'active' ? 'default'
              : (org as any).subscription_status === 'past_due' ? 'destructive'
              : 'secondary'
            }>
              {(org as any).subscription_status || 'none'}
            </Badge>
          </div>
          {(org as any).subscription_period && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Period</span>
              <span className="text-sm">{(org as any).subscription_period}</span>
            </div>
          )}
          {(org as any).subscription_current_period_end && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Next Billing</span>
              <span className="text-sm">
                {new Date((org as any).subscription_current_period_end).toLocaleDateString()}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Stripe Connect</span>
            <Badge variant={
              (org as any).stripe_account_status === 'active' ? 'default'
              : (org as any).stripe_account_status === 'restricted' ? 'destructive'
              : 'secondary'
            }>
              {(org as any).stripe_account_status || 'not_connected'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members ({stats.member_count})</TabsTrigger>
          <TabsTrigger value="properties">Properties ({properties.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4 space-y-4">
          <Input
            placeholder="Search members..."
            value={membersSearch}
            onChange={(e) => setMembersSearch(e.target.value)}
            className="max-w-xs"
          />

          {membersLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : members.length === 0 ? (
            <div className="rounded-lg border bg-card p-12 text-center">
              <p className="text-muted-foreground">No members found</p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id}>
                        <TableCell className="font-medium">
                          {m.first_name} {m.last_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.status === 'active' ? 'default' : 'secondary'}>
                            {m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {membersTotalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {(membersPage - 1) * membersPageSize + 1}–{Math.min(membersPage * membersPageSize, membersTotal)} of {membersTotal}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMembersPage(membersPage - 1)}
                      disabled={membersPage <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMembersPage(membersPage + 1)}
                      disabled={membersPage >= membersTotalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="properties" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.type.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[p.city, p.state].filter(Boolean).join(', ') || '\u2014'}
                    </TableCell>
                    <TableCell>{p.unit_count}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {properties.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No properties
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this organization</p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete the organization and all its data.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete Organization
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Organization"
        description={`This will permanently delete "${org.name}" and all associated data (members, properties, leases, invoices). This action cannot be undone.`}
        confirmText={org.name}
        onConfirm={handleDelete}
      />
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@onereal/auth';
import { createClient, updateOrganization, getOrgMembers, getOrgPlan } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import {
  Card, CardContent, CardHeader, CardTitle,
  Input, Label, Button, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function OrgSettingsPage() {
  const { activeOrg } = useUser();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [propertyCount, setPropertyCount] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as unknown as SupabaseClient<Database>;

  useEffect(() => {
    if (activeOrg) {
      setName(activeOrg.name);
      getOrgMembers(supabase, activeOrg.id).then(setMembers).catch(() => {});
      getOrgPlan(supabase as any, activeOrg.id).then((p: any) => setPlan(p)).catch(() => {});
      (supabase as any)
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', activeOrg.id)
        .then(({ count }: any) => setPropertyCount(count ?? 0));
    }
  }, [activeOrg, supabase]);

  async function handleSave() {
    if (!activeOrg) return;
    setSaving(true);
    try {
      await updateOrganization(supabase, activeOrg.id, { name });
      toast.success('Organization updated');
    } catch {
      toast.error('Failed to update organization');
    }
    setSaving(false);
  }

  if (!activeOrg) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Organization Settings</h1>

      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={activeOrg.slug} disabled />
            <p className="text-xs text-muted-foreground">Cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Badge variant="outline">{activeOrg.type}</Badge>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader><CardTitle>Current Plan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{plan.name}</span>
              <Badge variant="secondary">{plan.slug}</Badge>
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Properties: {propertyCount}{' '}
                {plan.max_properties > 0 ? `of ${plan.max_properties}` : '(Unlimited)'}
              </p>
              <p>
                Online Payments: {plan.features?.online_payments ? 'Enabled' : 'Not included'}
              </p>
              <p>
                Messaging: {plan.features?.messaging ? 'Enabled' : 'Not included'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {activeOrg.type === 'company' && (
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {m.profiles?.first_name} {m.profiles?.last_name}
                    </TableCell>
                    <TableCell>{m.profiles?.email}</TableCell>
                    <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-muted-foreground">
              Invite members by email coming in Phase 2.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

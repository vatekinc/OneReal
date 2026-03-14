'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@onereal/auth';
import { createClient, updateOrganization, getOrgMembers } from '@onereal/database';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as unknown as SupabaseClient<Database>;

  useEffect(() => {
    if (activeOrg) {
      setName(activeOrg.name);
      getOrgMembers(supabase, activeOrg.id).then(setMembers).catch(() => {});
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

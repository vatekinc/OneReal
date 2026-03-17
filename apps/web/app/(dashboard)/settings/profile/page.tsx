'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { createClient, updateProfile } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import {
  Card, CardContent, CardHeader, CardTitle,
  Input, Label, Button,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function ProfileSettingsPage() {
  const { profile } = useUser();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient<Database>, []);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setPhone(profile.phone || '');
    }
  }, [profile]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    try {
      await updateProfile(supabase, profile.id, {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
      });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    }
    setSaving(false);
  }

  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Profile Settings</h1>

      <Card>
        <CardHeader><CardTitle>Personal Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile.email || ''} disabled />
            <p className="text-xs text-muted-foreground">Cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Security</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            To change your password, use the &quot;Forgot password&quot; flow from the login page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

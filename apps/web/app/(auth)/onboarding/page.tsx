'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, updateProfile, createCompanyOrg } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { Card, CardContent } from '@onereal/ui';
import { ProfileStep } from '@/components/onboarding/profile-step';
import { OrgStep } from '@/components/onboarding/org-step';
import { toast } from 'sonner';

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as unknown as SupabaseClient<Database>;

  function handleProfileChange(field: string, value: string) {
    if (field === 'firstName') setFirstName(value);
    if (field === 'lastName') setLastName(value);
    if (field === 'phone') setPhone(value);
  }

  async function saveProfileAndContinue() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      await updateProfile(supabase, user.id, {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
      });

      // Check if this user was invited as a tenant
      const { data: isTenant } = await supabase.rpc('check_is_invited_tenant');

      if (isTenant) {
        // Link tenant and redirect to portal — skip org selection step
        await supabase.rpc('link_tenant_on_invite');
        router.push('/tenant');
        return;
      }

      setStep(2);
    } catch {
      toast.error('Failed to save profile');
    }
  }

  async function handleSelectPersonal() {
    setLoading(true);
    // Personal org already exists from trigger — just redirect
    router.push('/');
    router.refresh();
  }

  async function handleCreateCompany(name: string, slug: string) {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      await createCompanyOrg(supabase, user.id, name, slug);
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message.includes('duplicate') ? 'That URL is taken. Try a different name.' : message);
      setLoading(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-6">
        <div className="mb-6 flex justify-center gap-2">
          <div className={`h-2 w-16 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-16 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
        </div>
        {step === 1 ? (
          <ProfileStep
            firstName={firstName} lastName={lastName} phone={phone}
            onChange={handleProfileChange} onNext={saveProfileAndContinue}
          />
        ) : (
          <OrgStep
            onSelectPersonal={handleSelectPersonal}
            onCreateCompany={handleCreateCompany}
            loading={loading}
          />
        )}
      </CardContent>
    </Card>
  );
}

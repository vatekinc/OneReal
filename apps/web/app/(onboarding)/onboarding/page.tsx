'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient, updateProfile, createCompanyOrg, getUserOrganizations } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { Card, CardContent } from '@onereal/ui';
import { ProfileStep } from '@/components/onboarding/profile-step';
import { OrgStep } from '@/components/onboarding/org-step';
import { PlanStep } from '@/components/onboarding/plan-step';
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { toast } from 'sonner';

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plans, setPlans] = useState<any[]>([]);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient<Database>, []);

  // Fetch plans on mount
  useEffect(() => {
    (supabase as any)
      .from('plans')
      .select('id, name, slug, max_properties, features, monthly_price, yearly_price, is_default')
      .order('monthly_price', { ascending: true })
      .then(({ data }: any) => setPlans(data ?? []));
  }, [supabase]);

  // Handle return from Stripe checkout cancellation
  useEffect(() => {
    if (searchParams.get('subscription') === 'canceled') {
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('default_org_id')
          .eq('id', user.id)
          .single();
        if (profile?.default_org_id) {
          setOrgId(profile.default_org_id);
          setStep(3);
        }
      });
    }
  }, [searchParams, supabase]);

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
        await supabase.rpc('link_tenant_on_invite');
        await (supabase as any).from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
        router.push('/tenant');
        return;
      }

      setStep(2);
    } catch (err: any) {
      console.error('Onboarding profile save error:', err);
      toast.error(err?.message || 'Failed to save profile');
    }
  }

  async function handleSelectPersonal() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Personal org already exists from trigger — find it
    const orgs = await getUserOrganizations(supabase, user.id);
    const personalOrg = orgs.find((o: any) => o.organizations?.type === 'personal');
    if (personalOrg) {
      setOrgId(personalOrg.org_id);
    }
    setLoading(false);
    setStep(3);
  }

  async function handleCreateCompany(name: string, slug: string) {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    try {
      const result = await createCompanyOrg(supabase, user.id, name, slug);
      setOrgId(result.id);
      setLoading(false);
      setStep(3);
    } catch (err: any) {
      console.error('Create company error:', err);
      const message = err?.message || err?.error_description || 'Unknown error';
      toast.error(message.includes('duplicate') ? 'That URL is taken. Try a different name.' : message);
      setLoading(false);
    }
  }

  async function handleSelectFreePlan() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await (supabase as any).from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
    }
    router.push('/');
    router.refresh();
  }

  async function handleSelectPaidPlan(planId: string, period: 'monthly' | 'yearly') {
    if (!orgId) return;
    setLoading(true);

    // Mark onboarding complete before Stripe redirect (profile & org already exist)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await (supabase as any).from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
    }

    const baseUrl = window.location.origin;
    const result = await createCheckoutSession(orgId, {
      type: 'subscription',
      planId,
      period,
      successUrl: `${baseUrl}/?subscription=success`,
      cancelUrl: `${baseUrl}/onboarding?subscription=canceled`,
    });

    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setLoading(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-6">
        <div className="mb-6 flex justify-center gap-2">
          <div className={`h-2 w-16 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-16 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-16 rounded-full ${step >= 3 ? 'bg-primary' : 'bg-muted'}`} />
        </div>
        {step === 1 ? (
          <ProfileStep
            firstName={firstName} lastName={lastName} phone={phone}
            onChange={handleProfileChange} onNext={saveProfileAndContinue}
          />
        ) : step === 2 ? (
          <OrgStep
            onSelectPersonal={handleSelectPersonal}
            onCreateCompany={handleCreateCompany}
            loading={loading}
          />
        ) : (
          <PlanStep
            plans={plans}
            onSelectFree={handleSelectFreePlan}
            onSelectPaid={handleSelectPaidPlan}
            loading={loading}
          />
        )}
      </CardContent>
    </Card>
  );
}

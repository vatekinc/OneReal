'use client';

import { useState, useEffect, Suspense } from 'react';
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
import { createCheckoutSession } from '@onereal/payments/actions/create-checkout-session';
import { createConnectAccount } from '@onereal/payments/actions/create-connect-account';
import { createPortalSession } from '@onereal/payments/actions/create-portal-session';
import { getConnectStatus } from '@onereal/payments/actions/get-connect-status';
import { useSearchParams } from 'next/navigation';

export default function OrgSettingsPage() {
  return (
    <Suspense>
      <OrgSettingsContent />
    </Suspense>
  );
}

function OrgSettingsContent() {
  const { activeOrg } = useUser();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [propertyCount, setPropertyCount] = useState(0);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [upgrading, setUpgrading] = useState(false);
  const [connectStatus, setConnectStatus] = useState<'not_connected' | 'onboarding' | 'active' | 'restricted'>('not_connected');
  const [connectLoading, setConnectLoading] = useState(false);
  const [paidPlan, setPaidPlan] = useState<any>(null);
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

  // Fetch available paid plan for upgrade pricing
  useEffect(() => {
    (supabase as any)
      .from('plans')
      .select('id, name, monthly_price, yearly_price')
      .neq('slug', 'free')
      .order('monthly_price', { ascending: true })
      .limit(1)
      .single()
      .then(({ data }: any) => setPaidPlan(data));
  }, [supabase]);

  // Fetch connect status + poll after Stripe onboarding return
  useEffect(() => {
    if (!activeOrg) return;
    const fetchConnect = async () => {
      const result = await getConnectStatus(activeOrg.id);
      if (result.success) setConnectStatus(result.data.stripe_account_status);
    };
    fetchConnect();

    if (searchParams.get('stripe') === 'success') {
      const interval = setInterval(fetchConnect, 2000);
      const timeout = setTimeout(() => clearInterval(interval), 10000);
      return () => { clearInterval(interval); clearTimeout(timeout); };
    }
  }, [activeOrg, searchParams]);

  async function handleUpgrade() {
    if (!activeOrg || !paidPlan) return;
    setUpgrading(true);

    const result = await createCheckoutSession(activeOrg.id, {
      type: 'subscription',
      planId: paidPlan.id,
      period: billingPeriod,
    });

    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setUpgrading(false);
    }
  }

  async function handleManageSubscription() {
    if (!activeOrg) return;
    const result = await createPortalSession(activeOrg.id);
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
    }
  }

  async function handleConnectStripe() {
    if (!activeOrg) return;
    setConnectLoading(true);
    const result = await createConnectAccount(activeOrg.id);
    if (result.success) {
      window.location.href = result.data.url;
    } else {
      toast.error(result.error);
      setConnectLoading(false);
    }
  }

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

      {/* Past due warning */}
      {(activeOrg as any).subscription_status === 'past_due' && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">
            Your subscription payment failed. Please update your payment method to avoid losing access.
          </p>
          <Button size="sm" variant="destructive" className="mt-2" onClick={handleManageSubscription}>
            Update Payment Method
          </Button>
        </div>
      )}

      {/* Connect Stripe reminder */}
      {plan?.features?.online_payments && connectStatus === 'not_connected' && (activeOrg as any).subscription_status === 'active' && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">
            Connect your Stripe account to start accepting online rent payments from tenants.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={handleConnectStripe}>
            Connect Stripe Account
          </Button>
        </div>
      )}

      {plan && (
        <Card>
          <CardHeader><CardTitle>Current Plan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{plan.name}</span>
              <Badge variant="secondary">{plan.slug}</Badge>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Properties: {propertyCount}{' '}
                {plan.max_properties > 0 ? `of ${plan.max_properties}` : '(Unlimited)'}
              </p>
              <p>Online Payments: {plan.features?.online_payments ? 'Enabled' : 'Not included'}</p>
              <p>Messaging: {plan.features?.messaging ? 'Enabled' : 'Not included'}</p>
            </div>

            {/* Subscription status for paid plans */}
            {(activeOrg as any).subscription_status === 'active' && (activeOrg as any).subscription_current_period_end && (
              <div className="text-sm text-muted-foreground">
                <p>Billing: {(activeOrg as any).subscription_period} &middot; Next billing: {new Date((activeOrg as any).subscription_current_period_end).toLocaleDateString()}</p>
              </div>
            )}

            {/* Actions */}
            {(plan.slug === 'free' || (activeOrg as any).subscription_status === 'none') && paidPlan ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBillingPeriod('monthly')}
                  >
                    Monthly (${Number(paidPlan.monthly_price).toFixed(2)}/mo)
                  </Button>
                  {Number(paidPlan.yearly_price) > 0 && (
                    <Button
                      variant={billingPeriod === 'yearly' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setBillingPeriod('yearly')}
                    >
                      Yearly (${Number(paidPlan.yearly_price).toFixed(2)}/yr)
                    </Button>
                  )}
                </div>
                <Button onClick={handleUpgrade} disabled={upgrading}>
                  {upgrading ? 'Redirecting...' : `Upgrade to ${paidPlan.name}`}
                </Button>
              </div>
            ) : (activeOrg as any).subscription_status !== 'none' ? (
              <Button variant="outline" onClick={handleManageSubscription}>
                Manage Subscription
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Stripe Connect section */}
      {plan?.features?.online_payments && (
        <Card>
          <CardHeader><CardTitle>Online Payments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Stripe account to accept online rent payments from tenants.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={
                connectStatus === 'active' ? 'default'
                : connectStatus === 'restricted' ? 'destructive'
                : 'secondary'
              }>
                {connectStatus === 'not_connected' ? 'Not Connected'
                : connectStatus === 'onboarding' ? 'Setup Incomplete'
                : connectStatus === 'active' ? 'Connected'
                : 'Restricted'}
              </Badge>
            </div>
            {connectStatus !== 'active' && (
              <Button
                onClick={handleConnectStripe}
                disabled={connectLoading}
              >
                {connectStatus === 'not_connected'
                  ? 'Connect Stripe Account'
                  : connectStatus === 'onboarding'
                  ? 'Complete Stripe Setup'
                  : 'Update Stripe Account'}
              </Button>
            )}
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

'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Badge } from '@onereal/ui';
import { Check } from 'lucide-react';

interface PlanData {
  id: string;
  name: string;
  slug: string;
  max_properties: number;
  features: { online_payments?: boolean; messaging?: boolean };
  monthly_price: number;
  yearly_price: number;
  is_default: boolean;
}

interface PlanStepProps {
  plans: PlanData[];
  onSelectFree: () => void;
  onSelectPaid: (planId: string, period: 'monthly' | 'yearly') => void;
  loading: boolean;
}

export function PlanStep({ plans, onSelectFree, onSelectPaid, loading }: PlanStepProps) {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  const freePlan = plans.find(p => p.is_default || p.slug === 'free');
  const paidPlans = plans.filter(p => !p.is_default && p.slug !== 'free');

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Choose your plan</h2>
        <p className="text-sm text-muted-foreground">You can upgrade or downgrade anytime</p>
      </div>

      {paidPlans.length > 0 && (
        <div className="flex justify-center gap-2">
          <Button
            variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingPeriod('monthly')}
          >
            Monthly
          </Button>
          <Button
            variant={billingPeriod === 'yearly' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingPeriod('yearly')}
          >
            Yearly
            <Badge variant="secondary" className="ml-1">Save ~17%</Badge>
          </Button>
        </div>
      )}

      {freePlan && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{freePlan.name}</h3>
              <span className="text-lg font-bold">$0</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Up to {freePlan.max_properties} properties
            </p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4" /> Basic property management
              </li>
            </ul>
            <Button
              className="w-full"
              variant="outline"
              onClick={onSelectFree}
              disabled={loading}
            >
              Get Started Free
            </Button>
          </CardContent>
        </Card>
      )}

      {paidPlans.map(plan => {
        const price = billingPeriod === 'monthly'
          ? Number(plan.monthly_price)
          : Number(plan.yearly_price);
        const hasYearly = Number(plan.yearly_price) > 0;

        return (
          <Card key={plan.id} className="border-primary">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{plan.name}</h3>
                  <Badge>Recommended</Badge>
                </div>
                <span className="text-lg font-bold">
                  ${price.toFixed(2)}{billingPeriod === 'monthly' ? '/mo' : '/yr'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {plan.max_properties === 0 ? 'Unlimited' : `Up to ${plan.max_properties}`} properties
              </p>
              <ul className="text-sm space-y-1">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" /> Everything in Free
                </li>
                {plan.features.online_payments && (
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" /> Online rent payments
                  </li>
                )}
                {plan.features.messaging && (
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" /> Tenant messaging
                  </li>
                )}
              </ul>
              <Button
                className="w-full"
                onClick={() => onSelectPaid(plan.id, hasYearly ? billingPeriod : 'monthly')}
                disabled={loading}
              >
                {loading ? 'Redirecting...' : 'Subscribe'}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

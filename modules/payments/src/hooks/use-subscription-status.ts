'use client';

import { useUser } from '@onereal/auth';

export function useSubscriptionStatus() {
  const { activeOrg } = useUser();

  return {
    status: (activeOrg as any)?.subscription_status ?? 'none',
    period: (activeOrg as any)?.subscription_period ?? null,
    periodEnd: (activeOrg as any)?.subscription_current_period_end ?? null,
    isPaid: (activeOrg as any)?.subscription_status === 'active',
    isPastDue: (activeOrg as any)?.subscription_status === 'past_due',
  };
}

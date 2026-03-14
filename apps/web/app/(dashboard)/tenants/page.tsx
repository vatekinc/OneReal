import { ComingSoon } from '@/components/dashboard/coming-soon';
import { Users } from 'lucide-react';

export default function TenantsPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Tenants"
      description="Manage tenant profiles, leases, and communications."
      features={[
        'Tenant onboarding and profiles',
        'Lease management and renewals',
        'Tenant portal access',
        'Communication history',
      ]}
    />
  );
}

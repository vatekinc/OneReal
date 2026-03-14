import { ComingSoon } from '@/components/dashboard/coming-soon';
import { Wrench } from 'lucide-react';

export default function MaintenancePage() {
  return (
    <ComingSoon
      icon={Wrench}
      title="Maintenance"
      description="Handle maintenance requests and track work orders."
      features={[
        'Submit and track maintenance requests',
        'Assign contractors',
        'Priority and status tracking',
        'Photo documentation',
      ]}
    />
  );
}

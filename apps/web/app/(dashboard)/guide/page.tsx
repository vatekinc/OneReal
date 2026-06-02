'use client';

import { useRole } from '@onereal/auth';
import { UserGuide } from '@/components/guide/user-guide';

export default function GuidePage() {
  const role = useRole();

  // useRole returns null while the active org is still loading. Hold off
  // rendering so a tenant never briefly sees the landlord guide (or vice versa).
  if (role === null) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return <UserGuide role={role === 'tenant' ? 'tenant' : 'landlord'} />;
}

'use client';

import { useUser } from './use-user';

export function useRole() {
  const { organizations, activeOrg } = useUser();

  if (!activeOrg) return null;

  const membership = organizations.find((o) => o.org_id === activeOrg.id);
  return membership?.role ?? null;
}

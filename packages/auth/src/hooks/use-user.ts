'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient, getProfile, getUserOrganizations } from '@onereal/database';
import type { Database } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, Organization } from '@onereal/types';
import { useSession } from './use-session';

interface UserState {
  profile: Profile | null;
  activeOrg: Organization | null;
  organizations: Array<{ org_id: string; role: string; organizations: Organization }>;
  loading: boolean;
}

export function useUser(): UserState {
  const { session, loading: sessionLoading } = useSession();
  const supabase = useMemo(() => createClient(), []);
  const userId = session?.user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['auth-user', userId],
    queryFn: async () => {
      const typedClient = supabase as unknown as SupabaseClient<Database>;
      const [profileRaw, orgs] = await Promise.all([
        getProfile(typedClient, userId!),
        getUserOrganizations(typedClient, userId!),
      ]);

      const profile = profileRaw as Profile;
      const activeOrg = profile.default_org_id
        ? (orgs.find((o) => o.org_id === profile.default_org_id)?.organizations as Organization) ?? null
        : null;

      return {
        profile,
        activeOrg,
        organizations: orgs as UserState['organizations'],
      };
    },
    enabled: !!userId && !sessionLoading,
    staleTime: 5 * 60 * 1000,
  });

  return {
    profile: data?.profile ?? null,
    activeOrg: data?.activeOrg ?? null,
    organizations: data?.organizations ?? [],
    loading: sessionLoading || (!!userId && isLoading),
  };
}

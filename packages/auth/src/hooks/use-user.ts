'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function useUser() {
  const { session, loading: sessionLoading } = useSession();
  const [state, setState] = useState<UserState>({
    profile: null,
    activeOrg: null,
    organizations: [],
    loading: true,
  });
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setState({ profile: null, activeOrg: null, organizations: [], loading: false });
      return;
    }

    async function loadUser() {
      try {
        // Cast to the SupabaseClient<Database> that the query helpers expect
        const typedClient = supabase as unknown as SupabaseClient<Database>;
        const [profileRaw, orgs] = await Promise.all([
          getProfile(typedClient, session!.user.id),
          getUserOrganizations(typedClient, session!.user.id),
        ]);

        const profile = profileRaw as Profile;
        const activeOrg = profile.default_org_id
          ? (orgs.find((o) => o.org_id === profile.default_org_id)?.organizations as Organization) ?? null
          : null;

        setState({
          profile,
          activeOrg,
          organizations: orgs as UserState['organizations'],
          loading: false,
        });
      } catch {
        setState((prev) => ({ ...prev, loading: false }));
      }
    }

    loadUser();
  }, [session, sessionLoading, supabase]);

  return state;
}

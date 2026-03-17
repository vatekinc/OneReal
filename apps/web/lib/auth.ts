import { cache } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface AuthContext {
  user: User;
  orgId: string;
  supabase: SupabaseClient<Database>;
}

/**
 * Cached auth helper — uses getSession() instead of getUser() because
 * middleware already validated the session via getUser(). getSession()
 * reads from cookies (instant) vs getUser() which makes a network call
 * to Supabase Auth (~150-300ms). Only fetches default_org_id from profiles
 * instead of SELECT *.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  // getSession() reads from cookies — no network call.
  // Safe because middleware already validated via getUser().
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  // Only fetch the field we need, not SELECT *
  const { data: profile } = await supabase
    .from('profiles')
    .select('default_org_id')
    .eq('id', session.user.id)
    .single();

  if (!profile?.default_org_id) return null;

  return {
    user: session.user,
    orgId: profile.default_org_id,
    supabase,
  };
});

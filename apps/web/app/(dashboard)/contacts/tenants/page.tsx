import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProfile } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { TenantsClient } from './tenants-client';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default async function TenantsPage() {
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;

  // Fetch tenants with lease relations server-side
  const { data: tenants } = await (supabase as any)
    .from('tenants')
    .select('*, leases(id, status, unit_id, units(unit_number, property_id, properties(id, name)))')
    .eq('org_id', orgId)
    .order('last_name', { ascending: true });

  return <TenantsClient orgId={orgId} initialData={tenants ?? []} />;
}

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProfile, getProperties } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { MaintenanceClient } from './maintenance-client';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default async function MaintenancePage() {
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;

  // Fetch maintenance requests and properties in parallel
  const [requestsResult, propertiesResult] = await Promise.all([
    (supabase as any)
      .from('maintenance_requests')
      .select('*, units(unit_number, property_id, properties(name))')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    getProperties(supabase, { orgId }),
  ]);

  return (
    <MaintenanceClient
      orgId={orgId}
      initialRequests={requestsResult.data ?? []}
      initialProperties={propertiesResult.data ?? []}
    />
  );
}

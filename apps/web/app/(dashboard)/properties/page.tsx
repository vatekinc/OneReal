import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProfile, getProperties } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { PropertiesClient } from './properties-client';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default async function PropertiesPage() {
  const supabaseRaw = await createServerSupabaseClient();
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;
  if (!profile?.default_org_id) return null;

  const orgId = profile.default_org_id;
  const initialData = await getProperties(supabase, { orgId });

  return <PropertiesClient orgId={orgId} initialData={initialData} />;
}

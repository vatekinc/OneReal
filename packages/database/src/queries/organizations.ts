import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type OrgRow = Database['public']['Tables']['organizations']['Row'];

type Client = SupabaseClient<Database>;

export async function getOrganization(client: Client, orgId: string) {
  const { data, error } = await client
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getUserOrganizations(client: Client, userId: string) {
  const { data, error } = await client
    .from('org_members')
    .select('org_id, role, organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  return data;
}

export async function getOrgMembers(client: Client, orgId: string) {
  const { data, error } = await client
    .from('org_members')
    .select('*, profiles(*)')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (error) throw error;
  return data;
}

export async function updateOrganization(
  client: Client,
  orgId: string,
  updates: { name?: string; logo_url?: string | null }
) {
  const { data, error } = await client
    .from('organizations')
    .update(updates)
    .eq('id', orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createCompanyOrg(
  client: Client,
  _userId: string,
  name: string,
  slug: string
) {
  // Use SECURITY DEFINER RPC to bypass RLS
  // (user isn't in org_members yet, so client-side inserts fail)
  const { data, error } = await (client as any).rpc('create_company_org', {
    p_name: name,
    p_slug: slug,
  });

  if (error) throw error;

  return { id: data, name, slug, type: 'company' as const };
}

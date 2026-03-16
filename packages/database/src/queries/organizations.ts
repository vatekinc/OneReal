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
  userId: string,
  name: string,
  slug: string
) {
  // Fetch default plan
  const { data: defaultPlan } = await (client as any)
    .from('plans')
    .select('id')
    .eq('is_default', true)
    .single();

  if (!defaultPlan) throw new Error('No default plan configured');

  // Create org
  const { data: orgData, error: orgError } = await client
    .from('organizations')
    .insert({ name, slug, type: 'company', plan_id: (defaultPlan as any).id } as any)
    .select()
    .single();

  if (orgError) throw orgError;
  if (!orgData) throw new Error('Failed to create organization');

  const org = orgData as OrgRow;

  // Add user as admin
  const { error: memberError } = await client
    .from('org_members')
    .insert({ org_id: org.id, user_id: userId, role: 'admin', status: 'active' });

  if (memberError) throw memberError;

  // Set as default org
  const { error: profileError } = await client
    .from('profiles')
    .update({ default_org_id: org.id })
    .eq('id', userId);

  if (profileError) throw profileError;

  return org;
}

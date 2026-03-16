import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getOrgPlan(client: Client, orgId: string) {
  const { data, error } = await (client as any)
    .from('organizations')
    .select('plan_id, plans(id, name, slug, max_properties, features, is_default, created_at, updated_at)')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return (data as any)?.plans ?? null;
}

export async function checkFeature(
  client: Client,
  orgId: string,
  feature: string
): Promise<{ allowed: boolean; plan_name: string }> {
  const plan = await getOrgPlan(client, orgId);
  if (!plan) return { allowed: false, plan_name: 'Unknown' };
  const features = (plan.features ?? {}) as Record<string, boolean>;
  return {
    allowed: features[feature] ?? false,
    plan_name: plan.name,
  };
}

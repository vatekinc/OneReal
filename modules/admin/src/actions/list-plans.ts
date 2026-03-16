'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, PlanListItem } from '@onereal/types';

export async function listPlans(): Promise<ActionResult<PlanListItem[]>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    const { data, error } = await db
      .from('plans')
      .select('id, name, slug, max_properties, features, is_default, organizations(count)')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const items: PlanListItem[] = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      max_properties: p.max_properties,
      features: p.features ?? { online_payments: false, messaging: false },
      is_default: p.is_default,
      org_count: p.organizations?.[0]?.count ?? 0,
    }));

    return { success: true, data: items };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list plans' };
  }
}

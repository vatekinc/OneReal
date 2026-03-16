'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, Plan, PlanFeatures } from '@onereal/types';

interface UpdatePlanData {
  name?: string;
  slug?: string;
  max_properties?: number;
  features?: PlanFeatures;
  is_default?: boolean;
}

export async function updatePlan(
  planId: string,
  data: UpdatePlanData
): Promise<ActionResult<Plan>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    if (data.is_default) {
      await db
        .from('plans')
        .update({ is_default: false } as any)
        .neq('id', planId);
    }

    const updates: any = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.slug !== undefined) updates.slug = data.slug;
    if (data.max_properties !== undefined) updates.max_properties = data.max_properties;
    if (data.features !== undefined) updates.features = data.features;
    if (data.is_default !== undefined) updates.is_default = data.is_default;

    const { data: plan, error } = await db
      .from('plans')
      .update(updates)
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      if (error.message?.includes('plans_slug_key')) {
        return { success: false, error: 'A plan with this slug already exists' };
      }
      throw error;
    }

    return { success: true, data: plan as any };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update plan' };
  }
}

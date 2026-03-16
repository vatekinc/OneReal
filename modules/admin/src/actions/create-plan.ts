'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, Plan, PlanFeatures } from '@onereal/types';

interface CreatePlanData {
  name: string;
  slug: string;
  max_properties: number;
  features: PlanFeatures;
  is_default: boolean;
}

export async function createPlan(
  data: CreatePlanData
): Promise<ActionResult<Plan>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    if (data.is_default) {
      const { data: plan, error } = await db
        .from('plans')
        .insert({
          name: data.name,
          slug: data.slug,
          max_properties: data.max_properties,
          features: data.features as any,
          is_default: false,
        })
        .select()
        .single();

      if (error) {
        if (error.message?.includes('plans_slug_key')) {
          return { success: false, error: 'A plan with this slug already exists' };
        }
        throw error;
      }

      await db
        .from('plans')
        .update({ is_default: false } as any)
        .neq('id', (plan as any).id);
      await db
        .from('plans')
        .update({ is_default: true } as any)
        .eq('id', (plan as any).id);

      const { data: updated } = await db
        .from('plans')
        .select()
        .eq('id', (plan as any).id)
        .single();

      return { success: true, data: updated as any };
    }

    const { data: plan, error } = await db
      .from('plans')
      .insert({
        name: data.name,
        slug: data.slug,
        max_properties: data.max_properties,
        features: data.features as any,
        is_default: data.is_default,
      })
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
    return { success: false, error: e.message ?? 'Failed to create plan' };
  }
}

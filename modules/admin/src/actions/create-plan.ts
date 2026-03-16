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
  monthly_price?: number;
  yearly_price?: number;
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
          monthly_price: data.monthly_price ?? 0,
          yearly_price: data.yearly_price ?? 0,
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

      // Sync to Stripe if plan has pricing
      const mp = Number(data.monthly_price ?? 0);
      const yp = Number(data.yearly_price ?? 0);
      if (mp > 0 || yp > 0) {
        const { syncStripePlan } = await import('./sync-stripe-plan');
        await syncStripePlan((plan as any).id);
      }

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
        monthly_price: data.monthly_price ?? 0,
        yearly_price: data.yearly_price ?? 0,
      })
      .select()
      .single();

    if (error) {
      if (error.message?.includes('plans_slug_key')) {
        return { success: false, error: 'A plan with this slug already exists' };
      }
      throw error;
    }

    // Sync to Stripe if plan has pricing
    const mp = Number(data.monthly_price ?? 0);
    const yp = Number(data.yearly_price ?? 0);
    if (mp > 0 || yp > 0) {
      const { syncStripePlan } = await import('./sync-stripe-plan');
      await syncStripePlan((plan as any).id);
    }

    return { success: true, data: plan as any };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to create plan' };
  }
}

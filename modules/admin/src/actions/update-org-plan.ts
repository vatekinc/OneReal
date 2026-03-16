'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult } from '@onereal/types';

export async function updateOrgPlan(
  orgId: string,
  planId: string
): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    const { data: plan, error: planError } = await db
      .from('plans')
      .select('max_properties, name')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return { success: false, error: 'Plan not found' };
    }

    const maxProps = (plan as any).max_properties as number;

    if (maxProps > 0) {
      const { count } = await db
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      const propCount = count ?? 0;
      if (propCount > maxProps) {
        return {
          success: false,
          error: `Organization has ${propCount} properties but "${(plan as any).name}" plan allows ${maxProps}. Remove properties first.`,
        };
      }
    }

    const { error } = await db
      .from('organizations')
      .update({ plan_id: planId } as any)
      .eq('id', orgId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to update organization plan' };
  }
}

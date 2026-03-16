'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { propertySchema, type PropertyFormValues } from '../schemas/property-schema';

const AUTO_UNIT_TYPES = ['single_family', 'townhouse', 'condo'];

export async function createProperty(
  orgId: string,
  values: PropertyFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = propertySchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Check plan property limit
    const { data: orgWithPlan } = await db
      .from('organizations')
      .select('plans(max_properties)')
      .eq('id', orgId)
      .single();

    const maxProps = (orgWithPlan as any)?.plans?.max_properties ?? 0;
    if (maxProps > 0) {
      const { count } = await db
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      const current = count ?? 0;
      if (current >= maxProps) {
        return {
          success: false,
          error: `Property limit reached (${current}/${maxProps}). Upgrade your plan to add more.`,
        };
      }
    }

    const { data: property, error } = await db
      .from('properties')
      .insert({ ...parsed.data, org_id: orgId })
      .select('id, type')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Auto-create "Main" unit for SFH, townhouse, condo
    if (AUTO_UNIT_TYPES.includes(property.type)) {
      await db.from('units').insert({
        property_id: property.id,
        unit_number: 'Main',
        status: 'vacant',
      });
    }

    return { success: true, data: { id: property.id } };
  } catch (err) {
    return { success: false, error: 'Failed to create property' };
  }
}

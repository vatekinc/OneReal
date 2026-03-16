'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, OrgDetail } from '@onereal/types';

export async function getOrgDetails(
  orgId: string
): Promise<ActionResult<OrgDetail>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Fetch organization
    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('id, name, slug, type, created_at, settings, plans(id, name, slug, max_properties, features)')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'Organization not found' };
    }

    // Count members (loaded separately via listOrgMembers)
    const { count: memberCount } = await db
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);

    // Fetch properties with unit counts
    const { data: propsRaw } = await db
      .from('properties')
      .select('id, name, type, status, city, state, units(count)')
      .eq('org_id', orgId)
      .order('name', { ascending: true });

    const properties = (propsRaw ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      city: p.city,
      state: p.state,
      unit_count: p.units?.[0]?.count ?? 0,
    }));

    // Compute stats
    const totalUnits = properties.reduce((sum: number, p: any) => sum + p.unit_count, 0);

    // Get occupied units count
    const { count: occupiedCount } = await db
      .from('units')
      .select('id', { count: 'exact', head: true })
      .in('property_id', properties.map((p: any) => p.id))
      .eq('status', 'occupied');

    const result: OrgDetail = {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        created_at: org.created_at,
        settings: (org as any).settings ?? {},
        plan: {
          id: (org as any).plans?.id ?? '',
          name: (org as any).plans?.name ?? 'Unknown',
          slug: (org as any).plans?.slug ?? '',
          max_properties: (org as any).plans?.max_properties ?? 0,
          features: (org as any).plans?.features ?? { online_payments: false, messaging: false },
        },
      },
      properties,
      stats: {
        member_count: memberCount ?? 0,
        property_count: properties.length,
        unit_count: totalUnits,
        occupied_units: occupiedCount ?? 0,
      },
    };

    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to fetch organization details' };
  }
}

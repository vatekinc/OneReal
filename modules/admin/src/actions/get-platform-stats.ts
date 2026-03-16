'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, PlatformStats } from '@onereal/types';

export async function getPlatformStats(): Promise<ActionResult<PlatformStats>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();

    // Counts
    const [orgsRes, usersRes, propsRes, unitsRes] = await Promise.all([
      db.from('organizations').select('id', { count: 'exact', head: true }),
      db.from('profiles').select('id', { count: 'exact', head: true }),
      db.from('properties').select('id', { count: 'exact', head: true }),
      db.from('units').select('id', { count: 'exact', head: true }),
    ]);

    // Recent signups (last 5 profiles)
    const { data: recentSignups } = await db
      .from('profiles')
      .select('id, email, first_name, last_name, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Recent organizations (last 5 with member count)
    const { data: recentOrgs } = await db
      .from('organizations')
      .select('id, name, type, created_at, org_members(count)')
      .order('created_at', { ascending: false })
      .limit(5);

    const stats: PlatformStats = {
      total_organizations: orgsRes.count ?? 0,
      total_users: usersRes.count ?? 0,
      total_properties: propsRes.count ?? 0,
      total_units: unitsRes.count ?? 0,
      recent_signups: (recentSignups ?? []).map((p: any) => ({
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        created_at: p.created_at,
      })),
      recent_organizations: (recentOrgs ?? []).map((o: any) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        created_at: o.created_at,
        member_count: o.org_members?.[0]?.count ?? 0,
      })),
    };

    return { success: true, data: stats };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to fetch platform stats' };
  }
}

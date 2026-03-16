'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, OrganizationListItem } from '@onereal/types';

interface ListOrgsParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListOrgsResult {
  items: OrganizationListItem[];
  total: number;
}

export async function listOrganizations(
  params: ListOrgsParams = {}
): Promise<ActionResult<ListOrgsResult>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();
    const { search, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // Get total count
    let countQuery = db
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { count } = await countQuery;

    // Get page of orgs with member + property counts
    let query = db
      .from('organizations')
      .select('id, name, slug, type, created_at, org_members(count), properties(count)')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const items: OrganizationListItem[] = (data ?? []).map((o: any) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      created_at: o.created_at,
      member_count: o.org_members?.[0]?.count ?? 0,
      property_count: o.properties?.[0]?.count ?? 0,
    }));

    return { success: true, data: { items, total: count ?? 0 } };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list organizations' };
  }
}

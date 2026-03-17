'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, OrgMemberListItem } from '@onereal/types';

interface ListOrgMembersParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListOrgMembersResult {
  items: OrgMemberListItem[];
  total: number;
}

export async function listOrgMembers(
  orgId: string,
  params: ListOrgMembersParams = {}
): Promise<ActionResult<ListOrgMembersResult>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();
    const { search, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // Get total count
    let countQuery = db
      .from('org_members')
      .select('id, profiles(email, first_name, last_name)', { count: 'exact', head: true })
      .eq('org_id', orgId);

    if (search) {
      countQuery = countQuery.not('profiles', 'is', null).or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
        { referencedTable: 'profiles' }
      );
    }

    const { count } = await countQuery;

    // Get page of members with profile info
    let query = db
      .from('org_members')
      .select('user_id, role, status, joined_at, profiles(email, first_name, last_name)')
      .eq('org_id', orgId)
      .order('joined_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.not('profiles', 'is', null).or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
        { referencedTable: 'profiles' }
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const items: OrgMemberListItem[] = (data ?? []).map((m: any) => ({
      user_id: m.user_id,
      email: m.profiles?.email ?? null,
      first_name: m.profiles?.first_name ?? null,
      last_name: m.profiles?.last_name ?? null,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
    }));

    return { success: true, data: { items, total: count ?? 0 } };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list org members' };
  }
}

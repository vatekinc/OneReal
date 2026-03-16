'use server';

import { createServiceRoleClient } from '@onereal/database/service-role';
import { requireAdmin } from './require-admin';
import type { ActionResult, UserListItem } from '@onereal/types';

interface ListUsersParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListUsersResult {
  items: UserListItem[];
  total: number;
}

export async function listUsers(
  params: ListUsersParams = {}
): Promise<ActionResult<ListUsersResult>> {
  try {
    await requireAdmin();
    const db = createServiceRoleClient();
    const { search, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // Count
    let countQuery = db
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
      );
    }

    const { count } = await countQuery;

    // Get profiles with org membership count and default_org role (single query)
    let query = db
      .from('profiles')
      .select('id, email, first_name, last_name, avatar_url, is_platform_admin, created_at, default_org_id, org_members(count)')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.or(
        `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    // Batch-fetch primary roles for all users with a default_org_id
    const defaultOrgIds = (data ?? [])
      .filter((p: any) => p.default_org_id)
      .map((p: any) => ({ userId: p.id, orgId: p.default_org_id }));

    const roleMap = new Map<string, string>();
    if (defaultOrgIds.length > 0) {
      // Fetch all relevant memberships in a single query
      const { data: memberships } = await db
        .from('org_members')
        .select('user_id, org_id, role')
        .in('user_id', defaultOrgIds.map((d) => d.userId));

      for (const m of memberships ?? []) {
        const match = defaultOrgIds.find(
          (d) => d.userId === (m as any).user_id && d.orgId === (m as any).org_id
        );
        if (match) {
          roleMap.set((m as any).user_id, (m as any).role);
        }
      }
    }

    // Fetch ban status from Supabase Auth Admin API
    const banMap = new Map<string, boolean>();
    const { data: authUsers } = await db.auth.admin.listUsers({
      page: 1,
      perPage: 1000, // Fetch all auth users (sufficient for early-stage platform)
    });

    for (const authUser of authUsers?.users ?? []) {
      // Supabase sets banned_until to a future date when banned
      const isBanned = authUser.banned_until
        ? new Date(authUser.banned_until) > new Date()
        : false;
      banMap.set(authUser.id, isBanned);
    }

    const items: UserListItem[] = (data ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      first_name: p.first_name,
      last_name: p.last_name,
      avatar_url: p.avatar_url,
      is_platform_admin: p.is_platform_admin ?? false,
      banned: banMap.get(p.id) ?? false,
      created_at: p.created_at,
      org_count: p.org_members?.[0]?.count ?? 0,
      primary_role: roleMap.get(p.id) ?? null,
    }));

    return { success: true, data: { items, total: count ?? 0 } };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Failed to list users' };
  }
}

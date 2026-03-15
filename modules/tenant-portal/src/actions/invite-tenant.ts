'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { createServiceRoleClient } from '@onereal/database/service-role';
import type { ActionResult } from '@onereal/types';

export async function inviteTenant(
  tenantId: string
): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Fetch tenant record
    const { data: tenant, error: fetchError } = await db
      .from('tenants')
      .select('id, email, user_id, invited_at, org_id')
      .eq('id', tenantId)
      .single();

    if (fetchError || !tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    if (!tenant.email) {
      return { success: false, error: 'Tenant has no email address' };
    }

    if (tenant.user_id) {
      return { success: false, error: 'Tenant already has portal access' };
    }

    // Verify caller is a manager of this org
    const { data: membership } = await db
      .from('org_members')
      .select('role')
      .eq('org_id', tenant.org_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['admin', 'landlord', 'property_manager'].includes(membership.role)) {
      return { success: false, error: 'Not authorized to invite tenants' };
    }

    // Send invite via Supabase admin API
    const serviceClient = createServiceRoleClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
      tenant.email,
      { redirectTo: `${siteUrl}/auth/callback` }
    );

    if (inviteError) {
      return { success: false, error: inviteError.message };
    }

    // Update invited_at timestamp
    const { error: updateError } = await db
      .from('tenants')
      .update({ invited_at: new Date().toISOString() })
      .eq('id', tenantId);

    if (updateError) {
      return { success: false, error: 'Invite sent but failed to update status' };
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to send invite' };
  }
}

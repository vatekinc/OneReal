'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function createTenantConversation(
  orgId: string,
  values: {
    property_id: string | null;
    unit_id: string | null;
    initial_message: string;
  }
): Promise<ActionResult<{ id: string }>> {
  try {
    if (!values.initial_message.trim()) {
      return { success: false, error: 'Write a message' };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: convId, error } = await (supabase as any).rpc(
      'create_tenant_conversation',
      {
        p_org_id: orgId,
        p_property_id: values.property_id || null,
        p_unit_id: values.unit_id || null,
        p_initial_message: values.initial_message.trim(),
      }
    );

    if (error) return { success: false, error: error.message };

    return { success: true, data: { id: convId } };
  } catch {
    return { success: false, error: 'Failed to create conversation' };
  }
}

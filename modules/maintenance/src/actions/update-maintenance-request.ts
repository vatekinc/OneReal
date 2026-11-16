'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { getAuthorName } from '../lib/activity';
import { maintenanceUpdateSchema, type MaintenanceUpdateFormValues } from '../schemas/maintenance-schema';

export async function updateMaintenanceRequest(
  requestId: string,
  values: MaintenanceUpdateFormValues
): Promise<ActionResult> {
  try {
    const parsed = maintenanceUpdateSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const updateData: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.assigned_to !== undefined) updateData.assigned_to = parsed.data.assigned_to || null;
    if (parsed.data.estimated_cost !== undefined) updateData.estimated_cost = parsed.data.estimated_cost;
    if (parsed.data.actual_cost !== undefined) updateData.actual_cost = parsed.data.actual_cost;
    if (parsed.data.scheduled_date !== undefined) updateData.scheduled_date = parsed.data.scheduled_date || null;
    if (parsed.data.completed_date !== undefined) updateData.completed_date = parsed.data.completed_date || null;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;

    // Auto-set completed_date when status changes to 'completed'
    if (parsed.data.status === 'completed' && !parsed.data.completed_date) {
      updateData.completed_date = new Date().toISOString().split('T')[0];
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'No fields to update' };
    }

    const { data: before, error: beforeError } = await (supabase as any)
      .from('maintenance_requests')
      .select('org_id, status, priority, assigned_to, estimated_cost, actual_cost, scheduled_date, completed_date')
      .eq('id', requestId)
      .maybeSingle();
    if (beforeError) return { success: false, error: beforeError.message };
    if (!before) return { success: false, error: 'Request not found' };

    const { error } = await (supabase as any)
      .from('maintenance_requests')
      .update(updateData)
      .eq('id', requestId);

    if (error) return { success: false, error: error.message };

    // Log each changed field to the activity history (best effort: the
    // update itself has already succeeded, so a logging failure is not fatal).
    const changes = Object.entries(updateData)
      .map(([field, value]) => ({
        field,
        old_value: normalize(before[field]),
        new_value: normalize(value),
      }))
      .filter((c) => c.old_value !== c.new_value);

    if (changes.length > 0) {
      const authorName = await getAuthorName(supabase, user.id, user.email);
      await (supabase as any).from('maintenance_request_activity').insert(
        changes.map((c) => ({
          org_id: before.org_id,
          request_id: requestId,
          author_id: user.id,
          author_name: authorName,
          kind: 'change',
          ...c,
        }))
      );
    }

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to update maintenance request' };
  }
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value.toFixed(2);
  const str = String(value);
  // Numeric strings from Postgres DECIMAL come back as e.g. "150.00"
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str).toFixed(2);
  return str;
}

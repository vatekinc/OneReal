'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { sendMessageSchema, type SendMessageFormValues } from '../schemas/message-schema';

export async function sendMessage(
  conversationId: string,
  values: SendMessageFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = sendMessageSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await (supabase as any)
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: parsed.data.content,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: data.id } };
  } catch {
    return { success: false, error: 'Failed to send message' };
  }
}

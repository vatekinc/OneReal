'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';
import { createConversationSchema, type CreateConversationFormValues } from '../schemas/message-schema';

export async function createConversation(
  orgId: string,
  values: CreateConversationFormValues
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = createConversationSchema.safeParse(values);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Resolve participant: if not provided, look up the org manager (tenant flow)
    let participantUserId = parsed.data.participant_user_id;
    if (!participantUserId) {
      const { data: managerId } = await db.rpc('get_org_manager_user_id', { p_org_id: orgId });
      if (!managerId) {
        return { success: false, error: 'No landlord found to message' };
      }
      participantUserId = managerId;
    }

    // Check for existing conversation between these two users in this org
    const { data: existingParticipants } = await db
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', participantUserId);

    if (existingParticipants && existingParticipants.length > 0) {
      const existingConvIds = existingParticipants.map((p: any) => p.conversation_id);
      const { data: myParticipation } = await db
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id)
        .in('conversation_id', existingConvIds);

      if (myParticipation && myParticipation.length > 0) {
        const { data: existingConv } = await db
          .from('conversations')
          .select('id')
          .eq('org_id', orgId)
          .in('id', myParticipation.map((p: any) => p.conversation_id))
          .limit(1)
          .single();

        if (existingConv) {
          // Conversation already exists — send message there
          await db.from('messages').insert({
            conversation_id: existingConv.id,
            sender_id: user.id,
            content: parsed.data.initial_message,
          });
          return { success: true, data: { id: existingConv.id } };
        }
      }
    }

    // Create new conversation
    const { data: conv, error: convError } = await db
      .from('conversations')
      .insert({
        org_id: orgId,
        property_id: parsed.data.property_id || null,
        unit_id: parsed.data.unit_id || null,
      })
      .select('id')
      .single();

    if (convError) return { success: false, error: convError.message };

    // Add both participants
    const { error: partError } = await db
      .from('conversation_participants')
      .insert([
        { conversation_id: conv.id, user_id: user.id },
        { conversation_id: conv.id, user_id: participantUserId },
      ]);

    if (partError) return { success: false, error: partError.message };

    // Send the initial message
    const { error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conv.id,
        sender_id: user.id,
        content: parsed.data.initial_message,
      });

    if (msgError) return { success: false, error: msgError.message };

    return { success: true, data: { id: conv.id } };
  } catch {
    return { success: false, error: 'Failed to create conversation' };
  }
}

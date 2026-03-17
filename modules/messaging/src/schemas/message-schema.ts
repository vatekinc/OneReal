import { z } from 'zod';

export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty').max(5000),
});

export type SendMessageFormValues = z.infer<typeof sendMessageSchema>;

export const createConversationSchema = z.object({
  participant_user_id: z.string().uuid('Select a recipient').optional().nullable(),
  property_id: z.string().uuid().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  initial_message: z.string().min(1, 'Write a message').max(5000),
});

export type CreateConversationFormValues = z.infer<typeof createConversationSchema>;

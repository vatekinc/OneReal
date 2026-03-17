// Schemas
export { sendMessageSchema, type SendMessageFormValues } from './schemas/message-schema';
export { createConversationSchema, type CreateConversationFormValues } from './schemas/message-schema';

// Hooks (client-only)
export { useConversations } from './hooks/use-conversations';
export { useTenantConversations } from './hooks/use-tenant-conversations';
export { useMessages } from './hooks/use-messages';
export { useUnreadCount } from './hooks/use-unread-count';

// Server actions: use deep imports
// import { sendMessage } from '@onereal/messaging/actions/send-message';
// import { createConversation } from '@onereal/messaging/actions/create-conversation';
// import { markConversationRead } from '@onereal/messaging/actions/mark-read';

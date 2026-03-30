'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useSupportConversations } from '@onereal/messaging';
import { MessageThread } from '@/components/messaging/message-thread';
import { ScrollArea, Badge, cn } from '@onereal/ui';
import { Button } from '@onereal/ui';
import { Headphones, ArrowLeft } from 'lucide-react';

export default function AdminSupportPage() {
  const { profile } = useUser();
  const currentUserId = profile?.id ?? '';
  const { data: conversations, isLoading } = useSupportConversations();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');

  function selectConversation(id: string) {
    setSelectedId(id);
    setMobileView('thread');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Support Messages</h1>

      <div className="flex h-[calc(100vh-12rem)] gap-4">
        {/* Left panel: conversation list */}
        <div className={cn(
          'w-full md:w-80 shrink-0 flex flex-col border rounded-lg bg-card',
          mobileView === 'thread' && 'hidden md:flex'
        )}>
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-sm">Conversations</h2>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading...</p>
            ) : !conversations || conversations.length === 0 ? (
              <div className="p-8 text-center">
                <Headphones className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-muted-foreground">No support messages yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {conversations.map((conv: any) => {
                  const senderName = `${conv.sender_first_name ?? ''} ${conv.sender_last_name ?? ''}`.trim() || 'Unknown';
                  const hasUnread = Number(conv.unread_count) > 0;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => selectConversation(conv.id)}
                      className={cn(
                        'w-full p-3 text-left hover:bg-accent transition-colors',
                        selectedId === conv.id && 'bg-accent',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm truncate', hasUnread && 'font-semibold')}>
                            {senderName}
                          </p>
                          {conv.org_name && (
                            <p className="text-xs text-muted-foreground truncate">
                              {conv.org_name}
                            </p>
                          )}
                          {conv.last_message_content && (
                            <p className={cn('text-xs truncate mt-0.5', hasUnread ? 'text-foreground' : 'text-muted-foreground')}>
                              {conv.last_message_content.length > 50
                                ? conv.last_message_content.slice(0, 50) + '...'
                                : conv.last_message_content}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(conv.updated_at).toLocaleDateString()}
                          </span>
                          {hasUnread && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              {conv.unread_count}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right panel: message thread */}
        <div className={cn(
          'flex-1 border rounded-lg bg-card flex flex-col',
          mobileView === 'list' && 'hidden md:flex'
        )}>
          <div className="md:hidden border-b p-2">
            <Button variant="ghost" size="sm" onClick={() => setMobileView('list')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>

          {selectedId ? (
            <MessageThread conversationId={selectedId} currentUserId={currentUserId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Headphones className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Select a support conversation to reply</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

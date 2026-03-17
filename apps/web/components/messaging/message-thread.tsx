'use client';

import { useEffect, useRef, useState } from 'react';
import { useMessages } from '@onereal/messaging';
import { sendMessage } from '@onereal/messaging/actions/send-message';
import { markConversationRead } from '@onereal/messaging/actions/mark-read';
import { Button, Input, ScrollArea } from '@onereal/ui';
import { Send } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@onereal/ui';

interface MessageThreadProps {
  conversationId: string;
  currentUserId: string;
}

export function MessageThread({ conversationId, currentUserId }: MessageThreadProps) {
  const queryClient = useQueryClient();
  const { data: messages, isLoading } = useMessages(conversationId);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Mark as read on mount and when conversation changes
  useEffect(() => {
    markConversationRead(conversationId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['unread-message-count'] });
    });
  }, [conversationId, queryClient]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages && messages.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLengthRef.current = messages?.length ?? 0;
  }, [messages]);

  async function handleSend() {
    if (!content.trim() || sending) return;
    setSending(true);
    const result = await sendMessage(conversationId, { content: content.trim() });
    if (result.success) {
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['unread-message-count'] });
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Group messages by date
  function getDateLabel(dateStr: string) {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString();
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading messages...</p>
      </div>
    );
  }

  let lastDate = '';

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages?.map((msg: any) => {
            const dateLabel = getDateLabel(msg.created_at);
            const showDate = dateLabel !== lastDate;
            lastDate = dateLabel;
            const isOwn = msg.sender_id === currentUserId;
            const senderName = msg.profiles
              ? `${msg.profiles.first_name ?? ''} ${msg.profiles.last_name ?? ''}`.trim()
              : 'Unknown';

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {dateLabel}
                    </span>
                  </div>
                )}
                <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[70%] space-y-1')}>
                    {!isOwn && (
                      <p className="text-xs text-muted-foreground ml-1">{senderName}</p>
                    )}
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-2 text-sm',
                        isOwn
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                    <p className={cn('text-[10px] text-muted-foreground', isOwn ? 'text-right mr-1' : 'ml-1')}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <Button size="icon" onClick={handleSend} disabled={!content.trim() || sending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

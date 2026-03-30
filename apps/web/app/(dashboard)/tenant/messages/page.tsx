'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@onereal/auth';
import { getOrgPlan, createClient } from '@onereal/database';
import { useTenantConversations } from '@onereal/messaging';
import { createTenantConversation } from '@onereal/messaging/actions/create-tenant-conversation';
import { createSupportConversation } from '@onereal/messaging/actions/create-support-conversation';
import { useTenantLease } from '@onereal/tenant-portal';
import { MessageThread } from '@/components/messaging/message-thread';
import {
  Button, ScrollArea, Badge, cn,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Textarea,
} from '@onereal/ui';
import { Plus, MessageSquare, ArrowLeft, Headphones } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function TenantMessagesPage() {
  const { profile, activeOrg } = useUser();
  const queryClient = useQueryClient();
  const currentUserId = profile?.id ?? '';

  // Plan-based messaging gate
  const [messagingAllowed, setMessagingAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    const supabase = createClient() as any;
    getOrgPlan(supabase, activeOrg.id).then((plan: any) => {
      setMessagingAllowed(plan?.features?.messaging ?? true);
    }).catch(() => setMessagingAllowed(true));
  }, [activeOrg]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: conversations, isLoading } = useTenantConversations();
  const { data: lease } = useTenantLease();

  function getOtherParticipant(conv: any) {
    const other = conv.conversation_participants?.find(
      (p: any) => p.user_id !== currentUserId
    );
    if (!other?.profiles) return 'Landlord';
    return `${other.profiles.first_name ?? ''} ${other.profiles.last_name ?? ''}`.trim() || 'Landlord';
  }

  function getLastMessage(conv: any) {
    const msg = conv.messages?.[0];
    if (!msg) return '';
    return msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content;
  }

  function hasUnread(conv: any) {
    const myParticipant = conv.conversation_participants?.find(
      (p: any) => p.user_id === currentUserId
    );
    const lastMsg = conv.messages?.[0];
    if (!myParticipant || !lastMsg) return false;
    return lastMsg.sender_id !== currentUserId &&
      new Date(lastMsg.created_at) > new Date(myParticipant.last_read_at);
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setMobileView('thread');
  }

  async function handleNewConversation() {
    if (!lease || !newMessage.trim()) return;
    setCreating(true);

    try {
      const result = await createTenantConversation(lease.org_id, {
        property_id: lease.units?.property_id ?? null,
        unit_id: lease.unit_id ?? null,
        initial_message: newMessage.trim(),
      });

      if (result.success) {
        toast.success('Message sent');
        queryClient.invalidateQueries({ queryKey: ['tenant-conversations'] });
        setSelectedId(result.data.id);
        setMobileView('thread');
        setNewDialogOpen(false);
        setNewMessage('');
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to send message');
    }
    setCreating(false);
  }

  async function handleContactSupport() {
    if (!activeOrg || !supportMessage.trim()) return;
    setCreating(true);

    try {
      const result = await createSupportConversation(activeOrg.id, {
        initial_message: supportMessage.trim(),
      });

      if (result.success) {
        toast.success('Support message sent');
        queryClient.invalidateQueries({ queryKey: ['tenant-conversations'] });
        setSelectedId(result.data.id);
        setMobileView('thread');
        setSupportDialogOpen(false);
        setSupportMessage('');
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to send support message');
    }
    setCreating(false);
  }

  if (messagingAllowed === null) return null;

  if (messagingAllowed === false) {
    return (
      <div className="flex h-[calc(100vh-6rem)] items-center justify-center">
        <div className="text-center max-w-md">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <h2 className="text-xl font-semibold mb-2">Messaging Not Available</h2>
          <p className="text-muted-foreground">
            Messaging is not available on your organization&apos;s current plan.
            Contact your property manager for more information.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-4">
      {/* Left panel */}
      <div className={cn(
        'w-full md:w-80 shrink-0 flex flex-col border rounded-lg bg-card',
        mobileView === 'thread' && 'hidden md:flex'
      )}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Messages</h2>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setSupportDialogOpen(true)} title="Contact Support">
              <Headphones className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNewDialogOpen(true)} disabled={!lease}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading...</p>
          ) : !conversations || conversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No messages yet</p>
              {lease && (
                <Button size="sm" className="mt-3" onClick={() => setNewDialogOpen(true)}>
                  Message your landlord
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {conversations.map((conv: any) => {
                const unread = hasUnread(conv);
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
                        <div className="flex items-center gap-1.5">
                          <p className={cn('text-sm truncate', unread && 'font-semibold')}>
                            {getOtherParticipant(conv)}
                          </p>
                          {conv.type === 'support' && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">Support</Badge>
                          )}
                        </div>
                        {conv.properties && (
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.properties.name}
                          </p>
                        )}
                        <p className={cn('text-xs truncate mt-0.5', unread ? 'text-foreground' : 'text-muted-foreground')}>
                          {getLastMessage(conv)}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(conv.updated_at).toLocaleDateString()}
                        </span>
                        {unread && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
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

      {/* Right panel */}
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
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Select a conversation or start a new one</p>
            </div>
          </div>
        )}
      </div>

      {/* New Message Dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message Your Landlord</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Message *</label>
              <Textarea
                className="mt-1"
                placeholder="Describe your question or concern..."
                rows={4}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNewDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleNewConversation} disabled={!newMessage.trim() || creating}>
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Support Dialog */}
      <Dialog open={supportDialogOpen} onOpenChange={setSupportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact Support</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Send a message to the OneReal support team. We&apos;ll get back to you as soon as possible.
            </p>
            <div>
              <label className="text-sm font-medium">Message *</label>
              <Textarea
                className="mt-1"
                placeholder="How can we help you?"
                rows={4}
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSupportDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleContactSupport} disabled={!supportMessage.trim() || creating}>
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

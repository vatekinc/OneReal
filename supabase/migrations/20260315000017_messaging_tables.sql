-- Phase 6: Messaging Tables
-- 1:1 messaging between landlord and tenant with property/unit context

-- ========================================
-- 1. Tables
-- ========================================

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 2. Indexes
-- ========================================

CREATE INDEX idx_conversations_org_id ON public.conversations(org_id);
CREATE INDEX idx_conv_participants_user_id ON public.conversation_participants(user_id);
CREATE INDEX idx_conv_participants_conv_id ON public.conversation_participants(conversation_id);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id ON public.messages(sender_id);

-- ========================================
-- 3. RLS Helper: Get conversation IDs where user is a participant
-- ========================================

CREATE OR REPLACE FUNCTION public.get_user_conversation_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cp.conversation_id
  FROM public.conversation_participants cp
  WHERE cp.user_id = auth.uid();
$$;

-- ========================================
-- 4. RLS Helper: Get total unread message count
-- ========================================

CREATE OR REPLACE FUNCTION public.get_unread_message_count()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(cnt), 0)::BIGINT
  FROM (
    SELECT COUNT(*) AS cnt
    FROM public.messages m
    INNER JOIN public.conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE cp.user_id = auth.uid()
      AND m.created_at > cp.last_read_at
      AND m.sender_id != auth.uid()
  ) sub;
$$;

-- ========================================
-- 5. RLS Policies — conversations
-- ========================================

CREATE POLICY "Users can view own conversations"
  ON public.conversations FOR SELECT
  USING (id IN (SELECT public.get_user_conversation_ids()));

CREATE POLICY "Managers can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (org_id IN (SELECT public.get_user_managed_org_ids()));

CREATE POLICY "Tenants can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM public.org_members om
      WHERE om.user_id = auth.uid() AND om.status = 'active' AND om.role = 'tenant'
    )
  );

-- ========================================
-- 6. RLS Policies — conversation_participants
-- ========================================

CREATE POLICY "Users can view participants in own conversations"
  ON public.conversation_participants FOR SELECT
  USING (conversation_id IN (SELECT public.get_user_conversation_ids()));

CREATE POLICY "Participants can add to own conversations"
  ON public.conversation_participants FOR INSERT
  WITH CHECK (conversation_id IN (SELECT public.get_user_conversation_ids()));

CREATE POLICY "Users can update own participant record"
  ON public.conversation_participants FOR UPDATE
  USING (user_id = auth.uid());

-- ========================================
-- 7. RLS Policies — messages
-- ========================================

CREATE POLICY "Users can view messages in own conversations"
  ON public.messages FOR SELECT
  USING (conversation_id IN (SELECT public.get_user_conversation_ids()));

CREATE POLICY "Users can send messages in own conversations"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (SELECT public.get_user_conversation_ids())
  );

-- ========================================
-- 8. Triggers
-- ========================================

-- Update conversations.updated_at when a new message is inserted
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_conversation_updated_at
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

-- moddatetime for conversations
CREATE TRIGGER handle_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Support Conversations: Allow users to message platform admins
-- Extends existing messaging system with a conversation type field

-- ========================================
-- 1. Add type column to conversations
-- ========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.conversations
      ADD COLUMN type TEXT NOT NULL DEFAULT 'general'
      CHECK (type IN ('general', 'support'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_type ON public.conversations(type);

-- ========================================
-- 2. RPC: Create support conversation
-- ========================================

CREATE OR REPLACE FUNCTION public.create_support_conversation(
  p_org_id UUID,
  p_initial_message TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_admin_id UUID;
  v_conv_id UUID;
  v_existing_conv_id UUID;
BEGIN
  -- 1. Find a platform admin
  SELECT p.id INTO v_admin_id
  FROM public.profiles p
  WHERE p.is_platform_admin = TRUE
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No platform admin available';
  END IF;

  -- 2. Check for existing support conversation between user and admin in this org
  SELECT cp1.conversation_id INTO v_existing_conv_id
  FROM public.conversation_participants cp1
  INNER JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  INNER JOIN public.conversations c
    ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_user_id
    AND cp2.user_id = v_admin_id
    AND c.org_id = p_org_id
    AND c.type = 'support'
  LIMIT 1;

  IF v_existing_conv_id IS NOT NULL THEN
    -- Conversation exists — just send the message
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (v_existing_conv_id, v_user_id, p_initial_message);
    RETURN v_existing_conv_id;
  END IF;

  -- 3. Create new support conversation
  INSERT INTO public.conversations (org_id, type)
  VALUES (p_org_id, 'support')
  RETURNING id INTO v_conv_id;

  -- 4. Add both participants
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_user_id), (v_conv_id, v_admin_id);

  -- 5. Send initial message
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conv_id, v_user_id, p_initial_message);

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_support_conversation(UUID, TEXT) TO authenticated;

-- ========================================
-- 3. RPC: Get support conversations (for admin inbox)
-- ========================================

CREATE OR REPLACE FUNCTION public.get_support_conversations()
RETURNS TABLE (
  id UUID,
  org_id UUID,
  org_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_message_content TEXT,
  last_message_sender_id UUID,
  last_message_created_at TIMESTAMPTZ,
  sender_first_name TEXT,
  sender_last_name TEXT,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.id,
    c.org_id,
    o.name AS org_name,
    c.created_at,
    c.updated_at,
    last_msg.content AS last_message_content,
    last_msg.sender_id AS last_message_sender_id,
    last_msg.created_at AS last_message_created_at,
    sender_profile.first_name AS sender_first_name,
    sender_profile.last_name AS sender_last_name,
    COALESCE(unread.cnt, 0) AS unread_count
  FROM public.conversations c
  INNER JOIN public.organizations o ON o.id = c.org_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.sender_id, m.created_at
    FROM public.messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) last_msg ON TRUE
  LEFT JOIN public.profiles sender_profile
    ON sender_profile.id = last_msg.sender_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.messages m2
    INNER JOIN public.conversation_participants cp
      ON cp.conversation_id = m2.conversation_id AND cp.user_id = auth.uid()
    WHERE m2.conversation_id = c.id
      AND m2.created_at > cp.last_read_at
      AND m2.sender_id != auth.uid()
  ) unread ON TRUE
  WHERE c.type = 'support'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = TRUE
    )
  ORDER BY c.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_support_conversations() TO authenticated;

-- ========================================
-- 4. RPC: Get support unread count (for admin badge)
-- ========================================

CREATE OR REPLACE FUNCTION public.get_support_unread_count()
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
    INNER JOIN public.conversations c
      ON c.id = m.conversation_id
    WHERE cp.user_id = auth.uid()
      AND c.type = 'support'
      AND m.created_at > cp.last_read_at
      AND m.sender_id != auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_platform_admin = TRUE
      )
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_support_unread_count() TO authenticated;

-- ========================================
-- 5. RLS: Platform admins can view support conversations
-- ========================================

DROP POLICY IF EXISTS "Platform admins can view support conversations" ON public.conversations;
CREATE POLICY "Platform admins can view support conversations"
  ON public.conversations FOR SELECT
  USING (
    type = 'support'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = TRUE
    )
  );

DROP POLICY IF EXISTS "Platform admins can view support participants" ON public.conversation_participants;
CREATE POLICY "Platform admins can view support participants"
  ON public.conversation_participants FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE c.type = 'support'
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = TRUE
    )
  );

DROP POLICY IF EXISTS "Platform admins can view support messages" ON public.messages;
CREATE POLICY "Platform admins can view support messages"
  ON public.messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE c.type = 'support'
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = TRUE
    )
  );

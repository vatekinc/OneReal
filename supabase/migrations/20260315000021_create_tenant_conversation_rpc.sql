-- Fix: Bypass RLS entirely for tenant conversation creation using a SECURITY DEFINER function.
-- This handles: create conversation + add participants + send initial message in one atomic call.

CREATE OR REPLACE FUNCTION public.create_tenant_conversation(
  p_org_id UUID,
  p_property_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_initial_message TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID := auth.uid();
  v_manager_id UUID;
  v_conv_id UUID;
  v_existing_conv_id UUID;
BEGIN
  -- 1. Find the org manager
  SELECT om.user_id INTO v_manager_id
  FROM public.org_members om
  WHERE om.org_id = p_org_id
    AND om.role IN ('admin', 'landlord', 'property_manager')
    AND om.status = 'active'
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'No landlord found to message';
  END IF;

  -- 2. Check for existing conversation between tenant and manager in this org
  SELECT cp1.conversation_id INTO v_existing_conv_id
  FROM public.conversation_participants cp1
  INNER JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  INNER JOIN public.conversations c
    ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_tenant_id
    AND cp2.user_id = v_manager_id
    AND c.org_id = p_org_id
  LIMIT 1;

  IF v_existing_conv_id IS NOT NULL THEN
    -- Conversation exists — just send the message
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (v_existing_conv_id, v_tenant_id, p_initial_message);
    RETURN v_existing_conv_id;
  END IF;

  -- 3. Create new conversation
  INSERT INTO public.conversations (org_id, property_id, unit_id)
  VALUES (p_org_id, p_property_id, p_unit_id)
  RETURNING id INTO v_conv_id;

  -- 4. Add both participants
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_tenant_id), (v_conv_id, v_manager_id);

  -- 5. Send initial message
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conv_id, v_tenant_id, p_initial_message);

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_conversation(UUID, UUID, UUID, TEXT) TO authenticated;

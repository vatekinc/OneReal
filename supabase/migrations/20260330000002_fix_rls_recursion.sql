-- Fix: Infinite RLS recursion on profiles table
-- The support conversation policies query profiles (is_platform_admin),
-- but profiles RLS queries conversation_participants which triggers
-- conversations RLS → back to profiles → infinite loop.
--
-- Solution: SECURITY DEFINER helper that bypasses RLS when checking admin status.

-- ========================================
-- 1. Helper function (bypasses RLS)
-- ========================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = auth.uid()),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ========================================
-- 2. Replace conversations policy
-- ========================================

DROP POLICY IF EXISTS "Platform admins can view support conversations" ON public.conversations;
CREATE POLICY "Platform admins can view support conversations"
  ON public.conversations FOR SELECT
  USING (
    type = 'support'
    AND public.is_platform_admin()
  );

-- ========================================
-- 3. Replace conversation_participants policy
-- ========================================

DROP POLICY IF EXISTS "Platform admins can view support participants" ON public.conversation_participants;
CREATE POLICY "Platform admins can view support participants"
  ON public.conversation_participants FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE c.type = 'support'
    )
    AND public.is_platform_admin()
  );

-- ========================================
-- 4. Replace messages policy
-- ========================================

DROP POLICY IF EXISTS "Platform admins can view support messages" ON public.messages;
CREATE POLICY "Platform admins can view support messages"
  ON public.messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE c.type = 'support'
    )
    AND public.is_platform_admin()
  );

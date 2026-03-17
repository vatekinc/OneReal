-- Fix: Allow users to see profiles of other participants in their conversations.
-- Currently profiles RLS only allows viewing own profile (id = auth.uid()).

CREATE POLICY "Users can view conversation participant profiles"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT cp.user_id
      FROM public.conversation_participants cp
      WHERE cp.conversation_id IN (SELECT public.get_user_conversation_ids())
    )
  );

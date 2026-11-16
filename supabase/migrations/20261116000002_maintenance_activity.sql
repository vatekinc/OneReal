-- ============================================================
-- Migration: maintenance request activity log
--   One row per note or field change on a maintenance request,
--   so managers can record the progress of a ticket.
--   kind = 'note'    -> free-text progress note (body)
--   kind = 'change'  -> field change logged by the update action
--                       (field, old_value, new_value)
--   author_name is stored at write time because profile rows are
--   not readable across org members under current RLS.
--   Internal to managers for now: tenants cannot read it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.maintenance_request_activity (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id   UUID NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name  TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('note', 'change')),
  body         TEXT,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'note' OR (body IS NOT NULL AND length(trim(body)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_maintenance_activity_request
  ON public.maintenance_request_activity(request_id, created_at);

ALTER TABLE public.maintenance_request_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view maintenance activity" ON public.maintenance_request_activity;
CREATE POLICY "Managers can view maintenance activity"
  ON public.maintenance_request_activity FOR SELECT
  USING (org_id IN (SELECT public.get_user_managed_org_ids()));

DROP POLICY IF EXISTS "Managers can add maintenance activity" ON public.maintenance_request_activity;
CREATE POLICY "Managers can add maintenance activity"
  ON public.maintenance_request_activity FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_managed_org_ids())
    AND author_id = auth.uid()
    AND request_id IN (
      SELECT id FROM public.maintenance_requests
      WHERE org_id = maintenance_request_activity.org_id
    )
  );

DROP POLICY IF EXISTS "Authors can delete own maintenance notes" ON public.maintenance_request_activity;
CREATE POLICY "Authors can delete own maintenance notes"
  ON public.maintenance_request_activity FOR DELETE
  USING (
    kind = 'note'
    AND author_id = auth.uid()
    AND org_id IN (SELECT public.get_user_managed_org_ids())
  );

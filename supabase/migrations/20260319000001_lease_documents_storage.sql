-- ============================================================
-- Migration: Lease Documents Storage
-- 1. Add file_size and mime_type columns to lease_documents
-- 2. Create private storage bucket
-- 3. Create org-scoped storage policies
-- ============================================================

-- 1. Extend lease_documents table
ALTER TABLE public.lease_documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.lease_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- 2. Create private bucket for lease documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('lease-documents', 'lease-documents', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies — org-scoped via path prefix
CREATE POLICY "Org members can upload lease documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_managed_org_ids())
  );

CREATE POLICY "Org members can read lease documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
  );

CREATE POLICY "Managers can delete lease documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_managed_org_ids())
  );

# Lease Document Upload

## Overview

Allow property managers to upload lease agreement PDFs and supporting images (signed pages, amendments) to leases. Documents are stored in Supabase Storage and accessible from both the lease edit dialog and a new dedicated lease detail page.

## Storage

- **Provider:** Supabase Storage (same as existing property images)
- **Bucket:** `lease-documents` (private, not public)
- **Path structure:** `{orgId}/{leaseId}/{uuid}.{ext}`
- **Allowed types:** PDF (`.pdf`), JPEG (`.jpg`, `.jpeg`), PNG (`.png`), WebP (`.webp`)
- **Max file size:** 10MB per file
- **Max documents per lease:** 25
- **RLS policies:** Only authenticated users within the same org can read/write

## Database

The `lease_documents` table already exists (migration `20260315000007_contacts_tables.sql`):

```sql
CREATE TABLE public.lease_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  document_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add a migration to extend the table with `file_size` and `mime_type`:

```sql
ALTER TABLE public.lease_documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.lease_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
```

**Important:** The `document_url` column stores the **storage path** (e.g., `{orgId}/{leaseId}/{uuid}.pdf`), NOT a signed URL. Signed URLs are generated on-the-fly in the query hook.

Existing RLS policies:
- Managers can insert/delete
- Users can view (SELECT)

## Storage Bucket Setup

New migration to create the `lease-documents` bucket and storage policies:

```sql
-- Create private bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('lease-documents', 'lease-documents', false);

-- Authenticated users in the org can upload
CREATE POLICY "Org members can upload lease documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
  );

-- Org members can read their own documents
CREATE POLICY "Org members can read lease documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_org_ids())
  );

-- Managers can delete
CREATE POLICY "Managers can delete lease documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_managed_org_ids())
  );
```

## Server Actions

All in `modules/contacts/src/actions/`:

### `upload-lease-document.ts`

- Input: `leaseId: string`, `formData: FormData` (matching existing `upload-image.ts` pattern)
- Extracts file via `formData.get('file') as File`
- Validates file type and size (10MB max)
- Checks document count limit (25 per lease)
- Looks up lease to get `org_id` for path
- Uploads to Supabase Storage: `{orgId}/{leaseId}/{uuid}.{ext}`
- Stores the **storage path** (not signed URL) in `document_url`
- Also stores `file_size` and `mime_type`
- Returns `ActionResult<{ id: string; filename: string; storage_path: string }>`
- Uses user-scoped Supabase client (not service role) so storage RLS is enforced

### `delete-lease-document.ts`

- Input: `documentId: string`
- Looks up document record to get storage path from `document_url`
- Deletes from Supabase Storage using the stored path
- Deletes from `lease_documents` table
- Returns `ActionResult`
- Uses user-scoped Supabase client so storage RLS is enforced

### `use-lease-documents.ts` (hook, not action)

In `modules/contacts/src/hooks/`:

- Query hook: fetches all documents for a given `leaseId`
- After fetching DB records, generates signed URLs (2-hour expiry) for each document using the stored path
- Returns `{ data: (LeaseDocument & { signedUrl: string })[], isLoading }`
- Query key: `['lease-documents', leaseId]`
- Uses `LeaseDocument` type from `@onereal/types`
- `refetchInterval: 3600000` (1 hour) to refresh signed URLs before expiry

## UI Components

### 1. Lease Document Upload Component

**File:** `apps/web/components/contacts/lease-document-upload.tsx`

Follows the existing `image-upload.tsx` pattern:
- Click or drag-drop file input
- File type/size validation with toast errors
- "Uploading..." text indicator during upload (matching existing pattern, no progress bar)
- List of uploaded documents with:
  - File icon (PDF icon based on `mime_type`, or image thumbnail)
  - Filename and file size
  - Upload date
  - Download button (opens signed URL)
  - Delete button (with confirmation)
- React Query invalidation on upload/delete

Props: `{ leaseId: string }`

### 2. Lease Dialog Enhancement

**File:** `apps/web/components/contacts/lease-dialog.tsx`

- Add a "Documents" section at the bottom of the dialog
- Only visible when editing an existing lease (not during creation, since no lease ID exists yet)
- Renders the `LeaseDocumentUpload` component with the lease ID
- Compact layout to fit within the dialog

### 3. Lease Detail Page (New)

**File:** `apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx`

A new dedicated page with three tabs:

**Details tab:**
- Read-only display of lease information (property, unit, tenants, dates, rent, charges)
- "Edit Lease" button that opens the existing LeaseDialog

**Documents tab:**
- Full-width `LeaseDocumentUpload` component
- More spacious layout than the dialog version
- Document preview for images (lightbox or inline)

**Charges tab:**
- List of additional charges (already managed in LeaseDialog, shown read-only here)

### 4. Navigation to Lease Detail

Add clickable lease rows/links from:
- Property detail tabs (lease list) -> links to `/contacts/leases/[id]`
- Tenant detail page (lease list) -> links to `/contacts/leases/[id]`

## File Access

Since the bucket is private, documents are accessed via **signed URLs**:
- Generated on-the-fly in the `use-lease-documents` hook (not stored in DB)
- 2-hour expiry for comfortable browsing sessions
- Hook refetches every hour to keep URLs fresh
- The `document_url` DB column stores the storage path for URL generation and deletion

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260319000001_lease_documents_storage.sql` | NEW - bucket + storage policies + table columns |
| `modules/contacts/src/actions/upload-lease-document.ts` | NEW - upload server action |
| `modules/contacts/src/actions/delete-lease-document.ts` | NEW - delete server action |
| `modules/contacts/src/hooks/use-lease-documents.ts` | NEW - query hook with signed URL generation |
| `apps/web/components/contacts/lease-document-upload.tsx` | NEW - upload UI component |
| `apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx` | NEW - lease detail page |
| `apps/web/components/contacts/lease-dialog.tsx` | MODIFY - add documents section |
| `apps/web/components/properties/property-detail-tabs.tsx` | MODIFY - link to lease detail |
| `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx` | MODIFY - link to lease detail |

## Acceptance Criteria

1. Upload a PDF to a lease -> file appears in storage bucket and DB record created
2. Upload an image (JPEG/PNG) -> same behavior
3. Reject files over 10MB or wrong type with clear error message
4. Reject upload when document count exceeds 25 per lease
5. Delete a document -> removed from storage and DB
6. View documents in lease dialog (edit mode)
7. View documents on lease detail page
8. Download a document via signed URL
9. Documents are org-isolated (RLS prevents cross-org access)
10. Lease detail page shows Details, Documents, and Charges tabs

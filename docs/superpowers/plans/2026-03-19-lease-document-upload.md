# Lease Document Upload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow property managers to upload lease PDFs and images to leases via Supabase Storage, viewable in both the lease dialog and a new lease detail page.

**Architecture:** Private Supabase Storage bucket (`lease-documents`) with org-scoped RLS. Storage path stores in `document_url` column; signed URLs generated on-the-fly. Upload/delete via server actions following the existing `upload-image.ts` pattern. New lease detail page at `/contacts/leases/[id]` with tabs.

**Tech Stack:** Supabase Storage, Next.js server actions, React Query, shadcn/ui components, Zod

**Spec:** `docs/superpowers/specs/2026-03-19-lease-document-upload-design.md`

---

## Chunk 1: Database & Storage Infrastructure

### Task 1: Migration — Storage Bucket + Table Columns

**Files:**
- Create: `supabase/migrations/20260319000001_lease_documents_storage.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `cd Personal/OneReal && npx supabase db push --linked`
Expected: Migration applies successfully

- [ ] **Step 3: Update LeaseDocument type**

Modify: `packages/types/src/models.ts`

Find the existing `LeaseDocument` interface and update:

```typescript
export interface LeaseDocument {
  id: string;
  lease_id: string;
  filename: string;
  document_url: string; // stores storage path, not URL
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260319000001_lease_documents_storage.sql packages/types/src/models.ts
git commit -m "feat: add lease documents storage bucket and extend table"
```

---

## Chunk 2: Server Actions & Hook

### Task 2: Upload Lease Document Action

**Files:**
- Create: `modules/contacts/src/actions/upload-lease-document.ts`

- [ ] **Step 1: Write the upload action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOCS_PER_LEASE = 25;

export async function uploadLeaseDocument(
  leaseId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string; filename: string; storage_path: string }>> {
  try {
    const file = formData.get('file') as File;
    if (!file) return { success: false, error: 'No file provided' };

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File must be less than 10MB' };
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { success: false, error: 'Only PDF, JPEG, PNG, and WebP files are accepted' };
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get lease to find org_id
    const { data: lease, error: leaseError } = await db
      .from('leases')
      .select('org_id')
      .eq('id', leaseId)
      .single();

    if (leaseError || !lease) {
      return { success: false, error: 'Lease not found' };
    }

    // Check document count
    const { count } = await db
      .from('lease_documents')
      .select('id', { count: 'exact', head: true })
      .eq('lease_id', leaseId);

    if ((count ?? 0) >= MAX_DOCS_PER_LEASE) {
      return { success: false, error: `Maximum ${MAX_DOCS_PER_LEASE} documents per lease` };
    }

    // Upload to storage
    const ext = file.name.split('.').pop();
    const storagePath = `${lease.org_id}/${leaseId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('lease-documents')
      .upload(storagePath, file);

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Create DB record (store path, not URL)
    const { data, error } = await db
      .from('lease_documents')
      .insert({
        lease_id: leaseId,
        filename: file.name,
        document_url: storagePath,
        file_size: file.size,
        mime_type: file.type,
      })
      .select('id, filename, document_url')
      .single();

    if (error) {
      // Cleanup storage on DB error
      await supabase.storage.from('lease-documents').remove([storagePath]);
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data.id, filename: data.filename, storage_path: data.document_url } };
  } catch (err) {
    return { success: false, error: 'Failed to upload document' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/actions/upload-lease-document.ts
git commit -m "feat: add upload lease document server action"
```

### Task 3: Delete Lease Document Action

**Files:**
- Create: `modules/contacts/src/actions/delete-lease-document.ts`

- [ ] **Step 1: Write the delete action**

```typescript
'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import type { ActionResult } from '@onereal/types';

export async function deleteLeaseDocument(documentId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const db = supabase as any;

    // Get document to find storage path
    const { data: doc, error: fetchError } = await db
      .from('lease_documents')
      .select('document_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !doc) {
      return { success: false, error: 'Document not found' };
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('lease-documents')
      .remove([doc.document_url]);

    if (storageError) {
      return { success: false, error: storageError.message };
    }

    // Delete DB record
    const { error: deleteError } = await db
      .from('lease_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: 'Failed to delete document' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/contacts/src/actions/delete-lease-document.ts
git commit -m "feat: add delete lease document server action"
```

### Task 4: Lease Documents Query Hook

**Files:**
- Create: `modules/contacts/src/hooks/use-lease-documents.ts`
- Modify: `modules/contacts/src/index.ts`

- [ ] **Step 1: Write the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@onereal/database';
import type { LeaseDocument } from '@onereal/types';

export function useLeaseDocuments(leaseId: string | null) {
  return useQuery({
    queryKey: ['lease-documents', leaseId],
    queryFn: async () => {
      const supabase = createClient();
      const db = supabase as any;

      const { data, error } = await db
        .from('lease_documents')
        .select('*')
        .eq('lease_id', leaseId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      // Generate signed URLs for each document
      const docs = (data ?? []) as LeaseDocument[];
      const withUrls = await Promise.all(
        docs.map(async (doc) => {
          const { data: signedData } = await supabase.storage
            .from('lease-documents')
            .createSignedUrl(doc.document_url, 7200); // 2 hours

          return {
            ...doc,
            signedUrl: signedData?.signedUrl ?? '',
          };
        }),
      );

      return withUrls;
    },
    enabled: !!leaseId,
    refetchInterval: 3600000, // Refresh signed URLs every hour
  });
}
```

- [ ] **Step 2: Export from module barrel**

Add to `modules/contacts/src/index.ts`:

```typescript
export { useLeaseDocuments } from './hooks/use-lease-documents';
```

- [ ] **Step 3: Commit**

```bash
git add modules/contacts/src/hooks/use-lease-documents.ts modules/contacts/src/index.ts
git commit -m "feat: add use-lease-documents query hook with signed URLs"
```

---

## Chunk 3: Upload UI Component

### Task 5: Lease Document Upload Component

**Files:**
- Create: `apps/web/components/contacts/lease-document-upload.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client';

import { useRef, useState } from 'react';
import { Button } from '@onereal/ui';
import { Upload, FileText, Image, Download, Trash2 } from 'lucide-react';
import { uploadLeaseDocument } from '@onereal/contacts/actions/upload-lease-document';
import { deleteLeaseDocument } from '@onereal/contacts/actions/delete-lease-document';
import { useLeaseDocuments } from '@onereal/contacts';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function LeaseDocumentUpload({ leaseId }: { leaseId: string }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: documents, isLoading } = useLeaseDocuments(leaseId);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const result = await uploadLeaseDocument(leaseId, formData);
      if (!result.success) {
        toast.error(`${file.name}: ${result.error}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['lease-documents', leaseId] });
    setUploading(false);
    toast.success('Documents uploaded');
  }

  async function handleDelete(docId: string, filename: string) {
    if (!confirm(`Delete "${filename}"?`)) return;
    const result = await deleteLeaseDocument(docId);
    if (result.success) {
      toast.success('Document deleted');
      queryClient.invalidateQueries({ queryKey: ['lease-documents', leaseId] });
    } else {
      toast.error(result.error);
    }
  }

  function formatFileSize(bytes: number | null) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isPdf(mimeType: string | null) {
    return mimeType === 'application/pdf';
  }

  return (
    <div className="space-y-4">
      <div
        className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:border-primary"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-center">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {uploading ? 'Uploading...' : 'Click or drag files here'}
          </p>
          <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, WebP · Max 10MB</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents...</p>
      ) : documents && documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                {isPdf(doc.mime_type) ? (
                  <FileText className="h-5 w-5 text-red-500" />
                ) : (
                  <Image className="h-5 w-5 text-blue-500" />
                )}
                <div>
                  <p className="text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(doc.file_size)}
                    {doc.uploaded_at && ` · ${new Date(doc.uploaded_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => doc.signedUrl && window.open(doc.signedUrl, '_blank')}
                  disabled={!doc.signedUrl}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(doc.id, doc.filename)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/contacts/lease-document-upload.tsx
git commit -m "feat: add lease document upload UI component"
```

---

## Chunk 4: Integrate Into Lease Dialog

### Task 6: Add Documents Section to Lease Dialog

**Files:**
- Modify: `apps/web/components/contacts/lease-dialog.tsx`

- [ ] **Step 1: Add import**

Add at the top of the file with other imports:

```typescript
import { LeaseDocumentUpload } from './lease-document-upload';
```

- [ ] **Step 2: Add documents section before the submit buttons**

Find the closing `</form>` area. Add a documents section after the form fields but before the button row. Insert right before the `<div className="flex justify-end gap-2">` line:

```typescript
            {isEditing && (
              <div className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-medium">Documents</h3>
                <LeaseDocumentUpload leaseId={invoice!.id} />
              </div>
            )}
```

Wait — the dialog receives a `lease` prop, not `invoice`. Check the actual prop name. The lease dialog uses `defaultValues` from `lease` prop. The lease ID is available when editing. Adjust:

Read the lease dialog to find the exact prop name and where the lease ID is accessed. The `isEditing` flag is `!!lease` where `lease` is the prop. The lease ID is `lease.id`.

The correct insertion:

```typescript
            {isEditing && lease && (
              <div className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-medium">Documents</h3>
                <LeaseDocumentUpload leaseId={lease.id} />
              </div>
            )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/contacts/lease-dialog.tsx
git commit -m "feat: add documents section to lease dialog"
```

---

## Chunk 5: Lease Detail Page

### Task 7: Create Lease Detail Page

**Files:**
- Create: `apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
'use client';

import { use } from 'react';
import { useUser } from '@onereal/auth';
import { useLeases, useLeaseDocuments, useLeaseCharges } from '@onereal/contacts';
import { LeaseDocumentUpload } from '@/components/contacts/lease-document-upload';
import { LeaseDialog } from '@/components/contacts/lease-dialog';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Button, Badge, Card, CardContent, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { Pencil, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export default function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leaseId } = use(params);
  const { activeOrg } = useUser();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const { data: leases, isLoading } = useLeases({
    orgId: activeOrg?.id ?? null,
  });

  const { data: charges } = useLeaseCharges(leaseId);

  const lease = (leases ?? []).find((l: any) => l.id === leaseId) as any;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>;
  }

  if (!lease) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Lease not found</p>
        <Link href="/contacts/tenants">
          <Button variant="link" className="mt-2 gap-2 px-0">
            <ArrowLeft className="h-4 w-4" /> Back to Tenants
          </Button>
        </Link>
      </div>
    );
  }

  const tenantNames = lease.lease_tenants
    ?.map((lt: any) => `${lt.tenants?.first_name ?? ''} ${lt.tenants?.last_name ?? ''}`.trim())
    .filter(Boolean)
    .join(', ') || 'No tenants';

  const propertyName = lease.units?.properties?.name ?? 'Unknown';
  const unitNumber = lease.units?.unit_number ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/contacts/tenants">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {propertyName} {unitNumber && `- ${unitNumber}`}
            </h1>
            <p className="text-sm text-muted-foreground">{tenantNames}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={lease.status === 'active' ? 'default' : 'secondary'}>
            {lease.status}
          </Badge>
          <Button className="gap-2" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit Lease
          </Button>
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Property</p>
                  <p className="font-medium">{propertyName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Unit</p>
                  <p className="font-medium">{unitNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tenants</p>
                  <p className="font-medium">{tenantNames}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lease Type</p>
                  <p className="font-medium">{lease.lease_type === 'month_to_month' ? 'Month-to-Month' : 'Fixed'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Start Date</p>
                  <p className="font-medium">{lease.start_date ? new Date(lease.start_date).toLocaleDateString() : '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">End Date</p>
                  <p className="font-medium">{lease.end_date ? new Date(lease.end_date).toLocaleDateString() : '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Rent</p>
                  <p className="font-medium">${Number(lease.rent_amount).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Security Deposit</p>
                  <p className="font-medium">${Number(lease.deposit_amount ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment Due Day</p>
                  <p className="font-medium">{lease.payment_due_day ? `${lease.payment_due_day}th of month` : '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lease Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <LeaseDocumentUpload leaseId={leaseId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charges" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Additional Charges</CardTitle>
            </CardHeader>
            <CardContent>
              {(!charges || charges.length === 0) ? (
                <p className="text-sm text-muted-foreground">No additional charges</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(charges as any[]).map((charge) => (
                      <TableRow key={charge.id}>
                        <TableCell>{charge.name}</TableCell>
                        <TableCell>${Number(charge.amount).toLocaleString()}</TableCell>
                        <TableCell>{charge.frequency.replace('_', ' ')}</TableCell>
                        <TableCell>
                          <Badge variant={charge.is_active ? 'default' : 'secondary'}>
                            {charge.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LeaseDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        lease={lease}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/contacts/leases/[id]/page.tsx"
git commit -m "feat: add lease detail page with details, documents, and charges tabs"
```

---

## Chunk 6: Navigation Links

### Task 8: Link to Lease Detail from Property Tabs

**Files:**
- Modify: `apps/web/components/properties/property-detail-tabs.tsx`

- [ ] **Step 1: Add clickable lease rows**

Find where leases are rendered in the property detail tabs. Add a `Link` wrapper or `onClick` with `router.push` to navigate to `/contacts/leases/${lease.id}` for each lease row.

Import at top:
```typescript
import Link from 'next/link';
```

Wrap lease names or add a "View" button that links to `/contacts/leases/${lease.id}`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/properties/property-detail-tabs.tsx
git commit -m "feat: link to lease detail page from property tabs"
```

### Task 9: Link to Lease Detail from Tenant Page

**Files:**
- Modify: `apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx`

- [ ] **Step 1: Add clickable lease rows**

Similar to Task 8, add navigation links to lease detail pages from the tenant detail view.

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/contacts/tenants/[id]/page.tsx"
git commit -m "feat: link to lease detail page from tenant detail"
```

---

## Chunk 7: Final Push & Verify

### Task 10: Push and Verify

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Verify on Vercel**

After deployment:
1. Navigate to a lease (via tenant or property)
2. Open the lease detail page
3. Upload a PDF document
4. Upload an image
5. Verify documents appear with download/delete buttons
6. Delete a document
7. Verify the lease dialog also shows the documents section when editing

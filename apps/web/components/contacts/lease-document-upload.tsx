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
    if (inputRef.current) inputRef.current.value = '';
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

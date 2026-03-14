'use client';

import { useRef, useState } from 'react';
import { Button } from '@onereal/ui';
import { Upload } from 'lucide-react';
import { uploadImage } from '@onereal/portfolio/actions/upload-image';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function ImageUpload({ propertyId }: { propertyId: string }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const result = await uploadImage(propertyId, formData);
      if (!result.success) {
        toast.error(`${file.name}: ${result.error}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    setUploading(false);
    toast.success('Images uploaded');
  }

  return (
    <div
      className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:border-primary"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="text-center">
        <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          {uploading ? 'Uploading...' : 'Click or drag images here'}
        </p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · Max 5MB · Max 20 images</p>
      </div>
    </div>
  );
}

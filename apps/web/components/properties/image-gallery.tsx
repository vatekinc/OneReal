'use client';

import Image from 'next/image';
import { Badge, Button } from '@onereal/ui';
import { Star, Trash2 } from 'lucide-react';
import { deleteImage } from '@onereal/portfolio/actions/delete-image';
import { setPrimaryImage } from '@onereal/portfolio/actions/set-primary-image';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PropertyImage } from '@onereal/types';
import { ImageUpload } from './image-upload';

interface ImageGalleryProps {
  images: PropertyImage[];
  propertyId: string;
}

export function ImageGallery({ images, propertyId }: ImageGalleryProps) {
  const queryClient = useQueryClient();

  async function handleDelete(imageId: string) {
    if (!confirm('Delete this image?')) return;
    const result = await deleteImage(imageId);
    if (result.success) {
      toast.success('Image deleted');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleSetPrimary(imageId: string) {
    const result = await setPrimaryImage(imageId, propertyId);
    if (result.success) {
      toast.success('Primary image updated');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <ImageUpload propertyId={propertyId} />
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No images uploaded yet</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <div key={image.id} className="group relative aspect-square overflow-hidden rounded-lg border">
              <Image src={image.url} alt={image.caption || 'Property image'} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover" />
              {image.is_primary && (
                <Badge className="absolute left-2 top-2">Primary</Badge>
              )}
              <div className="absolute inset-0 flex items-end justify-end gap-1 bg-black/0 p-2 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                {!image.is_primary && (
                  <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => handleSetPrimary(image.id)}>
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => handleDelete(image.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

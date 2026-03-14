import { Card, CardContent, Badge } from '@onereal/ui';
import { Building2, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import type { Property, Unit } from '@onereal/types';

type PropertyRow = Property & { units: Pick<Unit, 'id' | 'status' | 'rent_amount'>[] };

export function PropertyCard({ property }: { property: PropertyRow }) {
  const units = property.units ?? [];
  const occupied = units.filter((u) => u.status === 'occupied').length;

  return (
    <Link href={`/properties/${property.id}`}>
      <Card className="hover:border-primary transition-colors">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium truncate">{property.name}</h3>
            <Badge variant={property.status === 'active' ? 'default' : 'secondary'}>
              {property.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {[property.city, property.state].filter(Boolean).join(', ') || 'No address'}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              {property.type.replace(/_/g, ' ')}
            </span>
            <span className="flex items-center gap-1">
              <DoorOpen className="h-3.5 w-3.5" />
              {units.length} units · {occupied} occupied
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

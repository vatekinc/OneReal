'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger, Card, CardContent, Badge, StatCard } from '@onereal/ui';
import { DoorOpen, Percent, DollarSign, MapPin } from 'lucide-react';
import type { Property, Unit, PropertyImage } from '@onereal/types';
import { UnitTable } from './unit-table';
import { ImageGallery } from './image-gallery';

interface PropertyDetailTabsProps {
  property: Property;
  units: Unit[];
  images: PropertyImage[];
}

export function PropertyDetailTabs({ property, units, images }: PropertyDetailTabsProps) {
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const totalRent = units.reduce((sum, u) => sum + (Number(u.rent_amount) || 0), 0);
  const occupancyRate = units.length > 0 ? Math.round((occupied / units.length) * 100) : 0;

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="units">Units ({units.length})</TabsTrigger>
        <TabsTrigger value="images">Images ({images.length})</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Units" value={units.length} icon={DoorOpen} description={`${occupied} occupied`} />
          <StatCard title="Occupancy" value={`${occupancyRate}%`} icon={Percent} />
          <StatCard title="Rent Potential" value={`$${totalRent.toLocaleString()}`} icon={DollarSign} description="Monthly" />
        </div>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                {property.address_line1 && <p>{property.address_line1}</p>}
                {property.address_line2 && <p>{property.address_line2}</p>}
                <p>{[property.city, property.state, property.zip].filter(Boolean).join(', ')}</p>
              </div>
            </div>
            {property.notes && <p className="text-sm text-muted-foreground">{property.notes}</p>}
            <div className="flex gap-2 flex-wrap text-sm">
              <Badge variant="outline">{property.type.replace(/_/g, ' ')}</Badge>
              {property.year_built && <Badge variant="outline">Built {property.year_built}</Badge>}
              {property.purchase_price && <Badge variant="outline">Purchased ${Number(property.purchase_price).toLocaleString()}</Badge>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="units">
        <UnitTable units={units} propertyId={property.id} />
      </TabsContent>

      <TabsContent value="images">
        <ImageGallery images={images} propertyId={property.id} />
      </TabsContent>

      <TabsContent value="activity">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Lease and transaction history will appear here in a future update.
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

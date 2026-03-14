'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, Badge, Button } from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Unit } from '@onereal/types';
import { deleteUnit } from '@onereal/portfolio/actions/delete-unit';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';
import { UnitDialog } from './unit-dialog';

interface UnitTableProps {
  units: Unit[];
  propertyId: string;
}

export function UnitTable({ units, propertyId }: UnitTableProps) {
  const [editUnit, setEditUnit] = useState<Unit | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const queryClient = useQueryClient();

  async function handleDelete(unitId: string) {
    if (!confirm('Delete this unit?')) return;
    const result = await deleteUnit(unitId, propertyId);
    if (result.success) {
      toast.success('Unit deleted');
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
    } else {
      toast.error(result.error);
    }
  }

  const columns: ColumnDef<Unit>[] = [
    { accessorKey: 'unit_number', header: 'Unit #' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => row.original.type?.replace(/_/g, ' ') || '—' },
    { accessorKey: 'bedrooms', header: 'Beds', cell: ({ row }) => row.original.bedrooms ?? '—' },
    { accessorKey: 'bathrooms', header: 'Baths', cell: ({ row }) => row.original.bathrooms ?? '—' },
    { accessorKey: 'square_feet', header: 'Sqft', cell: ({ row }) => row.original.square_feet?.toLocaleString() ?? '—' },
    {
      accessorKey: 'rent_amount',
      header: 'Rent',
      cell: ({ row }) => row.original.rent_amount ? `$${Number(row.original.rent_amount).toLocaleString()}` : '—',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'occupied' ? 'default' : 'secondary'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditUnit(row.original); setShowDialog(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(row.original.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setEditUnit(null); setShowDialog(true); }}>
          <Plus className="h-4 w-4" /> Add Unit
        </Button>
      </div>
      <DataTable columns={columns} data={units} />
      <UnitDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        propertyId={propertyId}
        unit={editUnit}
      />
    </div>
  );
}

'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, Badge, Button } from '@onereal/ui';
import { MoreHorizontal, Eye, Pencil } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@onereal/ui';
import Link from 'next/link';
import type { Property, Unit } from '@onereal/types';

type PropertyRow = Property & { units: Pick<Unit, 'id' | 'status' | 'rent_amount'>[] };

const columns: ColumnDef<PropertyRow>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link href={`/properties/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: 'type', header: 'Type', cell: ({ row }) => row.original.type.replace(/_/g, ' ') },
  {
    id: 'address',
    header: 'Address',
    cell: ({ row }) => {
      const p = row.original;
      return [p.city, p.state].filter(Boolean).join(', ') || '—';
    },
  },
  {
    id: 'units',
    header: 'Units',
    cell: ({ row }) => row.original.units?.length ?? 0,
  },
  {
    id: 'occupancy',
    header: 'Occupancy',
    cell: ({ row }) => {
      const units = row.original.units ?? [];
      const occupied = units.filter((u) => u.status === 'occupied').length;
      const total = units.length;
      if (total === 0) return '—';
      return `${Math.round((occupied / total) * 100)}%`;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/properties/${row.original.id}`} className="gap-2">
              <Eye className="h-4 w-4" /> View
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/properties/${row.original.id}/edit`} className="gap-2">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

interface PropertyListProps {
  data: PropertyRow[];
}

export function PropertyList({ data }: PropertyListProps) {
  return <DataTable columns={columns} data={data} />;
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { listOrganizations } from '@onereal/admin/actions/list-organizations';
import {
  Input, Badge, Button,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import type { OrganizationListItem } from '@onereal/types';

export default function AdminOrganizationsPage() {
  const [items, setItems] = useState<OrganizationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await listOrganizations({ search: search || undefined, page, pageSize });
    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Organizations</h1>

      <Input
        placeholder="Search organizations..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No organizations found</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Properties</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{org.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{org.plan_name}</Badge>
                    </TableCell>
                    <TableCell>{org.member_count}</TableCell>
                    <TableCell>{org.property_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/organizations/${org.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

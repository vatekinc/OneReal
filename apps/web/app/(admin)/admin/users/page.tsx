'use client';

import { useEffect, useState, useCallback } from 'react';
import { listUsers } from '@onereal/admin/actions/list-users';
import { toggleUserStatus } from '@onereal/admin/actions/toggle-user-status';
import { deleteUser } from '@onereal/admin/actions/delete-user';
import {
  Input, Badge, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { UserListItem } from '@onereal/types';

export default function AdminUsersPage() {
  const [items, setItems] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  // Dialog state
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserListItem | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await listUsers({ search: search || undefined, page, pageSize });
    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  async function handleToggleConfirm() {
    if (!toggleTarget) return;
    setToggling(true);
    // Toggle: if currently banned, unban; if not banned, ban
    const shouldBan = !toggleTarget.banned;
    const result = await toggleUserStatus(toggleTarget.id, shouldBan);
    if (result.success) {
      toast.success(shouldBan ? 'User disabled' : 'User enabled');
      setToggleTarget(null);
      fetchData();
    } else {
      toast.error(result.error);
    }
    setToggling(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteUser(deleteTarget.id);
    if (result.success) {
      toast.success('User deleted');
      setDeleteTarget(null);
      fetchData();
    } else {
      toast.error(result.error);
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>

      <Input
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No users found</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Orgs</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.first_name} {user.last_name}
                      {user.is_platform_admin && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Admin</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {user.primary_role ? (
                        <Badge variant="outline">{user.primary_role}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{'\u2014'}</span>
                      )}
                    </TableCell>
                    <TableCell>{user.org_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.banned ? 'destructive' : 'default'}>
                        {user.banned ? 'Disabled' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setToggleTarget(user)}
                        >
                          {user.banned ? 'Enable' : 'Disable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(user)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

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

      {/* Toggle status dialog */}
      {toggleTarget && (
        <Dialog open={!!toggleTarget} onOpenChange={(open) => { if (!open) setToggleTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {toggleTarget.banned ? 'Enable' : 'Disable'} User Account
              </DialogTitle>
              <DialogDescription>
                {toggleTarget.banned
                  ? `This will re-enable the account for "${toggleTarget.first_name} ${toggleTarget.last_name}" (${toggleTarget.email}). They will be able to log in again.`
                  : `This will disable the account for "${toggleTarget.first_name} ${toggleTarget.last_name}" (${toggleTarget.email}). They will not be able to log in.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setToggleTarget(null)} disabled={toggling}>
                Cancel
              </Button>
              <Button
                variant={toggleTarget.banned ? 'default' : 'destructive'}
                onClick={handleToggleConfirm}
                disabled={toggling}
              >
                {toggling ? 'Processing...' : toggleTarget.banned ? 'Enable Account' : 'Disable Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete user dialog */}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete User"
          description={`This will permanently delete the user "${deleteTarget.first_name} ${deleteTarget.last_name}" (${deleteTarget.email}), remove them from all organizations, and delete their personal org if they're the sole member.`}
          confirmText={deleteTarget.email ?? 'delete'}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

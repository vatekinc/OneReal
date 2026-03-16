'use client';

import { useEffect, useState, useCallback } from 'react';
import { listPlans } from '@onereal/admin/actions/list-plans';
import { createPlan } from '@onereal/admin/actions/create-plan';
import { updatePlan } from '@onereal/admin/actions/update-plan';
import { deletePlan } from '@onereal/admin/actions/delete-plan';
import {
  Button, Badge, Input, Label,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { PlanListItem, PlanFeatures } from '@onereal/types';

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formMaxProps, setFormMaxProps] = useState(10);
  const [formOnlinePayments, setFormOnlinePayments] = useState(false);
  const [formMessaging, setFormMessaging] = useState(false);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PlanListItem | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const result = await listPlans();
    if (result.success) setPlans(result.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  function openCreate() {
    setEditingId(null);
    setFormName('');
    setFormSlug('');
    setFormMaxProps(10);
    setFormOnlinePayments(false);
    setFormMessaging(false);
    setFormIsDefault(false);
    setFormOpen(true);
  }

  function openEdit(plan: PlanListItem) {
    setEditingId(plan.id);
    setFormName(plan.name);
    setFormSlug(plan.slug);
    setFormMaxProps(plan.max_properties);
    setFormOnlinePayments(plan.features.online_payments);
    setFormMessaging(plan.features.messaging);
    setFormIsDefault(plan.is_default);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formSlug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    setSaving(true);

    const features: PlanFeatures = {
      online_payments: formOnlinePayments,
      messaging: formMessaging,
    };

    if (editingId) {
      const result = await updatePlan(editingId, {
        name: formName,
        slug: formSlug,
        max_properties: formMaxProps,
        features,
        is_default: formIsDefault,
      });
      if (result.success) {
        toast.success('Plan updated');
        setFormOpen(false);
        fetchPlans();
      } else {
        toast.error(result.error);
      }
    } else {
      const result = await createPlan({
        name: formName,
        slug: formSlug,
        max_properties: formMaxProps,
        features,
        is_default: formIsDefault,
      });
      if (result.success) {
        toast.success('Plan created');
        setFormOpen(false);
        fetchPlans();
      } else {
        toast.error(result.error);
      }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deletePlan(deleteTarget.id);
    if (result.success) {
      toast.success('Plan deleted');
      setDeleteTarget(null);
      fetchPlans();
    } else {
      toast.error(result.error);
    }
  }

  function handleNameChange(value: string) {
    setFormName(value);
    if (!editingId) {
      setFormSlug(
        value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plans</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Create Plan
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : plans.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No plans found</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Property Limit</TableHead>
                <TableHead>Features</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">
                    {plan.name}
                    {plan.is_default && (
                      <Badge variant="secondary" className="ml-2">Default</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plan.slug}</TableCell>
                  <TableCell>
                    {plan.max_properties === 0 ? 'Unlimited' : plan.max_properties}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {plan.features.online_payments && (
                        <Badge variant="outline">Online Payments</Badge>
                      )}
                      {plan.features.messaging && (
                        <Badge variant="outline">Messaging</Badge>
                      )}
                      {!plan.features.online_payments && !plan.features.messaging && (
                        <span className="text-muted-foreground text-sm">None</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{plan.org_count}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(plan)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(plan)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={formName} onChange={(e) => handleNameChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input value={formSlug} onChange={(e) => setFormSlug(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Max Properties (0 = unlimited)</Label>
              <Input
                type="number"
                min={0}
                value={formMaxProps}
                onChange={(e) => setFormMaxProps(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>Features</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formOnlinePayments}
                    onChange={(e) => setFormOnlinePayments(e.target.checked)}
                    className="rounded"
                  />
                  Online Payments
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formMessaging}
                    onChange={(e) => setFormMessaging(e.target.checked)}
                    className="rounded"
                  />
                  Messaging
                </label>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
                className="rounded"
              />
              Default plan (assigned to new organizations)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Delete Plan"
          description={`This will permanently delete the "${deleteTarget.name}" plan. This cannot be undone.`}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMaintenanceActivity, type MaintenanceActivity } from '@onereal/maintenance';
import { addMaintenanceNote } from '@onereal/maintenance/actions/add-maintenance-note';
import { deleteMaintenanceNote } from '@onereal/maintenance/actions/delete-maintenance-note';
import { useUser } from '@onereal/auth';
import { Button, Textarea } from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const fieldLabels: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assigned_to: 'Assignee',
  estimated_cost: 'Estimated cost',
  actual_cost: 'Actual cost',
  scheduled_date: 'Scheduled date',
  completed_date: 'Completed date',
};

const valueLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_parts: 'Waiting on Parts',
  completed: 'Completed',
  closed: 'Closed',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  emergency: 'Emergency',
};

function formatValue(field: string | null, value: string | null): string {
  if (value === null || value === '') return 'none';
  if (field === 'estimated_cost' || field === 'actual_cost') {
    return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (field === 'scheduled_date' || field === 'completed_date') {
    const [y, m, d] = value.split('-');
    return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : value;
  }
  return valueLabels[value] ?? value;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function MaintenanceActivityPanel({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const { profile } = useUser();
  const { data: activity, isLoading } = useMaintenanceActivity(requestId);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!note.trim()) return;
    setSaving(true);
    const result = await addMaintenanceNote(requestId, note);
    setSaving(false);
    if (result.success) {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['maintenance-activity', requestId] });
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteMaintenanceNote(id);
    if (result.success) {
      queryClient.invalidateQueries({ queryKey: ['maintenance-activity', requestId] });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Activity</h3>

      <div className="space-y-2">
        <Textarea
          placeholder="Add a progress note, e.g. Plumber visited, part ordered, ETA Friday..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving || !note.trim()}>
            {saving ? 'Adding...' : 'Add Note'}
          </Button>
        </div>
      </div>

      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading activity...</p>
        ) : !activity || activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          activity.map((a: MaintenanceActivity) => (
            <div key={a.id} className="flex gap-3 text-sm">
              <div className="mt-0.5 shrink-0 text-muted-foreground">
                {a.kind === 'note' ? <MessageSquare className="h-4 w-4" /> : <History className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{a.author_name ?? 'Unknown'}</span>
                    {' · '}
                    {formatWhen(a.created_at)}
                  </p>
                  {a.kind === 'note' && a.author_id === profile?.id && (
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {a.kind === 'note' ? (
                  <p className="whitespace-pre-wrap break-words">{a.body}</p>
                ) : (
                  <p className="text-muted-foreground">
                    {fieldLabels[a.field ?? ''] ?? a.field} changed from{' '}
                    <span className="text-foreground">{formatValue(a.field, a.old_value)}</span> to{' '}
                    <span className="text-foreground">{formatValue(a.field, a.new_value)}</span>
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMaintenanceRequests } from '@onereal/maintenance';
import { useProperties } from '@onereal/portfolio';
import { MaintenanceDialog } from '@/components/maintenance/maintenance-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil } from 'lucide-react';

type TabValue = 'all' | 'open' | 'in_progress' | 'completed';

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-800',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  emergency: 'bg-red-100 text-red-800',
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  waiting_parts: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

const categoryLabels: Record<string, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  appliance: 'Appliance',
  structural: 'Structural',
  pest: 'Pest',
  other: 'Other',
};

interface MaintenanceClientProps {
  orgId: string;
  initialRequests: any[];
  initialProperties: any[];
}

export function MaintenanceClient({ orgId, initialRequests, initialProperties }: MaintenanceClientProps) {
  const [tab, setTab] = useState<TabValue>('all');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

  const { data: propertiesData } = useProperties({ orgId });
  const properties = (propertiesData?.data ?? initialProperties) as any[];

  const hasActiveFilters = !!(search || priorityFilter || tab !== 'all');
  const statusFilter = tab === 'all' ? undefined : tab;
  const { data: requests, isLoading } = useMaintenanceRequests({
    orgId,
    status: statusFilter,
    priority: priorityFilter || undefined,
    search: search || undefined,
  });

  // Server data shows instantly; hook data takes over once fetched
  const displayRequests = requests ?? (hasActiveFilters ? [] : initialRequests);

  function handleNew() {
    setSelectedRequest(null);
    setDialogOpen(true);
  }

  function handleEdit(request: any) {
    setSelectedRequest(request);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Maintenance</h1>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" /> New Request
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search requests..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Priorities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="emergency">Emergency</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && hasActiveFilters ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !displayRequests || displayRequests.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No maintenance requests yet</p>
          <Button onClick={handleNew}>Create your first request</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Property / Unit</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRequests.map((req: any) => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">{req.title}</TableCell>
                  <TableCell>
                    {req.units?.properties?.name ?? '\u2014'}
                    {req.units?.unit_number ? ` / ${req.units.unit_number}` : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{categoryLabels[req.category] ?? req.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={priorityColors[req.priority] ?? ''}>
                      {req.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[req.status] ?? ''}>
                      {req.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(req.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(req)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MaintenanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        request={selectedRequest}
        properties={properties}
      />
    </div>
  );
}

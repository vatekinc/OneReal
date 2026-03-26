'use client';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@onereal/ui';
import { MoreHorizontal } from 'lucide-react';
import type { Credit } from '@onereal/types';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance Payment',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  fully_applied: 'bg-blue-100 text-blue-800',
  void: 'bg-gray-100 text-gray-800',
};

interface CreditTableProps {
  credits: any[];
  onVoid: (credit: any) => void;
  onApply: (credit: any) => void;
}

export function CreditTable({ credits, onVoid, onApply }: CreditTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Used</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credits.map((credit: any) => {
            const remaining = Number(credit.amount) - Number(credit.amount_used);
            return (
              <TableRow key={credit.id}>
                <TableCell>{new Date(credit.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {credit.tenants ? `${credit.tenants.first_name} ${credit.tenants.last_name}` : '\u2014'}
                </TableCell>
                <TableCell>{credit.properties?.name ?? '\u2014'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{sourceLabels[credit.source] ?? credit.source}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">${Number(credit.amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">${Number(credit.amount_used).toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">${remaining.toFixed(2)}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusColors[credit.status] ?? ''}`}>
                    {credit.status.replace('_', ' ')}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {credit.status === 'active' && remaining > 0 && (
                        <DropdownMenuItem onClick={() => onApply(credit)}>
                          Apply to Invoice
                        </DropdownMenuItem>
                      )}
                      {credit.status === 'active' && (
                        <DropdownMenuItem className="text-destructive" onClick={() => onVoid(credit)}>
                          Void Credit
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Input,
} from '@onereal/ui';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'destructive' | 'default';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  onConfirm,
  variant = 'destructive',
}: ConfirmDialogProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const isMatch = input.trim().toLowerCase() === confirmText.trim().toLowerCase();

  async function handleConfirm() {
    if (!isMatch) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      setInput('');
      onOpenChange(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) setInput('');
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm:
          </p>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={confirmText}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={!isMatch || loading}
          >
            {loading ? 'Deleting...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

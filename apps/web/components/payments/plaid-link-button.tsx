'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@onereal/ui';
import { createPlaidLinkToken } from '@onereal/payments/actions/create-plaid-link-token';
import { exchangePlaidToken } from '@onereal/payments/actions/exchange-plaid-token';
import { toast } from 'sonner';

interface PlaidLinkButtonProps {
  role: 'landlord' | 'tenant';
  orgId: string;
  onSuccess: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
  disabled?: boolean;
}

export function PlaidLinkButton({
  role,
  orgId,
  onSuccess,
  children,
  variant = 'default',
  size = 'default',
  disabled = false,
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    const result = await createPlaidLinkToken(role, orgId);
    if (result.success) {
      setLinkToken(result.data.linkToken);
    } else {
      toast.error(result.error);
      setLoading(false);
    }
  };

  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      const account = metadata.accounts?.[0];
      if (!account) {
        toast.error('No account selected');
        setLoading(false);
        return;
      }

      const result = await exchangePlaidToken(role, orgId, {
        publicToken,
        accountId: account.id,
        institutionName: metadata.institution?.name || 'Bank',
        accountMask: account.mask || '****',
        accountName: `${account.subtype || 'Account'} ****${account.mask || ''}`,
      });

      if (result.success) {
        toast.success('Bank account linked successfully');
        onSuccess();
      } else {
        toast.error(result.error);
      }
      setLinkToken(null);
      setLoading(false);
    },
    [role, orgId, onSuccess]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => {
      setLinkToken(null);
      setLoading(false);
    },
  });

  // Auto-open when link token is ready
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled || loading}
    >
      {loading ? 'Connecting...' : children}
    </Button>
  );
}

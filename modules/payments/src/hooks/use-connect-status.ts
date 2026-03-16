'use client';

import { useState, useEffect, useCallback } from 'react';
import { getConnectStatus } from '../actions/get-connect-status';

export function useConnectStatus(orgId: string | null, pollOnMount = false) {
  const [status, setStatus] = useState<'not_connected' | 'onboarding' | 'active' | 'restricted'>('not_connected');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const result = await getConnectStatus(orgId);
    if (result.success) {
      setStatus(result.data.stripe_account_status);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();

    if (pollOnMount) {
      const interval = setInterval(refresh, 2000);
      const timeout = setTimeout(() => clearInterval(interval), 10000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [refresh, pollOnMount]);

  return { status, loading, refresh };
}

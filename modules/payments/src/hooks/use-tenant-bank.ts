'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTenantBankAccount } from '../actions/get-tenant-bank-account';

interface TenantBankInfo {
  id: string;
  institution_name: string;
  account_mask: string;
  account_name: string;
  auto_pay_enabled: boolean;
}

export function useTenantBank(orgId: string | null) {
  const [bank, setBank] = useState<TenantBankInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const result = await getTenantBankAccount(orgId);
    if (result.success) {
      setBank(result.data);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bank, loading, refresh };
}

'use client';

import { useRole } from '../hooks/use-role';
import type { ReactNode } from 'react';

interface RoleGateProps {
  role: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ role, children, fallback = null }: RoleGateProps) {
  const currentRole = useRole();

  if (!currentRole) return fallback;

  const allowedRoles = Array.isArray(role) ? role : [role];
  if (!allowedRoles.includes(currentRole)) return fallback;

  return <>{children}</>;
}

export interface DateRange {
  from: string;
  to: string;
}

export function resolveDateRange(
  range?: string | null,
  from?: string | null,
  to?: string | null,
): DateRange | undefined {
  if (from && to) return { from, to };

  const now = new Date();
  const toDate = now.toISOString().split('T')[0];

  switch (range ?? 'current_year') {
    case 'current_month': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString().split('T')[0], to: toDate };
    }
    case 'current_year': {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      return { from: firstOfYear.toISOString().split('T')[0], to: toDate };
    }
    case '3yr': {
      const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      return { from: threeYearsAgo.toISOString().split('T')[0], to: toDate };
    }
    case '5yr': {
      const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      return { from: fiveYearsAgo.toISOString().split('T')[0], to: toDate };
    }
    case 'all':
      return undefined;
    default:
      return undefined;
  }
}

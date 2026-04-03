import { Badge } from '@onereal/ui';
import type { RecentTransaction } from '@onereal/types';
import Link from 'next/link';
import { formatDate } from '@/lib/format-date';

interface RecentTransactionsProps {
  transactions: RecentTransaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions recorded yet.{' '}
        <Link href="/accounting/income" className="text-primary hover:underline">
          Add your first income entry
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {transactions.map((t) => (
        <div key={`${t.type}-${t.id}`} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{t.description}</span>
              <span className="text-xs text-muted-foreground">
                {t.property_name} &middot; {formatDate(t.transaction_date)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {t.category.replace(/_/g, ' ')}
            </Badge>
            <span
              className={`text-sm font-medium ${
                t.type === 'income' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {t.type === 'income' ? '+' : '-'}${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

import { ComingSoon } from '@/components/dashboard/coming-soon';
import { CreditCard } from 'lucide-react';

export default function TransactionsPage() {
  return (
    <ComingSoon
      icon={CreditCard}
      title="Transactions"
      description="Track income, expenses, and payments across all properties."
      features={[
        'Record rent payments and expenses',
        'Generate financial reports',
        'Categorize transactions',
        'Export to CSV/PDF',
      ]}
    />
  );
}

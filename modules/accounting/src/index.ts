// Schemas (pure types + zod — safe for both client and server)
export { incomeSchema, type IncomeFormValues } from './schemas/income-schema';
export { expenseSchema, type ExpenseFormValues } from './schemas/expense-schema';

// Hooks (client-only)
export { useIncome } from './hooks/use-income';
export { useExpenses } from './hooks/use-expenses';
export { useFinancialStats } from './hooks/use-financial-stats';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createIncome } from '@onereal/accounting/actions/create-income';

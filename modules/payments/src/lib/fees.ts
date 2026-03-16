export type PaymentMethod = 'card' | 'us_bank_account';

/**
 * Calculate processing fee based on payment method.
 * - Card / Link: 2.9% + $0.30
 * - ACH bank transfer: 0.8% (capped at $5.00)
 */
export function calculateConvenienceFee(
  amount: number,
  method: PaymentMethod = 'card',
): number {
  if (method === 'us_bank_account') {
    const fee = amount * 0.008;
    return Math.round(Math.min(fee, 5) * 100) / 100;
  }
  const fee = amount * 0.029 + 0.3;
  return Math.round(fee * 100) / 100;
}

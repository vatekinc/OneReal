/**
 * Calculate convenience fee using card rate (2.9% + $0.30).
 * Applied universally regardless of payment method chosen at checkout.
 */
export function calculateConvenienceFee(amount: number): number {
  const fee = amount * 0.029 + 0.3;
  return Math.round(fee * 100) / 100;
}

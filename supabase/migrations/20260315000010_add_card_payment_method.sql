-- ============================================================
-- Migration 010: Add 'card' payment method
-- ============================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash', 'check', 'card', 'bank_transfer', 'online', 'other'));

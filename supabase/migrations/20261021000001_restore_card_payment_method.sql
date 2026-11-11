-- ============================================================
-- Migration: Restore 'card' payment method
--   20260315000010 added 'card', but 20260514000001 recreated
--   payments_payment_method_check to add 'deposit' and dropped
--   'card' in the process, so recording a Card payment fails.
--   Also allows 'plaid', which the Plaid webhook inserts.
-- ============================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash','check','card','bank_transfer','online','other','deposit','plaid'));

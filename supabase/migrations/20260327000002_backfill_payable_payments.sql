-- ==========================================================
-- Backfill: Create missing payment records for paid payable invoices
-- ==========================================================
-- These 6 payable invoices were marked "paid" with standalone expense records
-- but no payment records linking them. This causes double-counting in the
-- property statement (expense_bill + standalone expense for the same amount).
--
-- The fix: create payment records with expense_id set, so the NOT EXISTS
-- guard in get_property_statement correctly filters out these expenses.
-- ==========================================================

-- 182-Magellan (org: b89ce101, property: 4a010748) — 3 mortgage payments
INSERT INTO public.payments (org_id, invoice_id, amount, payment_method, payment_date, reference_number, notes, expense_id)
VALUES
  ('b89ce101-e6b5-4e5c-86d8-df4a8fbd62aa', 'ffab2e6f-c640-4063-be09-8f2e76613183', 2396.80, 'bank_transfer', '2026-01-10', NULL, 'Backfilled: mortgage payment', 'd6bc1275-045a-4b04-a2b3-159c8b3a5464'),
  ('b89ce101-e6b5-4e5c-86d8-df4a8fbd62aa', '0f1cc868-c677-421c-bfb5-ba1958556853', 2396.80, 'bank_transfer', '2026-02-10', NULL, 'Backfilled: mortgage payment', '25f00bad-4e0e-44e7-b55a-9de03fa85911'),
  ('b89ce101-e6b5-4e5c-86d8-df4a8fbd62aa', '3dffdf9c-182a-456d-a02b-7a5357ba10e7', 2396.80, 'bank_transfer', '2026-03-10', NULL, 'Backfilled: mortgage payment', '385df5cb-0503-45d9-aea7-ae108e757cd2')
ON CONFLICT DO NOTHING;

-- Other property (org: bddd1a15, property: e4d7f4f5) — 3 maintenance payments
INSERT INTO public.payments (org_id, invoice_id, amount, payment_method, payment_date, reference_number, notes, expense_id)
VALUES
  ('bddd1a15-6d74-43fa-8ace-431a9c483394', 'ec72ad61-4239-4f39-ab50-9d038ed89e5b', 2400.00, 'bank_transfer', '2026-01-15', NULL, 'Backfilled: maintenance payment', 'da50c8be-5ede-42e9-b955-320ffa2cffbb'),
  ('bddd1a15-6d74-43fa-8ace-431a9c483394', '8a9334f5-6042-4231-bba4-54c5fafccc8f', 2400.00, 'bank_transfer', '2026-02-15', NULL, 'Backfilled: maintenance payment', 'e70babf5-c686-48fe-95d1-a1fe540cfae8'),
  ('bddd1a15-6d74-43fa-8ace-431a9c483394', 'cb2d96e5-2c65-44b4-8300-3d1bf43b7b85', 2400.00, 'bank_transfer', '2026-03-15', NULL, 'Backfilled: maintenance payment', 'ec5d833c-a923-4935-8769-31674f94913c')
ON CONFLICT DO NOTHING;

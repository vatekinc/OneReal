-- ============================================================
-- Migration: enable RLS on payment_events
--   Security Advisor error "RLS Disabled in Public": the table
--   was created without RLS (20260316000001), so the public anon
--   key could read and write Stripe/Plaid webhook payloads via
--   PostgREST.
--   Only the Stripe and Plaid webhook routes use it, both through
--   the service-role client, which bypasses RLS. So enabling RLS
--   with NO policies locks out anon/authenticated and leaves the
--   webhooks unaffected.
-- ============================================================

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_events FROM anon, authenticated;

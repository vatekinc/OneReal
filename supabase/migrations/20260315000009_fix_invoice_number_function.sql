-- ============================================================
-- Migration 009: Fix next_invoice_number function
-- FOR UPDATE cannot be used with aggregate functions (MAX)
-- Use advisory lock instead for concurrency safety
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  max_seq INTEGER;
  next_seq INTEGER;
BEGIN
  -- Advisory lock per org to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::TEXT || '_invoice'));

  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(invoice_number FROM 'INV-' || current_year || '-(\d+)$')
        AS INTEGER
      )
    ),
    0
  )
  INTO max_seq
  FROM public.invoices
  WHERE org_id = p_org_id
    AND invoice_number LIKE 'INV-' || current_year || '-%';

  next_seq := max_seq + 1;
  RETURN 'INV-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

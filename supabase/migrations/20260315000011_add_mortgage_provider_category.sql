-- ============================================================
-- Migration 011: Add 'mortgage_provider' to service_providers category
-- ============================================================

ALTER TABLE public.service_providers DROP CONSTRAINT IF EXISTS service_providers_category_check;
ALTER TABLE public.service_providers ADD CONSTRAINT service_providers_category_check
  CHECK (category IN (
    'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner',
    'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith',
    'appliance_repair', 'mortgage_provider', 'other'
  ));

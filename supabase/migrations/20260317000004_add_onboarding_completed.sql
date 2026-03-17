-- Add onboarding_completed flag to profiles
-- This is checked by middleware to redirect users to onboarding until they finish all steps
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

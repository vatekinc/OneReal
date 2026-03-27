-- Performance indexes for frequently filtered columns

CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_direction ON public.invoices(direction);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON public.invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_status ON public.leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_org_status ON public.leases(org_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_provider ON public.expenses(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_providers_category ON public.service_providers(category);
CREATE INDEX IF NOT EXISTS idx_payable_invoices_status ON public.payable_invoices(status);
CREATE INDEX IF NOT EXISTS idx_payable_invoices_org_status ON public.payable_invoices(org_id, status);

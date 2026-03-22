import { Building2, DollarSign, BarChart3 } from 'lucide-react';

const FEATURES = [
  {
    icon: Building2,
    title: 'Portfolio Overview',
    description: 'Track all your properties, tenants, and financials in one place.',
  },
  {
    icon: DollarSign,
    title: 'Automated Invoicing',
    description: 'Generate, send, and track rent invoices automatically.',
  },
  {
    icon: BarChart3,
    title: 'Financial Insights',
    description: 'Real-time cash flow, expense breakdowns, and ROI analysis.',
  },
];

export function AuthBrandPanel() {
  return (
    <div className="relative hidden flex-col items-start justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-12 md:flex">
      {/* Decorative radial glows */}
      <div className="pointer-events-none absolute -right-[30%] -top-[50%] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.15)_0%,transparent_70%)]" />
      <div className="pointer-events-none absolute -bottom-[30%] -left-[20%] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.1)_0%,transparent_70%)]" />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="OneReal" className="h-16 w-16" />
        <div>
          <span className="text-2xl font-bold tracking-tight text-white">OneReal</span>
          <p className="mt-0.5 text-sm text-slate-400">Real Estate &amp; Property Management</p>
        </div>
      </div>

      {/* Feature highlights */}
      <div className="relative z-10 mt-10 flex flex-col gap-5">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.08]">
              <f.icon className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">{f.title}</h4>
              <p className="text-xs leading-relaxed text-slate-500">{f.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Social proof */}
      <div className="relative z-10 mt-8 flex items-center gap-2.5 border-t border-white/[0.06] pt-8">
        <div className="flex">
          <div className="h-7 w-7 rounded-full bg-blue-500" />
          <div className="-ml-2 h-7 w-7 rounded-full border-2 border-slate-900 bg-indigo-500" />
          <div className="-ml-2 h-7 w-7 rounded-full border-2 border-slate-900 bg-slate-600" />
        </div>
        <span className="text-xs text-slate-500">Trusted by property managers everywhere</span>
      </div>
    </div>
  );
}

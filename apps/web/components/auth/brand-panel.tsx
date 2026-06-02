import Image from 'next/image';
import { Building2, Users, FileText, Wallet, BookOpen } from 'lucide-react';

const STEPS = [
  {
    icon: Building2,
    title: 'Add your properties',
    description: 'Set up the buildings and units you manage.',
  },
  {
    icon: Users,
    title: 'Add tenants & service providers',
    description: 'Keep your renters and your vendors in one place.',
  },
  {
    icon: FileText,
    title: 'Create a lease',
    description: 'Link a tenant to a unit and set the rent, deposit, and due date.',
  },
  {
    icon: Wallet,
    title: 'Track rent, expenses & maintenance',
    description: 'Invoice automatically and watch your cash flow in real time.',
  },
];

export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 md:flex md:flex-col">
      {/* Decorative radial glows */}
      <div className="pointer-events-none absolute -right-[30%] -top-[50%] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.15)_0%,transparent_70%)]" />
      <div className="pointer-events-none absolute -bottom-[30%] -left-[20%] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.1)_0%,transparent_70%)]" />

      {/* Content (centers when it fits, scrolls on short screens) */}
      <div className="relative z-10 flex flex-1 flex-col justify-center gap-8 overflow-y-auto p-10 lg:p-12">
        {/* Logo */}
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="OneReal" width={56} height={56} />
          <div>
            <span className="text-2xl font-bold tracking-tight text-white lg:text-3xl">OneReal</span>
            <p className="mt-0.5 text-sm text-slate-400">Real Estate &amp; Property Management</p>
          </div>
        </div>

        {/* Hero */}
        <div>
          <h2 className="text-xl font-bold leading-tight tracking-tight text-white lg:text-2xl">
            Manage smarter.<br />Grow faster.
          </h2>
          <p className="mt-3 max-w-[360px] text-sm leading-relaxed text-slate-400">
            OneReal brings your properties, tenants, leases, finances, and maintenance
            together in a single portal.
          </p>
        </div>

        {/* How it works */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            How it works
          </h3>
          <ol className="mt-4 flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3.5">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.08]">
                  <step.icon className="h-4 w-4 text-blue-400" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">{step.title}</h4>
                  <p className="text-xs leading-relaxed text-slate-500">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Guide callout */}
        <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <p className="text-xs leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-200">New here?</span> Once you sign in, open{' '}
            <span className="font-semibold text-slate-200">Guide</span> in the sidebar to learn how to
            navigate every part of the portal — anytime.
          </p>
        </div>
      </div>
    </div>
  );
}

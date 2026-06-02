import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@onereal/ui';
import {
  Building2, Users, FileText, Wallet, BookOpen, ArrowRight,
  LayoutDashboard, Calculator, Wrench, BarChart3, MessageSquare,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'How OneReal works',
  description: 'See how OneReal helps you manage properties, tenants, leases, finances, and maintenance — all in one portal.',
};

const STEPS = [
  {
    icon: Building2,
    title: 'Add your properties',
    description: 'Set up the buildings and units you manage, with photos and details.',
  },
  {
    icon: Users,
    title: 'Add tenants & service providers',
    description: 'Keep your renters and your vendors (plumbers, electricians, and more) in one place.',
  },
  {
    icon: FileText,
    title: 'Create a lease',
    description: 'Link a tenant to a unit and set the rent, deposit, due date, and any extra charges.',
  },
  {
    icon: Wallet,
    title: 'Track everything',
    description: 'Send invoices, record payments, log expenses, and manage maintenance as you go.',
  },
];

const SECTIONS = [
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    description: 'A live snapshot of your whole portfolio — occupancy, rent potential, income, and recent activity.',
  },
  {
    icon: Building2,
    title: 'Properties',
    description: 'Every building and unit you own, with photos, leases, and recurring costs.',
  },
  {
    icon: Users,
    title: 'Contacts',
    description: 'Your tenants and your service providers, each with their own profile and history.',
  },
  {
    icon: FileText,
    title: 'Leases',
    description: 'Connect a tenant to a unit and set rent, deposit, due day, charges, and late fees.',
  },
  {
    icon: Calculator,
    title: 'Accounting',
    description: 'Invoices, payments, expenses, and credits — with cash-flow and collection insights.',
  },
  {
    icon: Wrench,
    title: 'Maintenance',
    description: 'Track repair requests from open to completed, and assign them to your vendors.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    description: 'P&L, cash flow, invoice aging, rent collection, and statements — exportable to CSV.',
  },
  {
    icon: MessageSquare,
    title: 'Messages',
    description: 'Message your tenants (and OneReal support) right inside the portal.',
  },
];

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90';
const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10';

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="OneReal" width={32} height={32} />
            <span className="text-lg font-bold tracking-tight">OneReal</span>
          </Link>
          <Link
            href="/login"
            className="rounded-md px-4 py-2 text-sm font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="pointer-events-none absolute -right-[15%] -top-[40%] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18)_0%,transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-[40%] -left-[10%] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,transparent_70%)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-20 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
            Real Estate &amp; Property Management
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Manage smarter. Grow faster.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300">
            OneReal brings your properties, tenants, leases, finances, and maintenance together
            in a single portal — so you spend less time juggling spreadsheets and more time
            growing your portfolio.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className={primaryBtn}>
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className={ghostBtn}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Four steps to get your rental business running in OneReal.
          </p>
        </div>
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative rounded-xl border bg-card p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <span className="absolute right-4 top-4 text-3xl font-bold text-muted-foreground/15">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* What you can manage */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight">Everything in one portal</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Here&apos;s what you can do inside OneReal, section by section.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <Card key={section.title}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-primary" />
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {section.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Guide callout + final CTA */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">A built-in guide, always a click away</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Once you sign in, open <span className="font-semibold text-foreground">Guide</span> in the
            sidebar anytime to learn how to navigate every part of the portal — from adding a property
            to setting up a lease.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className={primaryBtn}>
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-md border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

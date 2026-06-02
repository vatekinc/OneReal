'use client';

import { Card, CardContent, CardHeader, CardTitle, cn } from '@onereal/ui';
import {
  LayoutDashboard, Building2, Users, Wrench, Calculator, BarChart3,
  MessageSquare, Settings, FileText, CreditCard, Home, Rocket, Lightbulb,
  type LucideIcon,
} from 'lucide-react';

type Role = 'landlord' | 'tenant';

interface Bullet {
  term?: string;
  text: string;
}

interface GuideSection {
  id: string;
  title: string;
  icon: LucideIcon;
  intro: string;
  steps?: string[];
  bullets?: Bullet[];
  tip?: string;
}

/**
 * Turns a string with **bold** markers into React nodes so guide copy can
 * highlight UI labels (button names, field names) inline without raw HTML.
 */
function renderRich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-medium text-foreground">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

const landlordSections: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: Rocket,
    intro:
      'OneReal keeps your whole rental business — properties, people, leases, money, and repairs — in one place. If you are setting things up for the first time, this is the order that works best:',
    steps: [
      'Add your **properties** (and their units).',
      'Add your **tenants** and **service providers** under Contacts.',
      'Create a **lease** to connect a tenant to a property/unit — this drives rent and invoices.',
      'Generate invoices and record payments under **Accounting**.',
      'Log repairs as you go under **Maintenance**.',
    ],
    tip: 'You can always come back to this guide from the **Guide** link at the bottom of the sidebar.',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    intro:
      'Your home screen — a live snapshot of the entire portfolio for the current month. It is read-only; use it to spot how things are trending at a glance.',
    bullets: [
      { term: 'Portfolio stats', text: 'Total Properties, Total Units (and how many are occupied), Occupancy Rate, and Rent Potential.' },
      { term: 'Financial stats', text: 'Monthly Income, Monthly Expenses, Net Income, and Profit Margin, with the change vs. last month.' },
      { term: 'Recent Transactions', text: 'The latest payments and credits across all properties. Click “View All” to open Accounting.' },
    ],
    tip: 'The **Add Property** button in the top-right jumps straight into creating a new property.',
  },
  {
    id: 'properties',
    title: 'Properties — adding & managing',
    icon: Building2,
    intro:
      'Properties are everything you own. Each one holds its units, photos, leases, and recurring expenses.',
    steps: [
      'Click **Properties** in the sidebar, then **Add Property** (the Dashboard has the same button).',
      '**Basic Info:** enter a Property Name (e.g. “123 Main St”), pick a Type (Single Family, Townhouse, Apartment Complex, Condo, Commercial, Other), and a Status.',
      '**Address:** start typing in Address Line 1 to use autocomplete, or fill city / state / ZIP by hand.',
      '**Details (optional):** year built, purchase price & date, market value, and notes.',
      'Click **Create Property** — you land on the property’s page.',
    ],
    bullets: [
      { term: 'Overview', text: 'Address, key stats, and (for single-unit homes) bedrooms, bathrooms, square feet, and rent.' },
      { term: 'Units', text: 'For multi-unit properties only — add each unit with its own rent and status.' },
      { term: 'Images', text: 'Upload photos of the property.' },
      { term: 'Leases', text: 'Every lease tied to this property (this is where you usually add one — see Leases below).' },
      { term: 'Recurring', text: 'Recurring expenses like mortgage, HOA, or insurance that should post automatically.' },
    ],
    tip: 'Single Family, Townhouse, and Condo are treated as one unit automatically — set their rent on the Overview tab. Apartment Complexes get their units added on the **Units** tab.',
  },
  {
    id: 'tenants',
    title: 'Contacts — adding Tenants',
    icon: Users,
    intro:
      'Tenants are the people who rent from you. Add them under Contacts before you put them on a lease.',
    steps: [
      'Go to **Contacts → Tenants**.',
      'Click **Add Tenant**.',
      'Enter **First Name** and **Last Name** (required), plus optional email, phone, emergency contact, and notes.',
      'Click **Create**.',
    ],
    bullets: [
      { text: 'The table shows each tenant’s linked properties and active-lease count.' },
      { text: 'Use the eye icon to view a tenant, the pencil to edit, and the trash to delete.' },
    ],
    tip: 'Adding a tenant here does **not** yet connect them to a property — you do that with a lease (see below).',
  },
  {
    id: 'providers',
    title: 'Contacts — adding Service Providers',
    icon: Wrench,
    intro:
      'Service providers are your vendors — plumbers, electricians, HVAC techs, contractors, cleaners, and so on. You assign them to maintenance jobs and expenses.',
    steps: [
      'Go to **Contacts → Service Providers**.',
      'Click **Add Provider**.',
      'Enter the provider’s name, company, **Category** (Plumber, Electrician, HVAC, General Contractor, …), email, and phone.',
      'Click **Create**.',
    ],
    bullets: [
      { text: 'Filter the list by category to find the right vendor quickly.' },
      { text: 'Providers you add here become selectable on maintenance requests and recurring expenses.' },
    ],
  },
  {
    id: 'leases',
    title: 'Leases — connecting a Tenant to a Property',
    icon: FileText,
    intro:
      'A lease is the link between a tenant and a specific property/unit. It sets the rent, deposit, and due day, and it is what generates invoices. Create the property and tenant first, then tie them together here.',
    steps: [
      'Open the property (**Properties → click the property**) and switch to the **Leases** tab, then click **Add Lease**.',
      'The **Property** is pre-filled. If it has more than one unit, choose the **Unit** (single-unit properties select it for you).',
      '**Tenants:** open the dropdown and select one or more tenants — you can add co-tenants to the same lease.',
      'Pick a **Lease Type** — Fixed (has an end date) or Month-to-Month.',
      'Set the **Start Date** (and **End Date** for fixed leases), **Monthly Rent**, **Security Deposit**, and **Payment Due Day** (1–28).',
      'Optionally add **Additional Charges** (parking, pet rent, etc. — monthly / yearly / one-time) and turn on **Late Fee Settings**.',
      'Set the **Status** to **Active** when the lease is in effect, then click **Create**.',
    ],
    bullets: [
      { text: 'Only tenants you have already created appear in the dropdown, so add the tenant first.' },
      { text: 'Set the status to **Active** so the lease counts toward occupancy and starts generating rent.' },
      { text: 'After creating the lease, reopen it to upload the signed lease document.' },
    ],
    tip: 'You can also start a lease from a tenant’s detail page — it pre-fills that tenant for you.',
  },
  {
    id: 'accounting',
    title: 'Accounting',
    icon: Calculator,
    intro:
      'Everything financial lives here, split across a few sub-pages (in the sidebar under Accounting):',
    bullets: [
      { term: 'Overview', text: 'Income, expenses, net income, profit margin, cash-flow chart, expense breakdown, invoice aging, collection rate, and per-property performance.' },
      { term: 'Incoming', text: 'Rent invoices to tenants. Create one invoice, generate invoices in bulk, and record payments. Filter by status, property, tenant, and date range.' },
      { term: 'Outgoing', text: 'Bills you owe vendors. Create vendor invoices and record what you pay them.' },
      { term: 'Expenses', text: 'One-off and recurring costs — mortgage, repairs, utilities, insurance, taxes, HOA, and more. Filter by type, property, and date.' },
      { term: 'Credits', text: 'Tenant credit balances (overpayments or advance payments) you can apply to future invoices.' },
    ],
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    icon: Wrench,
    intro:
      'Track repair requests from the moment they are reported until they are done.',
    steps: [
      'Go to **Maintenance** and click **New Request**.',
      'Choose the property/unit, a **Category** (Plumbing, Electrical, HVAC, …), and a **Priority** (Low → Emergency), then describe the issue.',
      'Optionally assign a **service provider**, and move the request through its statuses (Open → In Progress → Completed) using the tabs and the edit pencil.',
    ],
    tip: 'Tenants can submit their own requests from their portal — those appear here automatically.',
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: BarChart3,
    intro:
      'Deeper financial analysis you can export and share.',
    bullets: [
      { term: 'Financial Reports', text: 'P&L statement, cash flow, invoice aging, and rent collection — each exportable to CSV.' },
      { term: 'Statements', text: 'Per-tenant and owner statements for a chosen period.' },
    ],
  },
  {
    id: 'messages',
    title: 'Messages',
    icon: MessageSquare,
    intro:
      'In-app messaging with your tenants (and with OneReal support).',
    steps: [
      'Click **New** to start a conversation.',
      'Pick a tenant (and optionally a property), type your message, and send.',
    ],
    bullets: [
      { text: 'Unread messages show a count badge on the Messages item in the sidebar.' },
      { text: 'Messaging availability depends on your plan.' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    intro:
      'Your organization, plan, and how you get paid.',
    bullets: [
      { text: 'Edit your organization name and view members.' },
      { text: 'View or upgrade your subscription plan.' },
      { term: 'Stripe', text: 'Connect it to accept card payments from tenants.' },
      { term: 'Plaid', text: 'Connect a bank account to accept lower-fee ACH payments.' },
    ],
  },
];

const tenantSections: GuideSection[] = [
  {
    id: 'home',
    title: 'Home',
    icon: Home,
    intro:
      'Your tenant portal opens to a snapshot of your tenancy — your lease, your balance, and your recent invoices.',
    bullets: [
      { term: 'Current Lease', text: 'Your property, unit, monthly rent, lease dates, and status.' },
      { term: 'Totals', text: 'Total Paid This Year, your Outstanding Balance, and your Next Due Date.' },
      { term: 'Recent Invoices', text: 'Your latest rent invoices and their status — click “View all” to open Payments.' },
    ],
  },
  {
    id: 'lease',
    title: 'My Lease',
    icon: FileText,
    intro:
      'See the details of your lease — the property and unit, your monthly rent, start and end dates, your deposit, and any lease document your landlord has uploaded.',
  },
  {
    id: 'payments',
    title: 'Payments',
    icon: CreditCard,
    intro:
      'Review your invoices and pay rent online.',
    steps: [
      'Go to **Payments**. Unpaid invoices appear under the **Open** tab.',
      'Click **Pay** on the invoice you want to settle.',
      'Pay by card or by linking your bank account (ACH is usually a lower fee). A small convenience fee may apply.',
      'Optionally link a bank account and turn on **Auto-Pay** so future rent is paid automatically.',
    ],
    tip: 'Which payment options you see depends on what your landlord has enabled.',
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    icon: Wrench,
    intro:
      'Report repairs to your landlord and follow their progress.',
    steps: [
      'Click **New Request**.',
      'Choose a **Category** and **Priority**, then describe the problem.',
      'Submit it, then track its status (Open → In Progress → Completed) right here.',
    ],
  },
  {
    id: 'messages',
    title: 'Messages',
    icon: MessageSquare,
    intro:
      'Message your landlord or property manager directly. Unread replies show a count badge on the Messages item in the sidebar.',
  },
];

export function UserGuide({ role }: { role: Role }) {
  const isTenant = role === 'tenant';
  const sections = isTenant ? tenantSections : landlordSections;
  const subtitle = isTenant
    ? 'How your tenant portal works, section by section.'
    : 'How each part of OneReal works — and how to get set up, step by step.';

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Guide</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Table of contents */}
        <nav className="shrink-0 lg:sticky lg:top-0 lg:w-60">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground">On this page</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 pb-3">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollTo(section.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{section.title}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </nav>

        {/* Sections */}
        <div className="min-w-0 flex-1 space-y-6">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.id} id={section.id} className="scroll-mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Icon className="h-5 w-5 text-primary" />
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{renderRich(section.intro)}</p>

                  {section.steps && (
                    <ol className="list-decimal space-y-1.5 pl-5">
                      {section.steps.map((step, i) => (
                        <li key={i}>{renderRich(step)}</li>
                      ))}
                    </ol>
                  )}

                  {section.bullets && (
                    <ul className="list-disc space-y-1.5 pl-5">
                      {section.bullets.map((bullet, i) => (
                        <li key={i}>
                          {bullet.term && (
                            <span className="font-medium text-foreground">{bullet.term}: </span>
                          )}
                          {renderRich(bullet.text)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {section.tip && (
                    <div className="flex gap-2 rounded-md border bg-muted/40 p-3">
                      <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-foreground">{renderRich(section.tip)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

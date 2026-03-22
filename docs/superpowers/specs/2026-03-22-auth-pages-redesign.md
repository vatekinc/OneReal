# Auth Pages Redesign — Split Layout with Feature Highlights

## Goal

Redesign all auth pages (login, register, forgot-password, reset-password) from a plain centered card layout to a split-panel design with a branded left panel and clean form on the right.

## Architecture

The shared `(auth)/layout.tsx` remains a **server component** and becomes the split container. A new `AuthBrandPanel` server component renders the left panel (dark gradient, logo, feature highlights, social proof — all static content, no interactivity needed). Each page continues to own its form logic — only the visual wrapper changes.

The onboarding page currently lives under `(auth)/` and would inherit this layout. To avoid that, **move onboarding to its own route group** `(onboarding)/` with a simple centered layout.

On mobile (<768px), the layout collapses to a single column: brand panel shrinks to a compact header (logo + tagline only), form below.

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/app/(auth)/layout.tsx` | Modify | Split layout container (two-panel grid), server component |
| `apps/web/components/auth/brand-panel.tsx` | Create | Left panel: logo, tagline, feature highlights, social proof (server component) |
| `apps/web/app/(auth)/login/page.tsx` | Modify | Remove Card wrapper, adapt to right-panel styling |
| `apps/web/app/(auth)/register/page.tsx` | Modify | Remove Card wrapper, adapt to right-panel styling |
| `apps/web/app/(auth)/forgot-password/page.tsx` | Modify | Remove Card wrapper, adapt to right-panel styling |
| `apps/web/app/(auth)/reset-password/page.tsx` | Modify | Remove Card wrapper, adapt to right-panel styling |
| `apps/web/app/(onboarding)/layout.tsx` | Create | Simple centered layout for onboarding (like old auth layout) |
| `apps/web/app/(onboarding)/onboarding/page.tsx` | Move | Move from `(auth)/onboarding/` to `(onboarding)/onboarding/` |

## Design Spec

### Layout Container (`layout.tsx`)

```
┌──────────────────────────────────────────────────┐
│  ┌────────────────────┬─────────────────────────┐ │
│  │                    │                         │ │
│  │   BRAND PANEL      │      FORM PANEL         │ │
│  │   (dark bg)        │      (white bg)         │ │
│  │                    │                         │ │
│  │   Logo + tagline   │   [Page-specific form]  │ │
│  │                    │                         │ │
│  │   Feature 1        │                         │ │
│  │   Feature 2        │                         │ │
│  │   Feature 3        │                         │ │
│  │                    │                         │ │
│  │   Social proof     │                         │ │
│  │                    │                         │ │
│  └────────────────────┴─────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

- Full-screen flex container, centered vertically and horizontally
- Inner container: `max-w-[960px]`, `md:min-h-[580px]` (no min-height on mobile), `rounded-2xl`, shadow, overflow-hidden
- Two equal columns via CSS grid: `md:grid-cols-2`
- Mobile (`<md`): single column, brand panel becomes compact header

### Brand Panel (`brand-panel.tsx`)

**Background:** `bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900` with decorative radial gradient pseudo-elements (subtle blue/indigo glow)

**Content (top to bottom):**
1. **Logo block** — "O" icon (white bg, dark text, rounded-lg) + "OneReal" text (white, font-bold) + tagline below ("Property management, simplified." in slate-400)
2. **Feature highlights** (3 items, pushed to bottom via `mt-auto`):
   - Portfolio Overview — "Track all your properties, tenants, and financials in one place."
   - Automated Invoicing — "Generate, send, and track rent invoices automatically."
   - Financial Insights — "Real-time cash flow, expense breakdowns, and ROI analysis."
   - Each: 40px icon container (white/8 bg, white/10 border, rounded-lg) + title (slate-100, text-sm font-semibold) + description (slate-500, text-xs)
3. **Social proof** — 3 overlapping avatar circles + "Trusted by property managers everywhere" (slate-500, text-xs). Separated by a top border (white/6).

**Icons:** Use Lucide icons (`Building2`, `DollarSign`, `BarChart3`) imported directly from `lucide-react` in `brand-panel.tsx`. The panel is a **server component** — all content is static with no interactivity.

**Avatars (social proof):** Colored circles (slate-700, blue-500, indigo-500) — no images or stock photos needed. Just colored `div` elements styled as overlapping circles.

**Mobile:** Only show logo + tagline. Hide features and social proof.

### Form Panel (right side)

**Background:** white, padding `p-12` (desktop), `p-8` (mobile)

Each page renders its form directly — no Card wrapper. The layout provides the white container.

**Shared styling patterns:**
- Form header: `text-2xl font-bold tracking-tight` for title, `text-muted-foreground text-sm` for subtitle
- Inputs: existing `Input` component — works as-is within the new layout
- Primary button: existing `Button` component — works as-is
- Divider: existing `Separator` pattern — works as-is
- Links: existing styling — works as-is

### Per-Page Changes

**Login** — Remove `<Card>` wrapper. Keep all form logic, handlers, and state unchanged. Footer link ("Don't have an account? Sign up") becomes a `<p className="mt-6 text-center text-sm text-muted-foreground">`.

**Register** — Remove `<Card>` wrapper. Keep all form logic (email, password, confirmPassword, Google OAuth) unchanged. Footer link ("Already have an account? Sign in") same pattern as login.

**Forgot Password** — Remove `<Card>` wrapper. Both states (form + "check email" confirmation) render without Card. Confirmation state: content centered vertically within the panel using `flex flex-col items-center justify-center h-full`. Keep all logic unchanged.

**Reset Password** — Remove `<Card>` wrapper. Keep all logic unchanged. "Back to sign in" link not currently present — stays as-is (no footer link).

### Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| `md+` (768px+) | Two-column grid, brand panel fully visible |
| `<md` | Single column. Brand panel: compact (logo + tagline only, ~80px height, horizontal layout). Form below with full-width padding. |

### What Does NOT Change

- All Supabase auth logic (signIn, signUp, resetPassword, updateUser, OAuth)
- Form state management (useState hooks)
- Toast notifications (sonner)
- Navigation (router.push, Link components)
- Validation logic
- The onboarding page (moved to `(onboarding)/` route group with its own simple centered layout)

## Empty / Error States

No changes — existing toast-based error handling continues to work.

## E2E Test Impact

The existing smoke tests check for auth page text content and form elements. Since the same text ("Welcome back", "Sign in", "Email", "Password", etc.) and form elements remain, **no E2E test changes should be needed**. The layout change is purely structural.

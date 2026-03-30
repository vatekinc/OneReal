import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isApiRoute = pathname.startsWith('/api/');
  const isOnboarding = pathname.startsWith('/onboarding');

  // Allow auth callback and API routes always (webhooks have their own auth)
  if (isAuthCallback || isApiRoute) return supabaseResponse;

  // Unauthenticated user on protected path → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated user on public auth path → dashboard
  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Fetch profile and all memberships in parallel (avoids sequential waterfall)
  let profile: { first_name: string | null; default_org_id: string | null; is_platform_admin: boolean | null; onboarding_completed: boolean | null } | null = null;
  let membership: { role: string | null } | null = null;

  if (user && !isPublicPath) {
    const [profileResult, membershipsResult] = await Promise.all([
      supabase.from('profiles')
        .select('first_name, default_org_id, is_platform_admin, onboarding_completed')
        .eq('id', user.id)
        .single(),
      supabase.from('org_members')
        .select('role, org_id')
        .eq('user_id', user.id),
    ]);

    profile = profileResult.data;

    // Match the membership for the user's default org in-memory
    if (profile?.default_org_id && membershipsResult.data) {
      membership = (membershipsResult.data as any[]).find(
        (m: any) => m.org_id === profile!.default_org_id
      ) ?? null;
    }
  }

  // Onboarding check — only redirect if profile exists and onboarding is explicitly not completed
  // (If profile query failed, let the user through rather than looping to onboarding)
  if (user && !isOnboarding && !isPublicPath && profile && !profile.onboarding_completed) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Admin route guard
  const isAdminRoute = pathname.startsWith('/admin');
  if (isAdminRoute && user) {
    if (!profile?.is_platform_admin) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    // Platform admin accessing /admin — allow through, skip tenant routing
    return supabaseResponse;
  }

  // Role-based tenant routing (uses pre-fetched membership)
  if (user && !isOnboarding && !isPublicPath && profile?.default_org_id) {
    const role = membership?.role;
    const isTenantRoute = pathname.startsWith('/tenant');

    if (role === 'tenant') {
      const allowedPaths = ['/tenant', '/settings/profile'];
      const isAllowed = allowedPaths.some(p => pathname.startsWith(p));
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/tenant', request.url));
      }
    } else if (isTenantRoute) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

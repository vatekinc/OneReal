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
  const isOnboarding = pathname.startsWith('/onboarding');

  // Allow auth callback always
  if (isAuthCallback) return supabaseResponse;

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

  // Fetch profile (shared by onboarding check and role-based routing)
  let profile: { first_name: string | null; default_org_id: string | null } | null = null;
  if (user && !isPublicPath) {
    const { data } = await supabase
      .from('profiles')
      .select('first_name, default_org_id')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  // Onboarding check (use shared profile)
  if (user && !isOnboarding && !isPublicPath && !profile?.first_name) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Role-based tenant routing
  if (user && !isOnboarding && !isPublicPath && profile?.default_org_id) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', profile.default_org_id)
      .single();

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

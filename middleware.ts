import { auth } from './auth';
import { NextResponse } from 'next/server';

// More specific paths FIRST — order matters because of startsWith matching
// Only hard-block Admin pages at middleware level.
// Other pages are controlled by useMenuAccess hook (supports per-user overrides).
const PROTECTED_ROUTES: [string, string[]][] = [
  ['/admin', ['admin', 'administrative_manager', 'ceo']],
];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const role = ((req.auth?.user as { role?: string })?.role ?? '').toLowerCase().trim();

  if (pathname === '/signup') return NextResponse.next();

  if (!isLoggedIn && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // Check protected routes (first match wins)
  for (const [path, allowedRoles] of PROTECTED_ROUTES) {
    if (pathname.startsWith(path)) {
      if (!allowedRoles.includes(role)) {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
      break; // First match wins, stop checking
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
};

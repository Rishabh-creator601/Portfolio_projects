'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ROUTE_ACCESS } from '@/lib/constants';
import Sidebar from './Sidebar';
import { Header } from './Header';

const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback'];

// The OAuth landing page finishes its own redirect once the session resolves,
// so the shell must not race it by bouncing an authenticated visitor away.
const SELF_ROUTING_ROUTES = ['/auth/callback'];

function BrandedSplash({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-cyan-gradient flex flex-col items-center justify-center gap-5 text-white">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/25 text-lg font-bold">
          LM
        </span>
        <span className="text-2xl font-bold tracking-tight">LM-Verify</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-cyan-100">
        <span className="h-2 w-2 animate-ping rounded-full bg-cyan-300" />
        {message}
      </div>
    </div>
  );
}

/**
 * Owns the authenticated chrome: it keeps unauthenticated visitors on /login,
 * enforces role access per route, and renders the nav around the page.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
  const isSelfRouting = SELF_ROUTING_ROUTES.some((route) => pathname.startsWith(route));

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (isAuthenticated && isPublic && !isSelfRouting) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, isPublic, isSelfRouting, pathname, router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isLoading) return <BrandedSplash message="Restoring your secure session…" />;
  if (isPublic) return <>{children}</>;
  if (!isAuthenticated) return <BrandedSplash message="Redirecting to sign in…" />;

  const matchedRoute = Object.keys(ROUTE_ACCESS)
    .filter((route) => pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)[0];
  const allowedRoles = matchedRoute ? ROUTE_ACCESS[matchedRoute] : null;
  const isPermitted = !allowedRoles || (user ? allowedRoles.includes(user.role) : false);

  return (
    <div className="flex min-h-screen bg-[var(--app-bg)]">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-x-hidden">
          {isPermitted ? (
            <div className="animate-fade-in">{children}</div>
          ) : (
            <div className="mx-auto max-w-lg p-8">
              <div className="card p-8 text-center">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-verdict-fail/10 text-verdict-fail">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    />
                  </svg>
                </div>
                <h1 className="text-lg font-bold text-cyan-950">Access restricted</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your role ({user?.role.replace(/_/g, ' ')}) does not have permission to open this
                  section. Contact your Controller if you believe this is an error.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { API_URL } from '@/lib/constants';

/** What the API says it can actually authenticate with right now. */
export interface AuthProviders {
  password: boolean;
  google: boolean;
  signupEnabled: boolean;
}

/**
 * Asks the API which sign-in methods are configured. Google is only offered
 * once the server has a client id and secret, so the button never appears as a
 * dead end. Failure is treated as "password only" rather than blocking the form.
 */
export function useAuthProviders() {
  const [providers, setProviders] = useState<AuthProviders>({
    password: true,
    google: false,
    signupEnabled: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/auth/providers`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.data) setProviders(body.data as AuthProviders);
      })
      .catch(() => {
        /* Password sign-in always works; leave the defaults in place. */
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, isLoading };
}

/** Google's mark, inlined so the button renders with no external request. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/**
 * Starts the OAuth round trip. This is a full-page navigation, not fetch:
 * the browser has to follow Google's redirects and land back on the API so the
 * httpOnly session cookie is set on a real top-level navigation.
 */
export function GoogleButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || isRedirecting}
      onClick={() => {
        setIsRedirecting(true);
        window.location.href = `${API_URL}/auth/google`;
      }}
      className="focus-ring inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-cyan-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-cyan-50 hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GoogleMark />
      {isRedirecting ? 'Redirecting to Google…' : label}
    </button>
  );
}

/** Horizontal rule with a label, separating Google from the password form. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-cyan-100" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-white px-3 text-xs uppercase tracking-wide text-slate-400">{label}</span>
      </div>
    </div>
  );
}

/**
 * The split brand/form layout shared by sign-in and sign-up, so the two pages
 * cannot drift apart visually.
 */
export function AuthShell({
  headline,
  blurb,
  children,
}: {
  headline: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-cyan-gradient p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(6,182,212,0.25), transparent 40%)',
          }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 ring-1 ring-cyan-300/40">
            <ShieldCheck className="h-6 w-6 text-cyan-300" aria-hidden="true" />
          </span>
          <span className="text-2xl font-bold tracking-tight text-white">LM-Verify</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-white">{headline}</h1>
          <p className="mt-4 text-cyan-100/90">{blurb}</p>

          <dl className="mt-10 grid grid-cols-3 gap-4">
            {[
              { value: '28+', label: 'Rules evaluated' },
              { value: '30+', label: 'Product categories' },
              { value: '4', label: 'Verdict states' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/8 p-4 ring-1 ring-white/10">
                <dt className="text-2xl font-bold text-cyan-300">{stat.value}</dt>
                <dd className="mt-1 text-xs text-cyan-100/80">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-cyan-200/70">
          Authorised use only. All sign-in attempts and adjudications are logged.
        </p>
      </div>

      <div className="flex items-center justify-center bg-[var(--app-bg)] px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-gradient ring-1 ring-cyan-300/40">
              <ShieldCheck className="h-5 w-5 text-cyan-100" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold tracking-tight text-cyan-950">LM-Verify</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

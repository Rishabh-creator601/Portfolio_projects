'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, formatDate } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import {
  AlertCircle,
  LogOut,
  Mail,
  MapPin,
  ShieldCheck,
  UserCircle,
  Monitor,
} from 'lucide-react';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState<'this' | 'all' | null>(null);

  const handleSignOut = async (everywhere: boolean) => {
    setSigningOut(everywhere ? 'all' : 'this');
    try {
      await logout({ everywhere });
    } finally {
      // The provider redirects to /login; clearing state guards the case where
      // the request fails and the officer stays on this page.
      setSigningOut(null);
    }
  };

  const initials = (user?.displayName || user?.email || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Your account, role and session.</p>
      </div>

      {/* Account */}
      <section id="account" className="card p-6 scroll-mt-20">
        <h2 className="section-title mb-4">Account</h2>

        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-full bg-cyan-gradient text-lg font-semibold text-white ring-1 ring-cyan-300/40">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-cyan-950">
              {user?.displayName || '—'}
            </p>
            <p className="truncate text-sm text-slate-500">
              {user ? ROLE_LABELS[user.role] || user.role : '—'}
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-cyan-100 bg-surface-muted p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Mail className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              Email
            </dt>
            <dd className="mt-1 break-all text-sm text-cyan-950">{user?.email || '—'}</dd>
          </div>

          <div className="rounded-lg border border-cyan-100 bg-surface-muted p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              Jurisdiction
            </dt>
            <dd className="mt-1 text-sm text-cyan-950">{user?.jurisdiction || 'Unassigned'}</dd>
          </div>

          <div className="rounded-lg border border-cyan-100 bg-surface-muted p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <UserCircle className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              Sign-in method
            </dt>
            <dd className="mt-1 text-sm capitalize text-cyan-950">
              {user?.authProvider === 'google' ? 'Google' : 'Email & password'}
            </dd>
          </div>

          <div className="rounded-lg border border-cyan-100 bg-surface-muted p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              Last sign-in
            </dt>
            <dd className="mt-1 text-sm text-cyan-950">{formatDate(user?.lastLogin) || '—'}</dd>
          </div>
        </dl>

        {user && ROLE_DESCRIPTIONS[user.role] && (
          <p className="mt-4 text-xs text-slate-500">{ROLE_DESCRIPTIONS[user.role]}</p>
        )}
      </section>

      {/* Session */}
      <section className="card mt-6 p-6">
        <h2 className="section-title mb-1">Session</h2>
        <p className="mb-5 text-sm text-slate-500">
          Sessions are held in a short-lived token with a rotating refresh cookie. Signing out
          revokes the refresh token on the server, not just in this browser.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="secondary"
            size="lg"
            className="sm:flex-1"
            onClick={() => handleSignOut(false)}
            isLoading={signingOut === 'this'}
            disabled={signingOut !== null}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {signingOut === 'this' ? 'Signing out…' : 'Sign out'}
          </Button>

          <Button
            variant="danger"
            size="lg"
            className="sm:flex-1"
            onClick={() => handleSignOut(true)}
            isLoading={signingOut === 'all'}
            disabled={signingOut !== null}
          >
            <Monitor className="h-4 w-4" aria-hidden="true" />
            {signingOut === 'all' ? 'Revoking…' : 'Sign out on all devices'}
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3 text-xs text-cyan-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-cyan-700" aria-hidden="true" />
          <span>
            Signing out on all devices increments your token version, so every access token issued
            to this account stops validating immediately.
          </span>
        </div>
      </section>
    </div>
  );
}

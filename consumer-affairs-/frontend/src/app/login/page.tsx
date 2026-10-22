'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  AuthDivider,
  AuthShell,
  GoogleButton,
  useAuthProviders,
} from '@/components/auth/AuthShell';
import { AlertCircle, Eye, EyeOff, Lock, Mail, UserPlus } from 'lucide-react';

/** Messages for the failure codes the OAuth callback can bounce back with. */
const OAUTH_ERRORS: Record<string, string> = {
  google_not_configured: 'Google sign-in is not configured on this server yet.',
  consent_denied: 'Google sign-in was cancelled.',
  state_mismatch: 'That sign-in link expired. Please try again.',
  missing_code: 'Google did not return a sign-in code. Please try again.',
  token_verification_failed: 'Could not verify the Google sign-in. Please try again.',
  domain_not_allowed: 'That Google account is not on an authorised domain.',
  account_inactive: 'That account has been deactivated. Contact your Controller.',
  signup_disabled: 'Self-registration is disabled. Ask your Controller for an account.',
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();
  const { providers } = useAuthProviders();

  const oauthError = params?.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthError
      ? OAUTH_ERRORS[oauthError] ?? 'Google sign-in failed. Please try again.'
      : params?.get('expired')
        ? 'Your session expired. Please sign in again.'
        : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const next = params?.get('next');
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : '/signup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email.trim(), password);
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 423
            ? 'Account locked after repeated failed attempts. Try again in 15 minutes.'
            : err.status === 429
              ? 'Too many sign-in attempts. Please wait a few minutes before retrying.'
              : err.message
        );
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      headline="Automated compliance verification for packaged commodities"
      blurb="Deterministic checks against the Legal Metrology (Packaged Commodities) Rules, 2011 — with statutory citations, officer overrides and an evidentiary audit trail on every verdict."
    >
      <div className="card p-8">
        <h2 className="text-xl font-bold text-cyan-950">Officer sign in</h2>
        <p className="mt-1 text-sm text-slate-500">
          Use the credentials issued by your Legal Metrology Controller.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-3 text-sm text-verdict-fail"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {providers.google && (
          <>
            <div className="mt-6">
              <GoogleButton label="Continue with Google" disabled={isSubmitting} />
            </div>
            <AuthDivider label="or sign in with email" />
          </>
        )}

        <form
          className={providers.google ? 'space-y-5' : 'mt-6 space-y-5'}
          onSubmit={handleSubmit}
          noValidate
        >
          <div>
            <label htmlFor="email" className="label">
              Official email address
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600"
                aria-hidden="true"
              />
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@lmverify.gov.in"
                className="input pl-10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600"
                aria-hidden="true"
              />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="input pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-700"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isSubmitting}
            disabled={!email || !password}
          >
            {isSubmitting ? 'Verifying…' : 'Sign in securely'}
          </Button>
        </form>

        {providers.signupEnabled && (
          <div className="mt-6 border-t border-cyan-100 pt-5">
            <p className="text-center text-sm text-slate-600">
              Don&apos;t have an account yet?
            </p>
            <Link
              href={signupHref}
              className="focus-ring mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300 bg-white px-6 py-2.5 text-sm font-medium text-cyan-800 transition-colors hover:border-cyan-400 hover:bg-cyan-50"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create an account
            </Link>
          </div>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Lock className="h-3 w-3 text-cyan-600" aria-hidden="true" />
          Session protected by short-lived tokens and rotating refresh cookies
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Five failed attempts lock the account for 15 minutes. New accounts start with Field
        Inspector access until a Controller assigns a role.
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-cyan-gradient" />}>
      <LoginForm />
    </Suspense>
  );
}

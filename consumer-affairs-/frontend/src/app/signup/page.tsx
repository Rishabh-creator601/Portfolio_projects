'use client';

import { Suspense, useMemo, useState } from 'react';
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
import { AlertCircle, Check, Eye, EyeOff, Lock, Mail, User, X } from 'lucide-react';

/** Mirrors the server's passwordSchema so the rules are visible before submit. */
const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (v) => v.length >= 10 },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v) => /[0-9]/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signup } = useAuth();
  const { providers } = useAuthProviders();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const next = params?.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  const passwordChecks = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(password) })),
    [password]
  );
  const passwordValid = passwordChecks.every((c) => c.passed);
  const confirmValid = confirm.length > 0 && confirm === password;
  const canSubmit =
    displayName.trim().length >= 2 && email.trim().length > 0 && passwordValid && confirmValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await signup({ displayName: displayName.trim(), email: email.trim(), password });
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 409
            ? 'An account with that email already exists. Try signing in instead.'
            : err.status === 429
              ? 'Too many accounts created from this network. Please try again later.'
              : err.message
        );
      } else {
        setError('Unable to create your account right now. Please try again.');
      }
      setPassword('');
      setConfirm('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      headline="Create your LM-Verify officer account"
      blurb="Scan packaged commodities, run deterministic checks against the Packaged Commodities Rules, 2011, and build an evidentiary record for every inspection you raise."
    >
      <div className="card p-8">
        <h2 className="text-xl font-bold text-cyan-950">Create account</h2>
        <p className="mt-1 text-sm text-slate-500">
          New accounts start with Field Inspector access.
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
              <GoogleButton label="Sign up with Google" disabled={isSubmitting} />
            </div>
            <AuthDivider label="or use an email address" />
          </>
        )}

        <form
          className={providers.google ? 'space-y-5' : 'mt-6 space-y-5'}
          onSubmit={handleSubmit}
          noValidate
        >
          <div>
            <label htmlFor="displayName" className="label">
              Full name
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600"
                aria-hidden="true"
              />
              <input
                id="displayName"
                name="displayName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Rajesh Kumar"
                className="input pl-10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="label">
              Email address
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
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="input pl-10 pr-10"
                aria-describedby="password-rules"
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

            {password.length > 0 && (
              <ul id="password-rules" className="mt-3 grid gap-1.5">
                {passwordChecks.map((check) => (
                  <li
                    key={check.label}
                    className={`flex items-center gap-2 text-xs ${
                      check.passed ? 'text-verdict-pass' : 'text-slate-500'
                    }`}
                  >
                    {check.passed ? (
                      <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <X className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" aria-hidden="true" />
                    )}
                    {check.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label htmlFor="confirm" className="label">
              Confirm password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600"
                aria-hidden="true"
              />
              <input
                id="confirm"
                name="confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••"
                className="input pl-10"
              />
            </div>
            {confirm.length > 0 && !confirmValid && (
              <p className="mt-2 text-xs text-verdict-fail">Passwords do not match.</p>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isSubmitting}
            disabled={!canSubmit}
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <div className="mt-6 border-t border-cyan-100 pt-5">
          <p className="text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link
              href={loginHref}
              className="focus-ring rounded font-semibold text-cyan-700 underline-offset-2 hover:text-cyan-800 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        By creating an account you agree that all inspections and adjudications you record are
        logged against your name.
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-cyan-gradient" />}>
      <SignupForm />
    </Suspense>
  );
}

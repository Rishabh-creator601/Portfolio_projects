'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ShieldCheck } from 'lucide-react';

/**
 * Where Google sends the browser after the API has established the session.
 *
 * Nothing sensitive travels in the URL: the API set an httpOnly refresh cookie
 * on the callback, so this page just trades it for an access token and moves on.
 * A failure is bounced back to /login with the reason, which renders it.
 */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const { resumeSession } = useAuth();
  const [message, setMessage] = useState('Completing sign-in…');

  // React 18 dev mode mounts effects twice; the exchange must only run once.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const error = params?.get('error');
    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    (async () => {
      const user = await resumeSession();

      if (!user) {
        setMessage('Could not complete sign-in. Returning to sign-in…');
        router.replace('/login?error=token_verification_failed');
        return;
      }

      const next = params?.get('next');
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    })();
  }, [params, resumeSession, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-cyan-gradient px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/10 ring-1 ring-cyan-300/40">
          <ShieldCheck className="h-6 w-6 text-cyan-300" aria-hidden="true" />
        </span>
        <div className="flex items-center gap-2 text-sm text-cyan-100">
          <span className="h-2 w-2 animate-ping rounded-full bg-cyan-300" aria-hidden="true" />
          {message}
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-cyan-gradient" />}>
      <Callback />
    </Suspense>
  );
}

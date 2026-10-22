'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Page() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-cyan-gradient text-cyan-100">
      <div className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 animate-ping rounded-full bg-cyan-300" />
        Loading LM-Verify…
      </div>
    </div>
  );
}
